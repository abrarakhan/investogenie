import { Fragment, Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, AppState, FlatList, Modal, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import Svg, { Line, Rect } from "react-native-svg";
import {
  apiConfigurationError, createMutationKey, createTrade, getCandles, getScreen, getScreenCatalog,
  login, logout, restoreSession, type CandlePoint,
  type Market, type MobileScreen, type MobileUser, type ScreenCard,
  type ScreenTone, type TradeAction,
} from "./src/api";
import { registerDeviceNotifications, unlockWithBiometrics } from "./src/deviceSecurity";
import { MOBILE_FEATURES, supportedMobileFeatures } from "./src/features/registry";

/** A screen key from the server catalog. */
type Tab = string;
/** Screens with dedicated views here; every other catalog entry renders as server-built cards. */
const NATIVE_SCREENS: Record<string, (props: { market: Market }) => React.JSX.Element> = {
  "news-swing": ({ market }) => <Suspense fallback={<Centered><ActivityIndicator color="#34d399" /></Centered>}><LazyNewsSwing market={market} /></Suspense>,
  "trade-ledger": ({ market }) => <Suspense fallback={<Centered><ActivityIndicator color="#34d399" /></Centered>}><LazyTradeLedger market={market} /></Suspense>,
};
const LazyNewsSwing = lazy(() => import("./src/features/NewsSwing"));
const LazyTradeLedger = lazy(() => import("./src/features/TradeLedger"));
/** The market's own calendar date. A UTC date is a day behind in India before 05:30 IST. */
const today = (market: Market) => new Intl.DateTimeFormat("en-CA", {
  timeZone: market === "IN" ? "Asia/Kolkata" : "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
/** Accept "1,000.50" or "1 000" as typed amounts; anything else is NaN for the server to reject. */
const amount = (text: string) => Number(text.replace(/[,\s]/g, ""));
const money = (value: number, market: Market) => new Intl.NumberFormat(market === "IN" ? "en-IN" : "en-US", {
  style: "currency", currency: market === "IN" ? "INR" : "USD", maximumFractionDigits: 2,
}).format(value);
const message = (cause: unknown, fallback: string) => cause instanceof Error ? cause.message : fallback;

export default function App() {
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState("");
  const [user, setUser] = useState<MobileUser | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [requestedTab, setRequestedTab] = useState<Tab | null>(null);
  const backgroundedAt = useRef<number | null>(null);
  const unlock = useCallback(async () => setUnlocked(await unlockWithBiometrics()), []);
  // State changes here happen only in callbacks; `retry` resets the boot screen first.
  const boot = useCallback(() => {
    void restoreSession().then(async (restored) => {
      setUser(restored);
      if (restored) setUnlocked(await unlockWithBiometrics());
      else setUnlocked(true);
    }).catch((cause) => {
      // Offline or a server outage: keep the saved session and offer a retry.
      setBootError(message(cause, "InvestoGenie could not be reached."));
    }).finally(() => setBooting(false));
  }, []);
  useEffect(() => { boot(); }, [boot]);
  const retry = () => { setBooting(true); setBootError(""); boot(); };
  useEffect(() => {
    const response = Notifications.addNotificationResponseReceivedListener((notificationResponse) => {
      const screen = notificationResponse.notification.request.content.data?.screen;
      // Choose the tab only. Opening from a notification must still pass the biometric lock.
      setRequestedTab(screen === "strong-swing" ? "strong-swing" : "trade-ledger");
    });
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "background") backgroundedAt.current = Date.now();
      if (state === "active" && user && backgroundedAt.current && Date.now() - backgroundedAt.current > 60_000) {
        setUnlocked(false);
        void unlock();
      }
    });
    return () => { response.remove(); appState.remove(); };
  }, [unlock, user]);
  if (booting) return <Centered><ActivityIndicator color="#34d399" /></Centered>;
  if (bootError) return <Centered><Text style={styles.title}>Offline</Text><Text style={[styles.muted, styles.centerText]}>{bootError}</Text><Action label="Retry" onPress={retry} /></Centered>;
  if (user && !unlocked) return <Centered><Text style={styles.title}>InvestoGenie locked</Text><Action label="Unlock" onPress={() => void unlock()} /></Centered>;
  return <SafeAreaProvider><SafeAreaView style={styles.safe} edges={["top", "right", "bottom", "left"]}><StatusBar style="light" />{
    user ? <Terminal user={user} requestedTab={requestedTab} onRequestedTabHandled={() => setRequestedTab(null)} onLogout={() => logout().then(() => setUser(null))} /> : <Login onLogin={(next) => { setUser(next); setUnlocked(true); }} />
  }</SafeAreaView></SafeAreaProvider>;
}

