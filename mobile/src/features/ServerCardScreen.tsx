import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react";
import {
  ActivityIndicator, FlatList, Modal, Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import Svg, { Line, Rect } from "react-native-svg";
import {
  createMutationKey, createTrade, getCandles, getScreen,
  type CandlePoint, type Market, type MobileScreen, type ScreenCard, type ScreenTone, type TradeAction,
} from "../api";
import { amount, errorMessage, marketDate, money } from "../format";
import { Action, Banner, Empty, Metric, ScreenHead } from "../ui";

/** Generic renderer shared by every server-built market and strategy screen. */
export default function ServerCardScreen({ screenKey, title, market }: { screenKey: string; title: string; market: Market }) {
  const [screen, setScreen] = useState<MobileScreen | null>(null);
  const [params, setParams] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ScreenCard | null>(null);
  const [refreshing, setRefreshing] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [reloads, setReloads] = useState(0);
  useEffect(() => {
    let active = true;
    getScreen(screenKey, market, params).then((result) => { if (active) setScreen(result); })
      .catch((cause) => { if (active) setError(errorMessage(cause, `Could not load ${title}`)); })
      .finally(() => { if (active) setRefreshing(false); });
    return () => { active = false; };
  }, [screenKey, market, params, title, reloads]);
  const load = useCallback(() => { setRefreshing(true); setError(""); setReloads((count) => count + 1); }, []);
  const loadMore = useCallback(() => {
    const cursor = screen?.pagination?.nextCursor;
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    getScreen(screenKey, market, params, cursor)
      .then((next) => setScreen((current) => current ? {
        ...next,
        cards: [...current.cards, ...next.cards.filter((card) => !current.cards.some((existing) => existing.id === card.id))],
      } : next))
      .catch((cause) => setError(errorMessage(cause, `Could not load more ${title}`)))
      .finally(() => setLoadingMore(false));
  }, [loadingMore, market, params, screen?.pagination?.nextCursor, screenKey, title]);
  useEffect(() => { const timer = setInterval(load, 300_000); return () => clearInterval(timer); }, [load]);
  if (selected) return <CardDetail card={selected} market={market} onBack={() => setSelected(null)} />;
  const setParam = (param: string, value: string) => { setRefreshing(true); setError(""); setParams((current) => ({ ...current, [param]: value })); };
  return <View style={styles.flex}>
    <ScreenHead title={screen?.title ?? title} subtitle={screen?.subtitle ?? "Loading from the server."} />
    {!!screen?.summary && <Text style={styles.summary}>{screen.summary}</Text>}
    {!!screen?.notice && <Text style={styles.notice}>{screen.notice}</Text>}
    {screen?.options.map((option) => <ScrollView key={option.param} horizontal showsHorizontalScrollIndicator={false} style={styles.chipBar} contentContainerStyle={styles.chips}>
      {option.choices.map((choice) => <Pressable key={choice.value} onPress={() => setParam(option.param, choice.value)} style={[styles.chip, (params[option.param] ?? option.value) === choice.value && styles.chipActive]}><Text style={(params[option.param] ?? option.value) === choice.value ? styles.chipTextActive : styles.chipText}>{choice.label}</Text></Pressable>)}
    </ScrollView>)}
    {screen?.searchable && <View style={styles.searchRow}><TextInput style={styles.input} value={search} onChangeText={setSearch} onSubmitEditing={() => setParam("search", search.trim())} returnKeyType="search" placeholder="Search symbol or name" placeholderTextColor="#697078" autoCapitalize="characters" autoCorrect={false} /></View>}
    {!!error && <Banner>{error}</Banner>}
    <FlatList data={screen?.cards ?? []} keyExtractor={(item) => item.id} onEndReached={loadMore} onEndReachedThreshold={0.4} ListFooterComponent={loadingMore ? <ActivityIndicator color="#34d399" /> : null} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor="#34d399" />} contentContainerStyle={styles.list} ListEmptyComponent={!refreshing ? <Empty>Nothing to show right now.</Empty> : null} renderItem={({ item }) => <Pressable onPress={() => setSelected(item)} style={styles.card}>
      <View style={styles.rowBetween}><View style={styles.flex}><Text style={styles.ticker}>{item.title}</Text><Text numberOfLines={1} style={styles.meta}>{item.subtitle}</Text></View>{item.badge && <TonePill label={item.badge.label} tone={item.badge.tone} />}{item.score !== null && <View style={styles.score}><Text style={styles.scoreText}>{item.score}</Text></View>}</View>
      <View style={styles.metricRow}>{item.metrics.map((metric) => <Metric key={metric.label} label={metric.label} value={metric.value} positive={metric.tone === "positive"} negative={metric.tone === "negative"} />)}</View>
      {!!item.footer && <Text style={styles.cardFoot}>{item.footer}</Text>}
    </Pressable>} />
  </View>;
}

