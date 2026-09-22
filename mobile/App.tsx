import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, AppState, FlatList, Linking, Modal, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import Svg, { Line, Rect } from "react-native-svg";
import {
  apiConfigurationError, createTrade, deleteTrade, getCandles, getLedger, getNewsSwing, getStrongSwing, login, logout, recordSale,
  restoreSession, updateSale, updateTrade, type CandlePoint, type LedgerSummary, type LedgerTrade,
  type Market, type MobileUser, type NewsSwingCandidate, type StrongCandidate,
} from "./src/api";
import { registerDeviceNotifications, unlockWithBiometrics } from "./src/deviceSecurity";

type Tab = "strong" | "news" | "ledger";
const today = () => new Date().toISOString().slice(0, 10);
const money = (value: number, market: Market) => new Intl.NumberFormat(market === "IN" ? "en-IN" : "en-US", {
  style: "currency", currency: market === "IN" ? "INR" : "USD", maximumFractionDigits: 2,
}).format(value);
const pct = (value: number | null) => value === null ? "--" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
const message = (cause: unknown, fallback: string) => cause instanceof Error ? cause.message : fallback;

export default function App() {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<MobileUser | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [requestedTab, setRequestedTab] = useState<Tab | null>(null);
  const backgroundedAt = useRef<number | null>(null);
  const unlock = useCallback(async () => setUnlocked(await unlockWithBiometrics()), []);
  useEffect(() => {
    restoreSession().then(async (restored) => {
      setUser(restored);
      if (restored) setUnlocked(await unlockWithBiometrics());
      else setUnlocked(true);
    }).finally(() => setBooting(false));
  }, []);
  useEffect(() => {
    const response = Notifications.addNotificationResponseReceivedListener(() => {
      setRequestedTab("ledger");
      setUnlocked(true);
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
    try { onLogin(await login(email, password)); }
    catch (cause) { setError(message(cause, "Sign in failed")); }
    finally { setBusy(false); }
  };
  return <ScrollView contentContainerStyle={styles.login} keyboardShouldPersistTaps="handled">
    <Text style={styles.brand}>Investo<Text style={styles.accent}>Genie</Text></Text>
    <Text style={styles.eyebrow}>MOBILE TERMINAL</Text><Text style={styles.title}>Sign in</Text>
    <Text style={styles.muted}>Use the same account as the InvestoGenie web terminal.</Text>
    {!!configurationError && <Text style={styles.error}>{configurationError}</Text>}
    <Field value={email} onChangeText={setEmail} placeholder="Email" keyboard="email-address" />
    <Field value={password} onChangeText={setPassword} placeholder="Password" secure />
    {!!error && <Text style={styles.error}>{error}</Text>}
    <Action label="Open terminal" busy={busy} disabled={!!configurationError} onPress={submit} />
  </ScrollView>;
}

function Terminal({ user, requestedTab, onRequestedTabHandled, onLogout }: { user: MobileUser; requestedTab: Tab | null; onRequestedTabHandled: () => void; onLogout: () => void }) {
  const [market, setMarket] = useState<Market>("IN");
  const [tab, setTab] = useState<Tab>("strong");
  const [notificationStatus, setNotificationStatus] = useState("");
  useEffect(() => { void registerDeviceNotifications().then(setNotificationStatus).catch(() => setNotificationStatus("Push registration is temporarily unavailable.")); }, []);
  const activeTab = requestedTab ?? tab;
  const selectTab = (next: Tab) => { setTab(next); onRequestedTabHandled(); };
  return <View style={styles.flex}>
    <View style={styles.header}><View><Text style={styles.brandSmall}>Investo<Text style={styles.accent}>Genie</Text></Text><Text style={styles.user}>{user.email}</Text></View><Pressable onPress={onLogout}><Text style={styles.link}>Sign out</Text></Pressable></View>
    <View style={styles.switchRow}>{(["IN", "US"] as Market[]).map((value) => <Pressable key={value} onPress={() => setMarket(value)} style={[styles.switch, market === value && styles.switchActive]}><Text style={market === value ? styles.switchTextActive : styles.switchText}>{value === "IN" ? "India" : "US"}</Text></Pressable>)}</View>
    <View style={styles.tabs}><TabButton active={activeTab === "strong"} label="Strong" onPress={() => selectTab("strong")} /><TabButton active={activeTab === "news"} label="News & AI" onPress={() => selectTab("news")} /><TabButton active={activeTab === "ledger"} label="Ledger" onPress={() => selectTab("ledger")} /></View>
    {!!notificationStatus && <Text style={styles.deviceStatus}>{notificationStatus}</Text>}
    <View style={styles.flex}>{activeTab === "strong" ? <Strong key={market} market={market} /> : activeTab === "news" ? <NewsSwing key={market} market={market} /> : <Ledger key={market} market={market} />}</View>
  </View>;
}

function Strong({ market }: { market: Market }) {
  const [rows, setRows] = useState<StrongCandidate[]>([]);
  const [selected, setSelected] = useState<StrongCandidate | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setRefreshing(true); setError("");
    try { setRows((await getStrongSwing(market)).candidates); }
    catch (cause) { setError(message(cause, "Could not load candidates")); }
    finally { setRefreshing(false); }
  }, [market]);
  useEffect(() => { let active = true; getStrongSwing(market).then((result) => { if (active) setRows(result.candidates); }).catch((cause) => { if (active) setError(message(cause, "Could not load candidates")); }).finally(() => { if (active) setRefreshing(false); }); return () => { active = false; }; }, [market]);
  useEffect(() => { const timer = setInterval(load, 300_000); return () => clearInterval(timer); }, [load]);
  if (selected) return <CandidateDetail row={selected} market={market} onBack={() => setSelected(null)} />;
  return <View style={styles.flex}><ScreenHead title="Strong Swing" subtitle="Server-ranked confirmation. Pull down for the latest quotes and gates." />{!!error && <Banner text={error} />}
    <FlatList data={rows} keyExtractor={(item) => item.assetId} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor="#34d399" />} contentContainerStyle={styles.list} ListEmptyComponent={!refreshing ? <Empty text="No candidates available." /> : null} renderItem={({ item }) => <Pressable onPress={() => setSelected(item)} style={styles.card}>
      <View style={styles.rowBetween}><View><Text style={styles.ticker}>#{item.strongSwingRank} {item.ticker}</Text><Text style={styles.meta}>{item.exchange || market} · {item.status.replaceAll("_", " ")}</Text></View><Score value={item.strengthScore} /></View>
      <View style={styles.metricRow}><Metric label="ENTRY" value={money(item.strongEntry, market)} /><Metric label="TARGET" value={money(item.strongTarget, market)} positive /><Metric label="STOP" value={money(item.strongStop, market)} negative /></View>
      <Text style={styles.cardFoot}>Current {money(item.lastQuote ?? item.latestClose, market)} · {item.strongExpectedDays} sessions</Text>
    </Pressable>} />
  </View>;
}