function Login({ onLogin }: { onLogin: (user: MobileUser) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const configurationError = apiConfigurationError();
  const submit = async () => {
    setBusy(true); setError("");
    try { onLogin(await login(email.trim(), password)); }
    catch (cause) { setError(message(cause, "Sign in failed")); }
    finally { setBusy(false); }
  };
  return <ScrollView contentContainerStyle={styles.login} keyboardShouldPersistTaps="handled">
    <Text style={styles.brand}>Investo<Text style={styles.accent}>Genie</Text></Text>
    <Text style={styles.eyebrow}>MOBILE TERMINAL</Text><Text style={styles.title}>Sign in</Text>
    <Text style={styles.muted}>Use the same account as the InvestoGenie web terminal.</Text>
    {!!configurationError && <Text style={styles.error}>{configurationError}</Text>}
    <Field value={email} onChangeText={setEmail} placeholder="Email" keyboard="email-address" autofill="username" />
    <Field value={password} onChangeText={setPassword} placeholder="Password" secure autofill="password" />
    {!!error && <Text style={styles.error}>{error}</Text>}
    <Action label="Open terminal" busy={busy} disabled={!!configurationError} onPress={submit} />
  </ScrollView>;
}

function Terminal({ user, requestedTab, onRequestedTabHandled, onLogout }: { user: MobileUser; requestedTab: Tab | null; onRequestedTabHandled: () => void; onLogout: () => void }) {
  const [market, setMarket] = useState<Market>("IN");
  const [tab, setTab] = useState<Tab>("strong-swing");
  const [screens, setScreens] = useState(MOBILE_FEATURES);
  useEffect(() => { void getScreenCatalog().then((result) => { const supported = supportedMobileFeatures(result.screens); if (supported.length) setScreens(supported); }).catch(() => undefined); }, []);
  const [notificationStatus, setNotificationStatus] = useState("");
  useEffect(() => { void registerDeviceNotifications().then(setNotificationStatus).catch(() => setNotificationStatus("Push registration is temporarily unavailable.")); }, []);
  const requested = requestedTab ?? tab;
  const active = screens.find((screen) => screen.key === requested) ?? screens[0];
  const selectTab = (next: Tab) => { setTab(next); onRequestedTabHandled(); };
  return <View style={styles.flex}>
    <View style={styles.header}><View><Text style={styles.brandSmall}>Investo<Text style={styles.accent}>Genie</Text></Text><Text style={styles.user}>{user.email}</Text></View><Pressable onPress={onLogout}><Text style={styles.link}>Sign out</Text></Pressable></View>
    <View style={styles.switchRow}>{(["IN", "US"] as Market[]).map((value) => <Pressable key={value} onPress={() => setMarket(value)} style={[styles.switch, market === value && styles.switchActive]}><Text style={market === value ? styles.switchTextActive : styles.switchText}>{value === "IN" ? "India" : "US"}</Text></Pressable>)}</View>
    <View style={styles.tabs}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabScroll}>{screens.map((screen) => <TabButton key={screen.key} active={active.key === screen.key} label={screen.tabLabel} onPress={() => selectTab(screen.key)} />)}</ScrollView></View>
    {!!notificationStatus && <Text style={styles.deviceStatus}>{notificationStatus}</Text>}
    <View style={styles.flex}>{active.kind === "native" && NATIVE_SCREENS[active.key] ? <Fragment key={`${active.key}:${market}`}>{NATIVE_SCREENS[active.key]({ market })}</Fragment> : <CardScreen key={`${active.key}:${market}`} screenKey={active.key} title={active.title} market={market} />}</View>
  </View>;
}