function CardDetail({ card, market, onBack }: { card: ScreenCard; market: Market; onBack: () => void }) {
  const [buying, setBuying] = useState(false); const [notice, setNotice] = useState("");
  return <ScrollView contentContainerStyle={styles.detail}>
    <Pressable onPress={onBack}><Text style={styles.link}>Back</Text></Pressable>
    <Text style={styles.detailTicker}>{card.title}</Text><Text style={styles.meta}>{card.subtitle}</Text>
    {card.badge && <View style={styles.detailBadge}><TonePill label={card.badge.label} tone={card.badge.tone} /></View>}
    {!!card.chartTicker && <PriceChart market={market} ticker={card.chartTicker} />}
    <View style={styles.metricGrid}>{card.metrics.map((metric) => <Metric key={metric.label} label={metric.label} value={metric.value} positive={metric.tone === "positive"} negative={metric.tone === "negative"} />)}{card.score !== null && <Metric label="SCORE" value={card.score} />}</View>
    {!!card.guidance && <Text style={styles.guidance}>{card.guidance}</Text>}
    {card.trade && <Action label="Log purchased trade" onPress={() => setBuying(true)} />}
    {!!notice && <Text style={styles.success}>{notice}</Text>}
    {card.sections.map((section) => <View key={section.title}><Text style={styles.sectionTitle}>{section.title}</Text>{section.rows.map((row, index) => <View key={`${row.label}:${index}`} style={styles.gate}>
      {row.passed !== undefined && <Text style={row.passed ? styles.good : styles.bad}>{row.passed ? "PASS" : "WAIT"}</Text>}
      <View style={styles.gateText}><View style={styles.rowBetween}><Text style={[styles.gateLabel, styles.flex]}>{row.label}</Text>{!!row.value && <Text style={styles.rowValue}>{row.value}</Text>}</View>{!!row.detail && <Text style={styles.muted}>{row.detail}</Text>}</View>
    </View>)}</View>)}
    {card.trade && <TradeEntrySheet visible={buying} trade={card.trade} market={market} onClose={() => setBuying(false)} onSaved={() => { setBuying(false); setNotice("Trade recorded in your ledger with this frozen plan."); }} />}
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
function Field({ value, onChangeText, placeholder, keyboard }: { value: string; onChangeText: (value: string) => void; placeholder: string; keyboard?: "decimal-pad" }) { return <TextInput style={styles.input} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor="#697078" autoCapitalize="none" autoCorrect={false} keyboardType={keyboard} />; }
const TonePill = ({ label, tone }: { label: string; tone: ScreenTone }) => <View style={[styles.statePill, tone === "positive" ? styles.stateFavored : tone === "negative" ? styles.stateRisk : tone === "warning" ? styles.stateCaution : null]}><Text style={styles.stateText}>{label.toUpperCase()}</Text></View>;

const styles = StyleSheet.create({
  flex: { flex: 1 }, screenHead: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 12, gap: 5 }, title: { color: "#f7f8fa", fontSize: 27, fontWeight: "900" }, muted: { color: "#858c95", fontSize: 14, lineHeight: 21 }, summary: { color: "#697078", fontSize: 10, paddingHorizontal: 18, paddingBottom: 8 }, notice: { color: "#fbbf24", fontSize: 11, paddingHorizontal: 18, paddingBottom: 8 }, errorBanner: { color: "#fecdd3", backgroundColor: "#35131d", marginHorizontal: 18, marginBottom: 10, padding: 12, borderRadius: 7 }, errorText: { color: "#fb7185" },
  chipBar: { flexGrow: 0, flexShrink: 0 }, chips: { paddingHorizontal: 14, paddingBottom: 8, gap: 8 }, chip: { borderWidth: 1, borderColor: "#252b33", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7 }, chipActive: { backgroundColor: "#102a22", borderColor: "#2b8c70" }, chipText: { color: "#858c95", fontSize: 12, fontWeight: "700" }, chipTextActive: { color: "#6ee7b7", fontSize: 12, fontWeight: "900" }, searchRow: { paddingHorizontal: 14, paddingBottom: 8 }, input: { color: "#f7f8fa", backgroundColor: "#0c1015", borderColor: "#242a32", borderWidth: 1, borderRadius: 8, paddingHorizontal: 15, height: 52 },
  list: { padding: 14, gap: 10, paddingBottom: 28 }, empty: { padding: 50, alignItems: "center" }, card: { backgroundColor: "#0b0f14", borderColor: "#252b33", borderWidth: 1, borderRadius: 8, padding: 15, gap: 14 }, rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }, ticker: { color: "#f8fafc", fontSize: 19, fontWeight: "900" }, meta: { color: "#707780", fontSize: 12, marginTop: 3 }, score: { minWidth: 43, height: 32, paddingHorizontal: 8, alignItems: "center", justifyContent: "center", borderRadius: 16, backgroundColor: "#103126" }, scoreText: { color: "#6ee7b7", fontWeight: "900" }, cardFoot: { color: "#949ba4", fontSize: 12 },
  metricRow: { flexDirection: "row", gap: 8 }, metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginVertical: 18 }, metric: { flex: 1, minWidth: 88, backgroundColor: "#080b0f", borderRadius: 6, padding: 10 }, metricLabel: { color: "#656c75", fontSize: 10, fontWeight: "700" }, metricValue: { color: "#e5e7eb", fontSize: 14, fontWeight: "800", marginTop: 5 }, goodValue: { color: "#34d399" }, badValue: { color: "#fb7185" },
  detail: { padding: 20, paddingBottom: 50 }, detailTicker: { color: "#f8fafc", fontSize: 34, fontWeight: "900", marginTop: 22 }, detailBadge: { flexDirection: "row", marginTop: 10 }, guidance: { color: "#e5e7eb", backgroundColor: "#0b0f14", borderColor: "#252b33", borderWidth: 1, borderRadius: 7, padding: 12, lineHeight: 20, marginBottom: 6 }, success: { color: "#6ee7b7", marginTop: 12 }, sectionTitle: { color: "#f8fafc", fontSize: 18, fontWeight: "900", marginTop: 8, marginBottom: 10 }, gate: { flexDirection: "row", gap: 12, borderTopWidth: 1, borderTopColor: "#1c2229", paddingVertical: 13 }, gateText: { flex: 1 }, gateLabel: { color: "#e5e7eb", fontWeight: "800", marginBottom: 3 }, good: { color: "#34d399", fontSize: 11, fontWeight: "900", width: 38 }, bad: { color: "#fbbf24", fontSize: 11, fontWeight: "900", width: 38 }, rowValue: { color: "#e5e7eb", fontWeight: "800" },
  statePill: { borderRadius: 12, borderWidth: 1, borderColor: "#343a43", paddingHorizontal: 8, paddingVertical: 5 }, stateFavored: { borderColor: "#23835f", backgroundColor: "#0d2c21" }, stateRisk: { borderColor: "#9f2942", backgroundColor: "#35131d" }, stateCaution: { borderColor: "#8a6417", backgroundColor: "#30250d" }, stateText: { color: "#d5dae0", fontSize: 9, fontWeight: "900" }, link: { color: "#5eead4", fontWeight: "700" }, chart: { height: 120, marginTop: 18, backgroundColor: "#080b0f", borderRadius: 8, overflow: "hidden" }, chartCaption: { color: "#646b74", fontSize: 10, marginTop: 6 },
  primary: { backgroundColor: "#34d399", borderRadius: 8, minHeight: 52, alignItems: "center", justifyContent: "center", marginVertical: 4 }, primaryText: { color: "#04110d", fontSize: 15, fontWeight: "900" }, modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.72)" }, sheet: { backgroundColor: "#0b0f14", borderTopLeftRadius: 12, borderTopRightRadius: 12, borderColor: "#2a3038", borderWidth: 1, padding: 20, paddingBottom: 36, gap: 12 },
});