function CandidateDetail({ row, market, onBack }: { row: StrongCandidate; market: Market; onBack: () => void }) {
  const [buying, setBuying] = useState(false);
  const [notice, setNotice] = useState("");
  return <ScrollView contentContainerStyle={styles.detail}>
    <Pressable onPress={onBack}><Text style={styles.link}>Back to candidates</Text></Pressable>
    <Text style={styles.detailTicker}>{row.ticker}</Text><Text style={styles.meta}>{row.exchange || market} · EOD {row.latestDate}</Text>
    <PriceChart market={market} ticker={row.ticker} />
    <View style={styles.metricGrid}><Metric label="CURRENT" value={money(row.lastQuote ?? row.latestClose, market)} /><Metric label="ENTRY" value={money(row.strongEntry, market)} /><Metric label="TARGET" value={money(row.strongTarget, market)} positive /><Metric label="STOP" value={money(row.strongStop, market)} negative /><Metric label="TRAIL" value={money(row.strongTrail, market)} /><Metric label="SCORE" value={row.strengthScore.toFixed(0)} /></View>
    {row.status === "EXECUTION_READY" ? <Action label="Log purchased trade" onPress={() => setBuying(true)} /> : <Text style={styles.warning}>Buying remains disabled until the server returns EXECUTION READY.</Text>}
    {!!notice && <Text style={styles.success}>{notice}</Text>}
    <Text style={styles.sectionTitle}>Confirmation gates</Text>
    {row.gates.map((gate) => <View key={gate.key} style={styles.gate}><Text style={gate.passed ? styles.good : styles.bad}>{gate.passed ? "PASS" : "WAIT"}</Text><View style={styles.gateText}><Text style={styles.gateLabel}>{gate.label}</Text><Text style={styles.muted}>{gate.detail}</Text></View></View>)}
    <TradeEntrySheet visible={buying} row={row} market={market} onClose={() => setBuying(false)} onSaved={() => { setBuying(false); setNotice("Trade recorded in your ledger with this frozen Strong Swing plan."); }} />
  </ScrollView>;
}