/** Renders any server-built screen: option chips, optional search, cards and a card detail view. */
function CardScreen({ screenKey, title, market }: { screenKey: string; title: string; market: Market }) {
  const [screen, setScreen] = useState<MobileScreen | null>(null);
  const [params, setParams] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ScreenCard | null>(null);
  const [refreshing, setRefreshing] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  // Bumped to refetch; a response is applied only while its request is still the latest.
  const [reloads, setReloads] = useState(0);
  useEffect(() => {
    let active = true;
    getScreen(screenKey, market, params).then((result) => { if (active) setScreen(result); })
      .catch((cause) => { if (active) setError(message(cause, `Could not load ${title}`)); })
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
      .catch((cause) => setError(message(cause, `Could not load more ${title}`)))
      .finally(() => setLoadingMore(false));
  }, [loadingMore, market, params, screen?.pagination?.nextCursor, screenKey, title]);
  useEffect(() => { const timer = setInterval(load, 300_000); return () => clearInterval(timer); }, [load]);
  if (selected) return <CardDetail card={selected} market={market} onBack={() => setSelected(null)} />;
  const setParam = (param: string, value: string) => { setRefreshing(true); setError(""); setParams((current) => ({ ...current, [param]: value })); };
  return <View style={styles.flex}>
    <ScreenHead title={screen?.title ?? title} subtitle={screen?.subtitle ?? "Loading from the server."} />
    {!!screen?.summary && <Text style={styles.newsSummary}>{screen.summary}</Text>}
    {!!screen?.notice && <Text style={styles.screenNotice}>{screen.notice}</Text>}
    {screen?.options.map((option) => <ScrollView key={option.param} horizontal showsHorizontalScrollIndicator={false} style={styles.chipBar} contentContainerStyle={styles.chips}>
      {option.choices.map((choice) => <Pressable key={choice.value} onPress={() => setParam(option.param, choice.value)} style={[styles.chip, (params[option.param] ?? option.value) === choice.value && styles.chipActive]}><Text style={(params[option.param] ?? option.value) === choice.value ? styles.chipTextActive : styles.chipText}>{choice.label}</Text></Pressable>)}
    </ScrollView>)}
    {screen?.searchable && <View style={styles.searchRow}><TextInput style={styles.input} value={search} onChangeText={setSearch} onSubmitEditing={() => setParam("search", search.trim())} returnKeyType="search" placeholder="Search symbol or name" placeholderTextColor="#697078" autoCapitalize="characters" autoCorrect={false} /></View>}
    {!!error && <Banner text={error} />}
    <FlatList data={screen?.cards ?? []} keyExtractor={(item) => item.id} onEndReached={loadMore} onEndReachedThreshold={0.4} ListFooterComponent={loadingMore ? <ActivityIndicator color="#34d399" /> : null} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor="#34d399" />} contentContainerStyle={styles.list} ListEmptyComponent={!refreshing ? <Empty text="Nothing to show right now." /> : null} renderItem={({ item }) => <Pressable onPress={() => setSelected(item)} style={styles.card}>
      <View style={styles.rowBetween}><View style={styles.flex}><Text style={styles.ticker}>{item.title}</Text><Text numberOfLines={1} style={styles.meta}>{item.subtitle}</Text></View>{item.badge && <TonePill label={item.badge.label} tone={item.badge.tone} />}{item.score !== null && <View style={styles.score}><Text style={styles.scoreText}>{item.score}</Text></View>}</View>
      <View style={styles.metricRow}>{item.metrics.map((metric) => <Metric key={metric.label} label={metric.label} value={metric.value} positive={metric.tone === "positive"} negative={metric.tone === "negative"} />)}</View>
      {!!item.footer && <Text style={styles.cardFoot}>{item.footer}</Text>}
    </Pressable>} />
  </View>;
}

