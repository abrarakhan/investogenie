import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react";
import {
  ActivityIndicator, AppState, FlatList, Modal, Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import Svg, { Line, Rect } from "react-native-svg";
import {
  ApiError, createMutationKey, createTrade, getCandles, getScreen, peekCachedScreen,
  type CandlePoint, type Market, type MobileScreen, type ScreenCard, type TradeAction,
} from "../api";
import { Card } from "../design/Card";
import { Pill } from "../design/Pill";
import { CardListSkeleton } from "../design/Skeleton";
import { colors, hapticSelection, hapticSuccess, radius, spacing, tabularNums, typography } from "../design/tokens";
import { amount, errorMessage, marketDate, money } from "../format";
import { Action, Banner, Empty, Metric, ScreenHead } from "../ui";

function formatFreshness(updatedAt: number | null, fromCache: boolean): string | null {
  if (!updatedAt) return null;
  const elapsedMin = Math.max(0, Math.floor((Date.now() - updatedAt) / 60_000));
  const age = elapsedMin < 1 ? "just now" : elapsedMin < 60 ? `${elapsedMin}m ago` : `${Math.floor(elapsedMin / 60)}h ago`;
  return fromCache ? `Cached · updated ${age}` : `Updated ${age}`;
}

/** Generic renderer shared by every server-built market and strategy screen. */
export default function ServerCardScreen({
  screenKey,
  fallbackScreenKey,
  title,
  market,
}: {
  screenKey: string;
  fallbackScreenKey?: string;
  title: string;
  market: Market;
}) {
  const [activeKey, setActiveKey] = useState(screenKey);
  const [screen, setScreen] = useState<MobileScreen | null>(null);
  const [params, setParams] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ScreenCard | null>(null);
  const [refreshing, setRefreshing] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [reloads, setReloads] = useState(0);
  const [fromCache, setFromCache] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    let settledLive = false;
    void peekCachedScreen(activeKey, market, params).then((cached) => {
      if (active && !settledLive && cached) {
        setScreen(cached.payload);
        setFromCache(true);
        setUpdatedAt(cached.savedAt);
      }
    });
    getScreen(activeKey, market, params).then((result) => {
      if (!active) return;
      settledLive = true;
      setScreen(result);
      setFromCache(false);
      setUpdatedAt(Date.now());
    })
      .catch((cause) => {
        if (!active) return;
        if (cause instanceof ApiError && cause.status === 404 && fallbackScreenKey && activeKey !== fallbackScreenKey) {
          setActiveKey(fallbackScreenKey);
          return;
        }
        setError(errorMessage(cause, `Could not load ${title}`));
      })
      .finally(() => { if (active) setRefreshing(false); });
    return () => { active = false; };
  }, [activeKey, fallbackScreenKey, market, params, title, reloads]);
  const load = useCallback(() => { setRefreshing(true); setError(""); setReloads((count) => count + 1); }, []);
  const loadMore = useCallback(() => {
    const cursor = screen?.pagination?.nextCursor;
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    getScreen(activeKey, market, params, cursor)
      .then((next) => setScreen((current) => current ? {
        ...next,
        cards: [...current.cards, ...next.cards.filter((card) => !current.cards.some((existing) => existing.id === card.id))],
      } : next))
      .catch((cause) => setError(errorMessage(cause, `Could not load more ${title}`)))
      .finally(() => setLoadingMore(false));
  }, [activeKey, loadingMore, market, params, screen?.pagination?.nextCursor, title]);
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => { if (!timer) timer = setInterval(load, 300_000); };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    if (AppState.currentState === "active") start();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") start();
      else stop();
    });
    return () => { stop(); sub.remove(); };
  }, [load]);
  if (selected) return <CardDetail card={selected} market={market} onBack={() => setSelected(null)} />;
  const setParam = (param: string, value: string) => {
    hapticSelection();
    setRefreshing(true);
    setError("");
    setParams((current) => ({ ...current, [param]: value }));
  };
  const freshness = formatFreshness(updatedAt, fromCache);
  return <View style={styles.flex}>
    <ScreenHead title={screen?.title ?? title} subtitle={screen?.subtitle ?? "Loading from the server."} />
    {(!!screen?.summary || !!freshness) && <View style={styles.metaBar}>
      {!!screen?.summary && <Text style={styles.summary}>{screen.summary}</Text>}
      {!!freshness && <Text style={fromCache ? styles.cachedTag : styles.freshTag}>{freshness}</Text>}
    </View>}
    {!!screen?.notice && <Text style={styles.notice}>{screen.notice}</Text>}
    {screen?.options.map((option) => <ScrollView key={option.param} horizontal showsHorizontalScrollIndicator={false} style={styles.chipBar} contentContainerStyle={styles.chips}>
      {option.choices.map((choice) => <Pressable key={choice.value} onPress={() => setParam(option.param, choice.value)} style={[styles.chip, (params[option.param] ?? option.value) === choice.value && styles.chipActive]}><Text style={(params[option.param] ?? option.value) === choice.value ? styles.chipTextActive : styles.chipText}>{choice.label}</Text></Pressable>)}
    </ScrollView>)}
    {screen?.searchable && <View style={styles.searchRow}><TextInput style={styles.input} value={search} onChangeText={setSearch} onSubmitEditing={() => setParam("search", search.trim())} returnKeyType="search" placeholder="Search symbol or name" placeholderTextColor={colors.textSubtle} autoCapitalize="characters" autoCorrect={false} /></View>}
    {!!error && <Banner>{error}</Banner>}
    {!screen && refreshing ? <CardListSkeleton count={4} /> : <FlatList data={screen?.cards ?? []} keyExtractor={(item) => item.id} removeClippedSubviews windowSize={7} initialNumToRender={10} onEndReached={loadMore} onEndReachedThreshold={0.4} ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.emerald} /> : null} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={colors.emerald} />} contentContainerStyle={styles.list} ListEmptyComponent={!refreshing ? <Empty>Nothing to show right now.</Empty> : null} renderItem={({ item }) => <Card onPress={() => setSelected(item)}>
      <View style={styles.rowBetween}><View style={styles.flex}><Text style={styles.ticker}>{item.title}</Text><Text numberOfLines={1} style={styles.meta}>{item.subtitle}</Text></View>{item.badge && <Pill label={item.badge.label} tone={item.badge.tone} />}{item.score !== null && <View style={styles.score}><Text style={styles.scoreText}>{item.score}</Text></View>}</View>
      {!!item.pills?.length && <View style={styles.pillRow}>{item.pills.map((pill) => <Pill key={pill.label} label={pill.label} tone={pill.tone} compact />)}</View>}
      <View style={styles.metricRow}>{item.metrics.map((metric) => <Metric key={metric.label} label={metric.label} value={metric.value} positive={metric.tone === "positive"} negative={metric.tone === "negative"} />)}</View>
      {!!item.footer && <Text style={styles.cardFoot}>{item.footer}</Text>}
    </Card>} />}
  </View>;
}