function NewsSwing({ market }: { market: Market }) {
  const [rows, setRows] = useState<NewsSwingCandidate[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState({ articles: 0, impacts: 0, fetchedAt: null as string | null });
  const load = useCallback(async () => {
    setRefreshing(true); setError("");
    try {
      const result = await getNewsSwing(market);
      setRows(result.candidates);
      setSummary({ articles: result.articleCount, impacts: result.impactCount, fetchedAt: result.lastFetchedAt });
    } catch (cause) { setError(message(cause, "Could not load News & AI Swing")); }
    finally { setRefreshing(false); }
  }, [market]);
  useEffect(() => {
    let active = true;
    getNewsSwing(market).then((result) => {
      if (!active) return;
      setRows(result.candidates);
      setSummary({ articles: result.articleCount, impacts: result.impactCount, fetchedAt: result.lastFetchedAt });
    }).catch((cause) => { if (active) setError(message(cause, "Could not load News & AI Swing")); });
    return () => { active = false; };
  }, [market]);
  useEffect(() => { const timer = setInterval(load, 300_000); return () => clearInterval(timer); }, [load]);
  return <View style={styles.flex}><ScreenHead title="News & AI Swing" subtitle="Existing Strong Swing setups in the exact server-ranked News & AI order." />
    <Text style={styles.newsSummary}>{summary.articles} articles · {summary.impacts} impacts · {summary.fetchedAt ? `fetched ${new Date(summary.fetchedAt).toLocaleString()}` : "awaiting news sync"}</Text>
    {!!error && <Banner text={error} />}
    <FlatList data={rows} keyExtractor={(item) => item.assetId} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor="#34d399" />} contentContainerStyle={styles.list} ListEmptyComponent={!refreshing ? <Empty text="No News & AI candidates available." /> : null} renderItem={({ item, index }) => <View style={styles.card}>
      <View style={styles.rowBetween}><View><Text style={styles.ticker}>#{index + 1} {item.ticker}</Text><Text style={styles.meta}>Strong rank #{item.strongSwingRank} · {item.status.replaceAll("_", " ")}</Text></View><StatePill state={item.state} /></View>
      <View style={styles.metricRow}><Metric label="TECHNICAL" value={item.technicalScore.toFixed(1)} /><Metric label="NEWS" value={`${item.newsAdjustment >= 0 ? "+" : ""}${item.newsAdjustment.toFixed(1)}`} positive={item.newsAdjustment > 0} negative={item.newsAdjustment < 0} /><Metric label="COMBINED" value={item.combinedScore.toFixed(1)} /></View>
      <View style={styles.metricRow}><Metric label="ENTRY" value={money(item.strongEntry, market)} /><Metric label="TARGET" value={money(item.strongTarget, market)} positive /><Metric label="STOP" value={money(item.strongStop, market)} negative /></View>
      {item.news.slice(0, 3).map((evidence) => <Pressable key={`${evidence.articleId}:${evidence.direction}`} onPress={() => void Linking.openURL(evidence.url)} style={styles.evidence}><Text style={evidence.direction === "POSITIVE" ? styles.goodValue : evidence.direction === "NEGATIVE" ? styles.badValue : styles.meta}>{evidence.direction} · {evidence.sourceName ?? "Source"}</Text><Text numberOfLines={2} style={styles.evidenceTitle}>{evidence.title}</Text><Text numberOfLines={2} style={styles.meta}>{evidence.rationale}</Text></Pressable>)}
    </View>} />
  </View>;
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

function Ledger({ market }: { market: Market }) {
  const [trades, setTrades] = useState<LedgerTrade[]>([]); const [summary, setSummary] = useState<LedgerSummary | null>(null);
  const [refreshing, setRefreshing] = useState(false); const [error, setError] = useState("");
  const [editing, setEditing] = useState<LedgerTrade | null>(null); const [selling, setSelling] = useState<LedgerTrade | null>(null);
  const [editingSale, setEditingSale] = useState<{ trade: LedgerTrade; sale: LedgerTrade["exits"][number] } | null>(null);
  const load = useCallback(async () => { setRefreshing(true); setError(""); try { const result = await getLedger(market); setTrades(result.trades); setSummary(result.summary); } catch (cause) { setError(message(cause, "Could not load ledger")); } finally { setRefreshing(false); } }, [market]);
  useEffect(() => { let active = true; getLedger(market).then((result) => { if (active) { setTrades(result.trades); setSummary(result.summary); } }).catch((cause) => { if (active) setError(message(cause, "Could not load ledger")); }).finally(() => { if (active) setRefreshing(false); }); return () => { active = false; }; }, [market]);
  useEffect(() => { const timer = setInterval(load, 300_000); return () => clearInterval(timer); }, [load]);
  const remove = (trade: LedgerTrade) => Alert.alert("Delete trade?", `${trade.ticker} and its sale history will be removed.`, [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => deleteTrade(trade.id).then(load).catch((cause) => setError(message(cause, "Delete failed"))) }]);
  return <View style={styles.flex}><ScreenHead title="Trade Ledger" subtitle="Edit entries and record partial or final sales without changing the frozen projection." />
    {summary && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.summary}><Summary label="OPEN" value={String(summary.openCount)} /><Summary label="CAPITAL" value={money(summary.capitalEmployedValue, market)} /><Summary label="UNREALIZED" value={money(summary.unrealizedPnlValue, market)} /><Summary label="REALIZED" value={money(summary.realizedPnlValue, market)} /><Summary label="OVERALL" value={money(summary.overallPnlValue, market)} /><Summary label="ROI" value={pct(summary.roiPct)} /><Summary label="XIRR" value={pct(summary.xirrPct)} /></ScrollView>}{!!error && <Banner text={error} />}
    <FlatList data={trades} keyExtractor={(item) => item.id} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor="#34d399" />} contentContainerStyle={styles.list} ListEmptyComponent={!refreshing ? <Empty text="No trades in this market." /> : null} renderItem={({ item }) => <View style={styles.card}>
      <View style={styles.rowBetween}><View><Text style={styles.ticker}>{item.ticker}</Text><Text style={styles.meta}>{item.status} · bought {item.boughtOn}</Text></View><Text style={item.progress.pnlPct !== null && item.progress.pnlPct >= 0 ? styles.goodValue : styles.badValue}>{pct(item.progress.pnlPct)}</Text></View>
      <View style={styles.metricRow}><Metric label="BUY" value={money(item.buyPrice, market)} /><Metric label="CURRENT" value={item.currentPrice === null ? "STALE" : money(item.currentPrice, market)} /><Metric label="TARGET" value={money(item.projectedTarget, market)} positive /></View>
      {item.status === "OPEN" && <View style={styles.revisedPlan}>
        <View style={styles.rowBetween}><Text style={styles.revisedPlanTitle}>LIVE REVISED PLAN</Text><Text style={item.revisedPlan.action === "EXIT" ? styles.badValue : item.revisedPlan.action === "EXTEND_RUNNER" ? styles.goodValue : styles.warningValue}>{item.revisedPlan.label.toUpperCase()}</Text></View>
        <Text style={item.revisedPlan.action === "EXIT" ? styles.badValue : styles.evidenceTitle}>{item.revisedPlan.action === "EXIT" ? `ACTION NOW: Exit the remaining ${item.remainingQuantity} shares at the next executable market price. Do not wait for the old target.` : item.revisedPlan.action === "EXTEND_RUNNER" ? `ACTION NOW: Hold toward ${item.revisedPlan.revisedTarget === null ? "--" : money(item.revisedPlan.revisedTarget, market)} while protecting at ${item.revisedPlan.protectiveStop === null ? "--" : money(item.revisedPlan.protectiveStop, market)}.` : item.revisedPlan.action === "PROTECT_RECOVERY" ? `ACTION NOW: Hold only above ${item.revisedPlan.protectiveStop === null ? "--" : money(item.revisedPlan.protectiveStop, market)}; exit the remaining shares if that level trades.` : `ACTION NOW: Follow the displayed target and protection level for the remaining ${item.remainingQuantity} shares.`}</Text>
        <View style={styles.metricRow}><Metric label="REVISED OBJECTIVE" value={item.revisedPlan.revisedTarget === null ? "--" : money(item.revisedPlan.revisedTarget, market)} positive={item.revisedPlan.revisedTarget !== null} /><Metric label={item.revisedPlan.action === "EXIT" ? "OLD STOP · REFERENCE" : "PROTECT AT"} value={item.revisedPlan.action === "EXIT" || item.revisedPlan.protectiveStop === null ? "--" : money(item.revisedPlan.protectiveStop, market)} negative={false} /><Metric label="UPSIDE LEFT" value={pct(item.revisedPlan.remainingUpsidePct)} positive={(item.revisedPlan.remainingUpsidePct ?? 0) > 0} /></View>
        <Text style={styles.cardFoot}>{item.revisedPlan.reasons[0]}</Text>
      </View>}
      <Text style={styles.cardFoot}>{item.remainingQuantity} remaining · {item.progress.daysHeld} held / {item.progress.daysRemaining} left · {item.risk.recommendation.replaceAll("_", " ")}</Text>
      {item.exits.map((sale) => <Pressable key={sale.id} onPress={() => setEditingSale({ trade: item, sale })} style={styles.saleRow}><Text style={styles.meta}>{sale.soldOn} · {sale.quantity} @ {money(sale.exitPrice, market)}</Text><Text style={styles.link}>Edit sale</Text></Pressable>)}
      <View style={styles.actions}><SmallAction label="Edit" onPress={() => setEditing(item)} />{item.status === "OPEN" && <SmallAction label="Record sale" onPress={() => setSelling(item)} />}<SmallAction label="Delete" destructive onPress={() => remove(item)} /></View>
    </View>} />
    <EditTradeSheet trade={editing} market={market} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
    <SaleSheet trade={selling} market={market} onClose={() => setSelling(null)} onSaved={() => { setSelling(null); load(); }} />
    <SaleSheet trade={editingSale?.trade ?? null} sale={editingSale?.sale} market={market} onClose={() => setEditingSale(null)} onSaved={() => { setEditingSale(null); load(); }} />
  </View>;
}