function CardDetail({ card, market, onBack }: { card: ScreenCard; market: Market; onBack: () => void }) {
  const [buying, setBuying] = useState(false);
  const [notice, setNotice] = useState("");
  return <ScrollView contentContainerStyle={styles.detail}>
    <Pressable onPress={onBack}><Text style={styles.link}>Back</Text></Pressable>
    <Text style={styles.detailTicker}>{card.title}</Text><Text style={styles.meta}>{card.subtitle}</Text>
    {card.badge && <View style={styles.detailBadge}><TonePill label={card.badge.label} tone={card.badge.tone} /></View>}
    {!!card.chartTicker && <PriceChart market={market} ticker={card.chartTicker} />}
    <View style={styles.metricGrid}>{card.metrics.map((metric) => <Metric key={metric.label} label={metric.label} value={metric.value} positive={metric.tone === "positive"} negative={metric.tone === "negative"} />)}{card.score !== null && <Metric label="SCORE" value={card.score} />}</View>
    {!!card.guidance && <Text style={styles.guidance}>{card.guidance}</Text>}
    {card.trade && <Action label="Log purchased trade" onPress={() => setBuying(true)} />}
    {!!notice && <Text style={styles.success}>{notice}</Text>}
    {card.sections.map((section) => <View key={section.title}><Text style={styles.sectionTitle}>{section.title}</Text>
      {section.rows.map((row, index) => <View key={`${row.label}:${index}`} style={styles.gate}>
        {row.passed !== undefined && <Text style={row.passed ? styles.good : styles.bad}>{row.passed ? "PASS" : "WAIT"}</Text>}
        <View style={styles.gateText}><View style={styles.rowBetween}><Text style={[styles.gateLabel, styles.flex]}>{row.label}</Text>{!!row.value && <Text style={styles.rowValue}>{row.value}</Text>}</View>{!!row.detail && <Text style={styles.muted}>{row.detail}</Text>}</View>
      </View>)}
    </View>)}
    {card.trade && <TradeEntrySheet visible={buying} trade={card.trade} market={market} onClose={() => setBuying(false)} onSaved={() => { setBuying(false); setNotice("Trade recorded in your ledger with this frozen plan."); }} />}
  </ScrollView>;
}

function PriceChart({ market, ticker }: { market: Market; ticker: string }) {
  const [points, setPoints] = useState<CandlePoint[]>([]);
  useEffect(() => { let active = true; getCandles(market, ticker).then((result) => { if (active) setPoints(result.candle?.points.slice(-50) ?? []); }).catch(() => undefined); return () => { active = false; }; }, [market, ticker]);
  if (!points.length) return <View style={styles.chart}><ActivityIndicator color="#34d399" /></View>;
  const low = Math.min(...points.map((point) => point.low)); const high = Math.max(...points.map((point) => point.high)); const span = Math.max(0.0001, high - low);
  const width = 340; const height = 120; const step = width / points.length; const bodyWidth = Math.max(2, step * 0.58);
  const y = (price: number) => 8 + ((high - price) / span) * (height - 16);
  return <View><View style={styles.chart}><Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
    {points.map((point, index) => { const x = index * step + step / 2; const rising = point.close >= point.open; const color = rising ? "#34d399" : "#fb7185"; const top = y(Math.max(point.open, point.close)); const bottom = y(Math.min(point.open, point.close)); return <Fragment key={point.date}><Line x1={x} x2={x} y1={y(point.high)} y2={y(point.low)} stroke={color} strokeWidth="1" /><Rect x={x - bodyWidth / 2} y={top} width={bodyWidth} height={Math.max(1.5, bottom - top)} fill={color} /></Fragment>; })}
  </Svg></View><Text style={styles.chartCaption}>50-session OHLC candles · {money(low, market)} to {money(high, market)}</Text></View>;
}