function CardDetail({ card, market, onBack }: { card: ScreenCard; market: Market; onBack: () => void }) {
  const [buying, setBuying] = useState(false); const [notice, setNotice] = useState("");
  return <ScrollView contentContainerStyle={styles.detail}>
    <Pressable onPress={onBack}><Text style={styles.link}>Back</Text></Pressable>
    <Text style={styles.detailTicker}>{card.title}</Text><Text style={styles.meta}>{card.subtitle}</Text>
    {(card.badge || !!card.pills?.length) && <View style={styles.detailBadge}>
      {card.badge && <Pill label={card.badge.label} tone={card.badge.tone} />}
      {card.pills?.map((pill) => <Pill key={pill.label} label={pill.label} tone={pill.tone} compact />)}
    </View>}
    {!!card.chartTicker && <PriceChart market={market} ticker={card.chartTicker} />}
    <View style={styles.metricGrid}>{card.metrics.map((metric) => <Metric key={metric.label} label={metric.label} value={metric.value} positive={metric.tone === "positive"} negative={metric.tone === "negative"} />)}{card.score !== null && <Metric label="SCORE" value={card.score} />}</View>
    {!!card.guidance && <Text style={styles.guidance}>{card.guidance}</Text>}
    {card.trade && <Action label="Log purchased trade" onPress={() => setBuying(true)} />}
    {!!notice && <Text style={styles.success}>{notice}</Text>}
    {card.sections.map((section) => <View key={section.title}><Text style={styles.sectionTitle}>{section.title}</Text>{section.rows.map((row, index) => <View key={`${row.label}:${index}`} style={styles.gate}>
      {row.passed !== undefined && <Text style={row.passed ? styles.good : styles.bad}>{row.passed ? "PASS" : "WAIT"}</Text>}
      <View style={styles.gateText}><View style={styles.rowBetween}><Text style={[styles.gateLabel, styles.flex]}>{row.label}</Text>{!!row.value && <Text style={styles.rowValue}>{row.value}</Text>}</View>{!!row.detail && <Text style={styles.muted}>{row.detail}</Text>}</View>
    </View>)}</View>)}
    {card.trade && <TradeEntrySheet visible={buying} trade={card.trade} market={market} onClose={() => setBuying(false)} onSaved={() => { hapticSuccess(); setBuying(false); setNotice("Trade recorded in your ledger with this frozen plan."); }} />}
  </ScrollView>;
}