function TradeEntrySheet({ visible, row, market, onClose, onSaved }: { visible: boolean; row: StrongCandidate; market: Market; onClose: () => void; onSaved: () => void }) {
  const [date, setDate] = useState(today()); const [price, setPrice] = useState(String(row.lastQuote ?? row.strongEntry)); const [quantity, setQuantity] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const save = async () => { setBusy(true); setError(""); try { await createTrade({ assetId: row.assetId, market, boughtOn: date, buyPrice: Number(price), quantity: Number(quantity), strategyKey: "STRONG_SWING", projectionEntry: row.strongEntry, projectedTarget: row.strongTarget, projectedStop: row.strongStop, projectedTrailingStop: row.strongTrail, expectedHoldingDays: row.strongExpectedDays }); onSaved(); } catch (cause) { setError(message(cause, "Trade could not be recorded")); } finally { setBusy(false); } };
  return <Sheet visible={visible} title={`Log ${row.ticker}`} onClose={onClose}><Field value={date} onChangeText={setDate} placeholder="Purchase date YYYY-MM-DD" /><Field value={price} onChangeText={setPrice} placeholder="Buy price" keyboard="decimal-pad" /><Field value={quantity} onChangeText={setQuantity} placeholder="Quantity" keyboard="decimal-pad" />{!!error && <Text style={styles.error}>{error}</Text>}<Action label="Freeze plan and log trade" busy={busy} onPress={save} /></Sheet>;
}