function TradeEntrySheet({ visible, trade, market, onClose, onSaved }: { visible: boolean; trade: TradeAction; market: Market; onClose: () => void; onSaved: () => void }) {
  const [date, setDate] = useState(today(market)); const [price, setPrice] = useState(String(trade.suggestedPrice)); const [quantity, setQuantity] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [idempotencyKey] = useState(createMutationKey);
  // Only the plan id goes to the server, which reads entry, target, stop, trail and horizon from it.
  const save = async () => { setBusy(true); setError(""); try { await createTrade({ assetId: trade.assetId, market, boughtOn: date, buyPrice: amount(price), quantity: amount(quantity), strategyKey: trade.strategyKey, planId: trade.planId }, idempotencyKey); onSaved(); } catch (cause) { setError(message(cause, "Trade could not be recorded")); } finally { setBusy(false); } };
  return <Sheet visible={visible} title={`Log ${trade.ticker}`} onClose={onClose}><Field value={date} onChangeText={setDate} placeholder="Purchase date YYYY-MM-DD" /><Field value={price} onChangeText={setPrice} placeholder="Buy price" keyboard="decimal-pad" /><Field value={quantity} onChangeText={setQuantity} placeholder="Quantity" keyboard="decimal-pad" />{!!error && <Text style={styles.error}>{error}</Text>}<Action label="Freeze plan and log trade" busy={busy} onPress={save} /></Sheet>;
}

function Sheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode }) { return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}><View style={styles.modalBackdrop}><View style={styles.sheet}><View style={styles.rowBetween}><Text style={styles.sectionTitle}>{title}</Text><Pressable onPress={onClose}><Text style={styles.link}>Close</Text></Pressable></View>{children}</View></View></Modal>; }
function Field({ value, onChangeText, placeholder, keyboard, secure, autofill }: { value: string; onChangeText: (value: string) => void; placeholder: string; keyboard?: "email-address" | "decimal-pad"; secure?: boolean; autofill?: "username" | "password" }) { return <TextInput style={styles.input} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor="#697078" autoCapitalize="none" autoCorrect={false} keyboardType={keyboard} secureTextEntry={secure} textContentType={autofill} autoComplete={autofill === "password" ? "current-password" : autofill} />; }
function Action({ label, onPress, busy = false, disabled = false }: { label: string; onPress: () => void; busy?: boolean; disabled?: boolean }) { return <Pressable style={[styles.primary, disabled && styles.disabled]} onPress={onPress} disabled={busy || disabled}>{busy ? <ActivityIndicator color="#04110d" /> : <Text style={styles.primaryText}>{label}</Text>}</Pressable>; }
const Centered = ({ children }: { children: React.ReactNode }) => <View style={styles.center}>{children}</View>;
const ScreenHead = ({ title, subtitle }: { title: string; subtitle: string }) => <View style={styles.screenHead}><Text style={styles.title}>{title}</Text><Text style={styles.muted}>{subtitle}</Text></View>;
const TabButton = ({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) => <Pressable style={[styles.tab, active && styles.tabActive]} onPress={onPress}><Text style={active ? styles.tabTextActive : styles.tabText}>{label}</Text></Pressable>;
const TonePill = ({ label, tone }: { label: string; tone: ScreenTone }) => <View style={[styles.statePill, tone === "positive" ? styles.stateFavored : tone === "negative" ? styles.stateRisk : tone === "warning" ? styles.stateCaution : null]}><Text style={styles.stateText}>{label.toUpperCase()}</Text></View>;
const Metric = ({ label, value, positive, negative }: { label: string; value: string; positive?: boolean; negative?: boolean }) => <View style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text numberOfLines={1} style={[styles.metricValue, positive && styles.goodValue, negative && styles.badValue]}>{value}</Text></View>;
const Empty = ({ text }: { text: string }) => <View style={styles.empty}><Text style={styles.muted}>{text}</Text></View>;
const Banner = ({ text }: { text: string }) => <Text style={styles.errorBanner}>{text}</Text>;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#05070a" }, flex: { flex: 1 }, centerText: { textAlign: "center", paddingHorizontal: 28 }, center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#05070a" },
  login: { flexGrow: 1, justifyContent: "center", padding: 28, gap: 14, backgroundColor: "#05070a" }, brand: { color: "#f7f8fa", fontSize: 30, fontWeight: "900" }, brandSmall: { color: "#f7f8fa", fontSize: 20, fontWeight: "900" }, accent: { color: "#34d399" }, eyebrow: { color: "#34d399", fontSize: 11, fontWeight: "800", letterSpacing: 3 },
  title: { color: "#f7f8fa", fontSize: 27, fontWeight: "900" }, muted: { color: "#858c95", fontSize: 14, lineHeight: 21 }, input: { color: "#f7f8fa", backgroundColor: "#0c1015", borderColor: "#242a32", borderWidth: 1, borderRadius: 8, paddingHorizontal: 15, height: 52 },
  error: { color: "#fb7185" }, success: { color: "#6ee7b7", marginTop: 12 }, warning: { color: "#fbbf24", borderColor: "#6b4d0d", borderWidth: 1, padding: 12, borderRadius: 7 }, primary: { backgroundColor: "#34d399", borderRadius: 8, minHeight: 52, alignItems: "center", justifyContent: "center", marginVertical: 4 }, disabled: { opacity: 0.45 }, primaryText: { color: "#04110d", fontSize: 15, fontWeight: "900" },
  header: { paddingHorizontal: 18, paddingVertical: 12, borderBottomColor: "#1d2229", borderBottomWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, user: { color: "#707780", fontSize: 10, marginTop: 2 }, link: { color: "#5eead4", fontWeight: "700" },
  switchRow: { flexDirection: "row", padding: 12, gap: 8 }, switch: { flex: 1, alignItems: "center", padding: 10, borderWidth: 1, borderColor: "#252b33", borderRadius: 7 }, switchActive: { backgroundColor: "#102a22", borderColor: "#2b8c70" }, switchText: { color: "#777f89", fontWeight: "800" }, switchTextActive: { color: "#6ee7b7", fontWeight: "900" },
  screenHead: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 12, gap: 5 }, errorBanner: { color: "#fecdd3", backgroundColor: "#35131d", marginHorizontal: 18, marginBottom: 10, padding: 12, borderRadius: 7 }, list: { padding: 14, gap: 10, paddingBottom: 28 },
  card: { backgroundColor: "#0b0f14", borderColor: "#252b33", borderWidth: 1, borderRadius: 8, padding: 15, gap: 14 }, rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }, ticker: { color: "#f8fafc", fontSize: 19, fontWeight: "900" }, meta: { color: "#707780", fontSize: 12, marginTop: 3 }, score: { minWidth: 43, height: 32, paddingHorizontal: 8, alignItems: "center", justifyContent: "center", borderRadius: 16, backgroundColor: "#103126" }, scoreText: { color: "#6ee7b7", fontWeight: "900" },
  metricRow: { flexDirection: "row", gap: 8 }, metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginVertical: 18 }, metric: { flex: 1, minWidth: 88, backgroundColor: "#080b0f", borderRadius: 6, padding: 10 }, metricLabel: { color: "#656c75", fontSize: 10, fontWeight: "700" }, metricValue: { color: "#e5e7eb", fontSize: 14, fontWeight: "800", marginTop: 5 }, goodValue: { color: "#34d399" }, badValue: { color: "#fb7185" }, warningValue: { color: "#fbbf24", fontSize: 11, fontWeight: "900" }, cardFoot: { color: "#949ba4", fontSize: 12 }, revisedPlan: { borderTopWidth: 1, borderTopColor: "#26313a", paddingTop: 12, gap: 9 }, revisedPlanTitle: { color: "#67e8f9", fontSize: 10, fontWeight: "900", letterSpacing: 1.1 },
  tabs: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#20252c", backgroundColor: "#080b0f", paddingHorizontal: 12, paddingBottom: 8, gap: 8 }, tabScroll: { gap: 6 }, tab: { alignItems: "center", paddingVertical: 11, paddingHorizontal: 14, borderRadius: 7 }, tabActive: { backgroundColor: "#123126" }, tabText: { color: "#727983", fontSize: 12, fontWeight: "800" }, tabTextActive: { color: "#6ee7b7", fontSize: 12, fontWeight: "900" },
  detail: { padding: 20, paddingBottom: 50 }, detailTicker: { color: "#f8fafc", fontSize: 34, fontWeight: "900", marginTop: 22 }, sectionTitle: { color: "#f8fafc", fontSize: 18, fontWeight: "900", marginTop: 8, marginBottom: 10 }, gate: { flexDirection: "row", gap: 12, borderTopWidth: 1, borderTopColor: "#1c2229", paddingVertical: 13 }, gateText: { flex: 1 }, gateLabel: { color: "#e5e7eb", fontWeight: "800", marginBottom: 3 }, good: { color: "#34d399", fontSize: 11, fontWeight: "900", width: 38 }, bad: { color: "#fbbf24", fontSize: 11, fontWeight: "900", width: 38 },
  summary: { paddingHorizontal: 14, paddingBottom: 8, gap: 8 }, summaryCard: { width: 140, backgroundColor: "#0b0f14", borderColor: "#252b33", borderWidth: 1, borderRadius: 8, padding: 12 }, summaryValue: { color: "#f8fafc", fontSize: 17, fontWeight: "900", marginTop: 5 }, empty: { padding: 50, alignItems: "center" },
  actions: { flexDirection: "row", gap: 8, borderTopWidth: 1, borderTopColor: "#1d2229", paddingTop: 10 }, smallAction: { minHeight: 40, justifyContent: "center", paddingHorizontal: 10 }, saleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#080b0f", borderRadius: 6, padding: 10 },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.72)" }, sheet: { backgroundColor: "#0b0f14", borderTopLeftRadius: 12, borderTopRightRadius: 12, borderColor: "#2a3038", borderWidth: 1, padding: 20, paddingBottom: 36, gap: 12 },
  chart: { height: 120, marginTop: 18, backgroundColor: "#080b0f", borderRadius: 8, overflow: "hidden" }, chartCaption: { color: "#646b74", fontSize: 10, marginTop: 6 }, deviceStatus: { color: "#6f7781", fontSize: 9, paddingHorizontal: 16, paddingBottom: 4 },
  chipBar: { flexGrow: 0, flexShrink: 0 }, chips: { paddingHorizontal: 14, paddingBottom: 8, gap: 8 }, chip: { borderWidth: 1, borderColor: "#252b33", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7 }, chipActive: { backgroundColor: "#102a22", borderColor: "#2b8c70" }, chipText: { color: "#858c95", fontSize: 12, fontWeight: "700" }, chipTextActive: { color: "#6ee7b7", fontSize: 12, fontWeight: "900" },
  searchRow: { paddingHorizontal: 14, paddingBottom: 8 }, screenNotice: { color: "#fbbf24", fontSize: 11, paddingHorizontal: 18, paddingBottom: 8 }, guidance: { color: "#e5e7eb", backgroundColor: "#0b0f14", borderColor: "#252b33", borderWidth: 1, borderRadius: 7, padding: 12, lineHeight: 20, marginBottom: 6 }, detailBadge: { flexDirection: "row", marginTop: 10 }, rowValue: { color: "#e5e7eb", fontWeight: "800" },
  newsSummary: { color: "#697078", fontSize: 10, paddingHorizontal: 18, paddingBottom: 8 }, evidence: { borderTopWidth: 1, borderTopColor: "#1d2229", paddingTop: 10, gap: 3 }, evidenceTitle: { color: "#e5e7eb", fontSize: 13, fontWeight: "700" }, statePill: { borderRadius: 12, borderWidth: 1, borderColor: "#343a43", paddingHorizontal: 8, paddingVertical: 5 }, stateFavored: { borderColor: "#23835f", backgroundColor: "#0d2c21" }, stateRisk: { borderColor: "#9f2942", backgroundColor: "#35131d" }, stateCaution: { borderColor: "#8a6417", backgroundColor: "#30250d" }, stateText: { color: "#d5dae0", fontSize: 9, fontWeight: "900" },
});