function PriceChart({ market, ticker }: { market: Market; ticker: string }) {
  const [points, setPoints] = useState<CandlePoint[]>([]);
  useEffect(() => { let active = true; getCandles(market, ticker).then((result) => { if (active) setPoints(result.candle?.points.slice(-50) ?? []); }).catch(() => undefined); return () => { active = false; }; }, [market, ticker]);
  if (!points.length) return <View style={styles.chart}><ActivityIndicator color="#34d399" /></View>;
  const low = Math.min(...points.map((point) => point.low)); const high = Math.max(...points.map((point) => point.high)); const span = Math.max(0.0001, high - low);
  const width = 340; const height = 120; const step = width / points.length; const bodyWidth = Math.max(2, step * 0.58); const y = (price: number) => 8 + ((high - price) / span) * (height - 16);
  return <View><View style={styles.chart}><Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>{points.map((point, index) => { const x = index * step + step / 2; const rising = point.close >= point.open; const color = rising ? "#34d399" : "#fb7185"; const top = y(Math.max(point.open, point.close)); const bottom = y(Math.min(point.open, point.close)); return <Fragment key={point.date}><Line x1={x} x2={x} y1={y(point.high)} y2={y(point.low)} stroke={color} strokeWidth="1" /><Rect x={x - bodyWidth / 2} y={top} width={bodyWidth} height={Math.max(1.5, bottom - top)} fill={color} /></Fragment>; })}</Svg></View><Text style={styles.chartCaption}>50-session OHLC candles · {money(low, market)} to {money(high, market)}</Text></View>;
}

function TradeEntrySheet({ visible, trade, market, onClose, onSaved }: { visible: boolean; trade: TradeAction; market: Market; onClose: () => void; onSaved: () => void }) {
  const [date, setDate] = useState(marketDate(market)); const [price, setPrice] = useState(String(trade.suggestedPrice)); const [quantity, setQuantity] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [idempotencyKey] = useState(createMutationKey);
  const save = async () => { setBusy(true); setError(""); try { await createTrade({ assetId: trade.assetId, market, boughtOn: date, buyPrice: amount(price), quantity: amount(quantity), strategyKey: trade.strategyKey, planId: trade.planId }, idempotencyKey); onSaved(); } catch (cause) { setError(errorMessage(cause, "Trade could not be recorded")); } finally { setBusy(false); } };
  return <Sheet visible={visible} title={`Log ${trade.ticker}`} onClose={onClose}><Field value={date} onChangeText={setDate} placeholder="Purchase date YYYY-MM-DD" /><Field value={price} onChangeText={setPrice} placeholder="Buy price" keyboard="decimal-pad" /><Field value={quantity} onChangeText={setQuantity} placeholder="Quantity" keyboard="decimal-pad" />{!!error && <Text style={styles.errorText}>{error}</Text>}<Action label="Freeze plan and log trade" busy={busy} onPress={save} /></Sheet>;
}
function Sheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: ReactNode }) { return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}><View style={styles.modalBackdrop}><View style={styles.sheet}><View style={styles.rowBetween}><Text style={styles.sectionTitle}>{title}</Text><Pressable onPress={onClose}><Text style={styles.link}>Close</Text></Pressable></View>{children}</View></View></Modal>; }
function Field({ value, onChangeText, placeholder, keyboard }: { value: string; onChangeText: (value: string) => void; placeholder: string; keyboard?: "decimal-pad" }) { return <TextInput style={styles.input} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.textSubtle} autoCapitalize="none" autoCorrect={false} keyboardType={keyboard} />; }