function EditTradeSheet({ trade, market, onClose, onSaved }: { trade: LedgerTrade | null; market: Market; onClose: () => void; onSaved: () => void }) {
  return trade ? <EditTradeForm key={trade.id} trade={trade} market={market} onClose={onClose} onSaved={onSaved} /> : null;
}

function EditTradeForm({ trade, market, onClose, onSaved }: { trade: LedgerTrade; market: Market; onClose: () => void; onSaved: () => void }) {
  const [date, setDate] = useState(trade.boughtOn); const [price, setPrice] = useState(String(trade.buyPrice)); const [quantity, setQuantity] = useState(String(trade.quantity)); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const save = async () => { if (!trade) return; setBusy(true); try { await updateTrade(trade.id, { market, boughtOn: date, buyPrice: Number(price), quantity: Number(quantity) }); onSaved(); } catch (cause) { setError(message(cause, "Trade could not be updated")); } finally { setBusy(false); } };
  return <Sheet visible title={`Edit ${trade.ticker}`} onClose={onClose}><Field value={date} onChangeText={setDate} placeholder="Purchase date YYYY-MM-DD" /><Field value={price} onChangeText={setPrice} placeholder="Buy price" keyboard="decimal-pad" /><Field value={quantity} onChangeText={setQuantity} placeholder="Quantity" keyboard="decimal-pad" />{!!error && <Text style={styles.error}>{error}</Text>}<Action label="Save trade" busy={busy} onPress={save} /></Sheet>;
}