const styles = StyleSheet.create({
  flex: { flex: 1 },
  muted: typography.muted,
  metaBar: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", paddingHorizontal: spacing.lg + 2, paddingBottom: spacing.sm, gap: spacing.sm },
  summary: typography.caption,
  freshTag: typography.caption,
  cachedTag: { color: colors.amber, fontSize: 11, fontWeight: "700" },
  notice: { color: colors.amber, fontSize: 11, paddingHorizontal: spacing.lg + 2, paddingBottom: spacing.sm },
  errorText: { color: colors.rose },
  chipBar: { flexGrow: 0, flexShrink: 0 },
  chips: { paddingHorizontal: 14, paddingBottom: spacing.sm, gap: spacing.sm },
  chip: { borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.emeraldBg, borderColor: colors.emeraldBorder },
  chipText: { color: colors.textMuted, fontSize: 12, fontWeight: "700" },
  chipTextActive: { color: colors.emeraldText, fontSize: 12, fontWeight: "900" },
  searchRow: { paddingHorizontal: 14, paddingBottom: spacing.sm },
  input: { color: colors.text, backgroundColor: colors.surface, borderColor: colors.borderStrong, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 15, height: 50 },
  list: { padding: 14, gap: 10, paddingBottom: spacing.xxl },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  ticker: typography.ticker,
  meta: { color: colors.textSubtle, fontSize: 12, marginTop: 3 },
  score: { minWidth: 42, height: 30, paddingHorizontal: 8, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.borderStrong },
  scoreText: { color: colors.text, fontWeight: "900", ...tabularNums },
  cardFoot: { color: colors.textMuted, fontSize: 12 },
  metricRow: { flexDirection: "row", gap: spacing.sm },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginVertical: 18 },
  detail: { padding: spacing.xl, paddingBottom: 50 },
  detailTicker: { ...typography.detailTicker, marginTop: 22 },
  detailBadge: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  guidance: { color: colors.textSecondary, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, lineHeight: 20, marginBottom: 6 },
  success: { color: colors.emeraldText, marginTop: spacing.md },
  sectionTitle: { ...typography.sectionTitle, marginTop: spacing.sm, marginBottom: 10 },
  gate: { flexDirection: "row", gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 13 },
  gateText: { flex: 1 },
  gateLabel: { color: colors.text, fontWeight: "800", marginBottom: 3 },
  good: { color: colors.emerald, fontSize: 11, fontWeight: "900", width: 38 },
  bad: { color: colors.amber, fontSize: 11, fontWeight: "900", width: 38 },
  rowValue: { color: colors.text, fontWeight: "800", ...tabularNums },
  link: { color: colors.link, fontWeight: "700" },
  chart: { height: 120, marginTop: 18, backgroundColor: colors.surfaceInset, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, overflow: "hidden" },
  chartCaption: { color: colors.textSubtle, fontSize: 10, marginTop: 6, ...tabularNums },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.72)" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, borderColor: colors.borderStrong, borderWidth: 1, padding: spacing.xl, paddingBottom: 36, gap: spacing.md },
});