function SaleSheet({ trade, sale, market, onClose, onSaved }: { trade: LedgerTrade | null; sale?: LedgerTrade["exits"][number]; market: Market; onClose: () => void; onSaved: () => void }) {
  return trade ? <SaleForm key={`${trade.id}:${sale?.id ?? "new"}`} trade={trade} sale={sale} market={market} onClose={onClose} onSaved={onSaved} /> : null;
}

function SaleForm({ trade, sale, market, onClose, onSaved }: { trade: LedgerTrade; sale?: LedgerTrade["exits"][number]; market: Market; onClose: () => void; onSaved: () => void }) {
  const [date, setDate] = useState(sale?.soldOn ?? today()); const [price, setPrice] = useState(String(sale?.exitPrice ?? trade.currentPrice ?? "")); const [quantity, setQuantity] = useState(String(sale?.quantity ?? trade.remainingQuantity)); const [reason, setReason] = useState(sale?.reason ?? "Manual exit"); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const save = async () => { if (!trade) return; setBusy(true); try { const input = { market, soldOn: date, exitPrice: Number(price), quantity: Number(quantity), reason }; if (sale) await updateSale(trade.id, sale.id, input); else await recordSale(trade.id, input); onSaved(); } catch (cause) { setError(message(cause, "Sale could not be recorded")); } finally { setBusy(false); } };
  return <Sheet visible title={`${sale ? "Edit sale" : "Record sale"} · ${trade.ticker}`} onClose={onClose}><Field value={date} onChangeText={setDate} placeholder="Sale date YYYY-MM-DD" /><Field value={price} onChangeText={setPrice} placeholder="Sale price" keyboard="decimal-pad" /><Field value={quantity} onChangeText={setQuantity} placeholder="Quantity" keyboard="decimal-pad" /><Field value={reason} onChangeText={setReason} placeholder="Reason" />{!!error && <Text style={styles.error}>{error}</Text>}<Action label={sale ? "Save sale" : "Record sale"} busy={busy} onPress={save} /></Sheet>;
}

function Sheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode }) { return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}><View style={styles.modalBackdrop}><View style={styles.sheet}><View style={styles.rowBetween}><Text style={styles.sectionTitle}>{title}</Text><Pressable onPress={onClose}><Text style={styles.link}>Close</Text></Pressable></View>{children}</View></View></Modal>; }
function Field({ value, onChangeText, placeholder, keyboard, secure }: { value: string; onChangeText: (value: string) => void; placeholder: string; keyboard?: "email-address" | "decimal-pad"; secure?: boolean }) { return <TextInput style={styles.input} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor="#697078" autoCapitalize="none" keyboardType={keyboard} secureTextEntry={secure} />; }
function Action({ label, onPress, busy = false, disabled = false }: { label: string; onPress: () => void; busy?: boolean; disabled?: boolean }) { return <Pressable style={[styles.primary, disabled && styles.disabled]} onPress={onPress} disabled={busy || disabled}>{busy ? <ActivityIndicator color="#04110d" /> : <Text style={styles.primaryText}>{label}</Text>}</Pressable>; }
const SmallAction = ({ label, onPress, destructive }: { label: string; onPress: () => void; destructive?: boolean }) => <Pressable style={styles.smallAction} onPress={onPress}><Text style={destructive ? styles.badValue : styles.link}>{label}</Text></Pressable>;
const Centered = ({ children }: { children: React.ReactNode }) => <View style={styles.center}>{children}</View>;
const ScreenHead = ({ title, subtitle }: { title: string; subtitle: string }) => <View style={styles.screenHead}><Text style={styles.title}>{title}</Text><Text style={styles.muted}>{subtitle}</Text></View>;
const TabButton = ({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) => <Pressable style={[styles.tab, active && styles.tabActive]} onPress={onPress}><Text style={active ? styles.tabTextActive : styles.tabText}>{label}</Text></Pressable>;
const Score = ({ value }: { value: number }) => <View style={styles.score}><Text style={styles.scoreText}>{Math.round(value)}</Text></View>;
const StatePill = ({ state }: { state: NewsSwingCandidate["state"] }) => <View style={[styles.statePill, state === "FAVORED" ? styles.stateFavored : state === "RISK_OFF" ? styles.stateRisk : state === "CAUTION" ? styles.stateCaution : null]}><Text style={styles.stateText}>{state.replaceAll("_", " ")}</Text></View>;
const Metric = ({ label, value, positive, negative }: { label: string; value: string; positive?: boolean; negative?: boolean }) => <View style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text numberOfLines={1} style={[styles.metricValue, positive && styles.goodValue, negative && styles.badValue]}>{value}</Text></View>;
const Summary = ({ label, value }: { label: string; value: string }) => <View style={styles.summaryCard}><Text style={styles.metricLabel}>{label}</Text><Text style={styles.summaryValue}>{value}</Text></View>;
const Empty = ({ text }: { text: string }) => <View style={styles.empty}><Text style={styles.muted}>{text}</Text></View>;
const Banner = ({ text }: { text: string }) => <Text style={styles.errorBanner}>{text}</Text>;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#05070a" }, flex: { flex: 1 }, center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#05070a" },
  login: { flexGrow: 1, justifyContent: "center", padding: 28, gap: 14, backgroundColor: "#05070a" }, brand: { color: "#f7f8fa", fontSize: 30, fontWeight: "900" }, brandSmall: { color: "#f7f8fa", fontSize: 20, fontWeight: "900" }, accent: { color: "#34d399" }, eyebrow: { color: "#34d399", fontSize: 11, fontWeight: "800", letterSpacing: 3 },
  title: { color: "#f7f8fa", fontSize: 27, fontWeight: "900" }, muted: { color: "#858c95", fontSize: 14, lineHeight: 21 }, input: { color: "#f7f8fa", backgroundColor: "#0c1015", borderColor: "#242a32", borderWidth: 1, borderRadius: 8, paddingHorizontal: 15, height: 52 },
  error: { color: "#fb7185" }, success: { color: "#6ee7b7", marginTop: 12 }, warning: { color: "#fbbf24", borderColor: "#6b4d0d", borderWidth: 1, padding: 12, borderRadius: 7 }, primary: { backgroundColor: "#34d399", borderRadius: 8, minHeight: 52, alignItems: "center", justifyContent: "center", marginVertical: 4 }, disabled: { opacity: 0.45 }, primaryText: { color: "#04110d", fontSize: 15, fontWeight: "900" },
  header: { paddingHorizontal: 18, paddingVertical: 12, borderBottomColor: "#1d2229", borderBottomWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, user: { color: "#707780", fontSize: 10, marginTop: 2 }, link: { color: "#5eead4", fontWeight: "700" },
  switchRow: { flexDirection: "row", padding: 12, gap: 8 }, switch: { flex: 1, alignItems: "center", padding: 10, borderWidth: 1, borderColor: "#252b33", borderRadius: 7 }, switchActive: { backgroundColor: "#102a22", borderColor: "#2b8c70" }, switchText: { color: "#777f89", fontWeight: "800" }, switchTextActive: { color: "#6ee7b7", fontWeight: "900" },
  screenHead: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 12, gap: 5 }, errorBanner: { color: "#fecdd3", backgroundColor: "#35131d", marginHorizontal: 18, marginBottom: 10, padding: 12, borderRadius: 7 }, list: { padding: 14, gap: 10, paddingBottom: 28 },
  card: { backgroundColor: "#0b0f14", borderColor: "#252b33", borderWidth: 1, borderRadius: 8, padding: 15, gap: 14 }, rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }, ticker: { color: "#f8fafc", fontSize: 19, fontWeight: "900" }, meta: { color: "#707780", fontSize: 12, marginTop: 3 }, score: { minWidth: 43, height: 32, paddingHorizontal: 8, alignItems: "center", justifyContent: "center", borderRadius: 16, backgroundColor: "#103126" }, scoreText: { color: "#6ee7b7", fontWeight: "900" },
  metricRow: { flexDirection: "row", gap: 8 }, metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginVertical: 18 }, metric: { flex: 1, minWidth: 88, backgroundColor: "#080b0f", borderRadius: 6, padding: 10 }, metricLabel: { color: "#656c75", fontSize: 10, fontWeight: "700" }, metricValue: { color: "#e5e7eb", fontSize: 14, fontWeight: "800", marginTop: 5 }, goodValue: { color: "#34d399" }, badValue: { color: "#fb7185" }, warningValue: { color: "#fbbf24", fontSize: 11, fontWeight: "900" }, cardFoot: { color: "#949ba4", fontSize: 12 }, revisedPlan: { borderTopWidth: 1, borderTopColor: "#26313a", paddingTop: 12, gap: 9 }, revisedPlanTitle: { color: "#67e8f9", fontSize: 10, fontWeight: "900", letterSpacing: 1.1 },
  tabs: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#20252c", backgroundColor: "#080b0f", paddingHorizontal: 12, paddingBottom: 8, gap: 8 }, tab: { flex: 1, alignItems: "center", paddingVertical: 11, borderRadius: 7 }, tabActive: { backgroundColor: "#123126" }, tabText: { color: "#727983", fontSize: 12, fontWeight: "800" }, tabTextActive: { color: "#6ee7b7", fontSize: 12, fontWeight: "900" },
  detail: { padding: 20, paddingBottom: 50 }, detailTicker: { color: "#f8fafc", fontSize: 34, fontWeight: "900", marginTop: 22 }, sectionTitle: { color: "#f8fafc", fontSize: 18, fontWeight: "900", marginTop: 8, marginBottom: 10 }, gate: { flexDirection: "row", gap: 12, borderTopWidth: 1, borderTopColor: "#1c2229", paddingVertical: 13 }, gateText: { flex: 1 }, gateLabel: { color: "#e5e7eb", fontWeight: "800", marginBottom: 3 }, good: { color: "#34d399", fontSize: 11, fontWeight: "900", width: 38 }, bad: { color: "#fbbf24", fontSize: 11, fontWeight: "900", width: 38 },
  summary: { paddingHorizontal: 14, paddingBottom: 8, gap: 8 }, summaryCard: { width: 140, backgroundColor: "#0b0f14", borderColor: "#252b33", borderWidth: 1, borderRadius: 8, padding: 12 }, summaryValue: { color: "#f8fafc", fontSize: 17, fontWeight: "900", marginTop: 5 }, empty: { padding: 50, alignItems: "center" },
  actions: { flexDirection: "row", gap: 8, borderTopWidth: 1, borderTopColor: "#1d2229", paddingTop: 10 }, smallAction: { minHeight: 40, justifyContent: "center", paddingHorizontal: 10 }, saleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#080b0f", borderRadius: 6, padding: 10 },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.72)" }, sheet: { backgroundColor: "#0b0f14", borderTopLeftRadius: 12, borderTopRightRadius: 12, borderColor: "#2a3038", borderWidth: 1, padding: 20, paddingBottom: 36, gap: 12 },
  chart: { height: 120, marginTop: 18, backgroundColor: "#080b0f", borderRadius: 8, overflow: "hidden" }, chartCaption: { color: "#646b74", fontSize: 10, marginTop: 6 }, deviceStatus: { color: "#6f7781", fontSize: 9, paddingHorizontal: 16, paddingBottom: 4 },
  newsSummary: { color: "#697078", fontSize: 10, paddingHorizontal: 18, paddingBottom: 8 }, evidence: { borderTopWidth: 1, borderTopColor: "#1d2229", paddingTop: 10, gap: 3 }, evidenceTitle: { color: "#e5e7eb", fontSize: 13, fontWeight: "700" }, statePill: { borderRadius: 12, borderWidth: 1, borderColor: "#343a43", paddingHorizontal: 8, paddingVertical: 5 }, stateFavored: { borderColor: "#23835f", backgroundColor: "#0d2c21" }, stateRisk: { borderColor: "#9f2942", backgroundColor: "#35131d" }, stateCaution: { borderColor: "#8a6417", backgroundColor: "#30250d" }, stateText: { color: "#d5dae0", fontSize: 9, fontWeight: "900" },
});
