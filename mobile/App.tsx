import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, Pressable, RefreshControl, SafeAreaView, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import {
  getLedger, getStrongSwing, login, logout, restoreSession,
  type LedgerSummary, type LedgerTrade, type Market, type MobileUser, type StrongCandidate,
} from "./src/api";

type Tab = "strong" | "ledger";
const money = (value: number, market: Market) => new Intl.NumberFormat(market === "IN" ? "en-IN" : "en-US", {
  style: "currency", currency: market === "IN" ? "INR" : "USD", maximumFractionDigits: 2,
}).format(value);
const pct = (value: number | null) => value === null ? "--" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

export default function App() {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<MobileUser | null>(null);
  useEffect(() => { restoreSession().then(setUser).finally(() => setBooting(false)); }, []);
  if (booting) return <Centered><ActivityIndicator color="#34d399" /></Centered>;
  return <SafeAreaView style={styles.safe}><StatusBar style="light" />{
    user ? <Terminal user={user} onLogout={() => logout().then(() => setUser(null))} /> : <Login onLogin={setUser} />
  }</SafeAreaView>;
}

function Login({ onLogin }: { onLogin: (user: MobileUser) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setError("");
    try { onLogin(await login(email, password)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Sign in failed"); }
    finally { setBusy(false); }
  };
  return <ScrollView contentContainerStyle={styles.login} keyboardShouldPersistTaps="handled">
    <Text style={styles.brand}>Investo<Text style={styles.accent}>Genie</Text></Text>
    <Text style={styles.eyebrow}>MOBILE TERMINAL</Text>
    <Text style={styles.title}>Sign in</Text>
    <Text style={styles.muted}>Use the same account as the InvestoGenie web terminal.</Text>
    <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="Email" placeholderTextColor="#697078" autoCapitalize="none" keyboardType="email-address" />
    <TextInput style={styles.input} value={password} onChangeText={setPassword} placeholder="Password" placeholderTextColor="#697078" secureTextEntry />
    {!!error && <Text style={styles.error}>{error}</Text>}
    <Pressable style={styles.primary} onPress={submit} disabled={busy}>{busy ? <ActivityIndicator color="#04110d" /> : <Text style={styles.primaryText}>Open terminal</Text>}</Pressable>
  </ScrollView>;
}

function Terminal({ user, onLogout }: { user: MobileUser; onLogout: () => void }) {
  const [market, setMarket] = useState<Market>("IN");
  const [tab, setTab] = useState<Tab>("strong");
  return <View style={styles.flex}>
    <View style={styles.header}>
      <View><Text style={styles.brandSmall}>Investo<Text style={styles.accent}>Genie</Text></Text><Text style={styles.user}>{user.email}</Text></View>
      <Pressable onPress={onLogout}><Text style={styles.link}>Sign out</Text></Pressable>
    </View>
    <View style={styles.switchRow}>
      {(["IN", "US"] as Market[]).map((value) => <Pressable key={value} onPress={() => setMarket(value)} style={[styles.switch, market === value && styles.switchActive]}><Text style={market === value ? styles.switchTextActive : styles.switchText}>{value === "IN" ? "India" : "US"}</Text></Pressable>)}
    </View>
    <View style={styles.flex}>{tab === "strong" ? <Strong key={market} market={market} /> : <Ledger key={market} market={market} />}</View>
    <View style={styles.tabs}>
      <TabButton active={tab === "strong"} label="Strong Swing" onPress={() => setTab("strong")} />
      <TabButton active={tab === "ledger"} label="Trade Ledger" onPress={() => setTab("ledger")} />
    </View>
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
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load candidates"); }
    finally { setRefreshing(false); }
  }, [market]);
  useEffect(() => {
    let active = true;
    getStrongSwing(market)
      .then((result) => { if (active) setRows(result.candidates); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load candidates"); })
      .finally(() => { if (active) setRefreshing(false); });
    return () => { active = false; };
  }, [market]);
  if (selected) return <CandidateDetail row={selected} market={market} onBack={() => setSelected(null)} />;
  return <View style={styles.flex}>
    <ScreenHead title="Strong Swing" subtitle="The web terminal's confirmed execution engine. No mobile-side recalculation." />
    {!!error && <Text style={styles.errorBanner}>{error}</Text>}
    <FlatList data={rows} keyExtractor={(item) => item.assetId} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor="#34d399" />} contentContainerStyle={styles.list} ListEmptyComponent={!refreshing ? <Empty text="No candidates available." /> : null} renderItem={({ item }) => <Pressable onPress={() => setSelected(item)} style={styles.card}>
      <View style={styles.rowBetween}><View><Text style={styles.ticker}>#{item.strongSwingRank} {item.ticker}</Text><Text style={styles.meta}>{item.exchange || market} · {item.status.replaceAll("_", " ")}</Text></View><Score value={item.strengthScore} /></View>
      <View style={styles.metricRow}><Metric label="ENTRY" value={money(item.strongEntry, market)} /><Metric label="TARGET" value={money(item.strongTarget, market)} positive /><Metric label="STOP" value={money(item.strongStop, market)} negative /></View>
      <Text style={styles.cardFoot}>Current {money(item.lastQuote ?? item.latestClose, market)} · {item.strongExpectedDays} sessions</Text>
    </Pressable>} />
  </View>;
}

function CandidateDetail({ row, market, onBack }: { row: StrongCandidate; market: Market; onBack: () => void }) {
  return <ScrollView contentContainerStyle={styles.detail}>
    <Pressable onPress={onBack}><Text style={styles.link}>Back to candidates</Text></Pressable>
    <Text style={styles.detailTicker}>{row.ticker}</Text><Text style={styles.meta}>{row.exchange || market}</Text>
    <View style={styles.metricGrid}><Metric label="CURRENT" value={money(row.lastQuote ?? row.latestClose, market)} /><Metric label="ENTRY" value={money(row.strongEntry, market)} /><Metric label="TARGET" value={money(row.strongTarget, market)} positive /><Metric label="STOP" value={money(row.strongStop, market)} negative /><Metric label="TRAIL" value={money(row.strongTrail, market)} /><Metric label="SCORE" value={row.strengthScore.toFixed(0)} /></View>
    <Text style={styles.sectionTitle}>Confirmation gates</Text>
    {row.gates.map((gate) => <View key={gate.key} style={styles.gate}><Text style={gate.passed ? styles.good : styles.bad}>{gate.passed ? "PASS" : "WAIT"}</Text><View style={styles.gateText}><Text style={styles.gateLabel}>{gate.label}</Text><Text style={styles.muted}>{gate.detail}</Text></View></View>)}
  </ScrollView>;
}

function Ledger({ market }: { market: Market }) {
  const [trades, setTrades] = useState<LedgerTrade[]>([]);
  const [summary, setSummary] = useState<LedgerSummary | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setRefreshing(true); setError("");
    try { const result = await getLedger(market); setTrades(result.trades); setSummary(result.summary); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load ledger"); }
    finally { setRefreshing(false); }
  }, [market]);
  useEffect(() => {
    let active = true;
    getLedger(market)
      .then((result) => { if (active) { setTrades(result.trades); setSummary(result.summary); } })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load ledger"); })
      .finally(() => { if (active) setRefreshing(false); });
    return () => { active = false; };
  }, [market]);
  return <View style={styles.flex}>
    <ScreenHead title="Trade Ledger" subtitle="Open and closed swing trades with the server's live risk assessment." />
    {summary && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.summary}><Summary label="OPEN" value={String(summary.openCount)} /><Summary label="UNREALIZED" value={money(summary.unrealizedPnlValue, market)} /><Summary label="REALIZED" value={money(summary.realizedPnlValue, market)} /><Summary label="OVERALL" value={money(summary.overallPnlValue, market)} /></ScrollView>}
    {!!error && <Text style={styles.errorBanner}>{error}</Text>}
    <FlatList data={trades} keyExtractor={(item) => item.id} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor="#34d399" />} contentContainerStyle={styles.list} ListEmptyComponent={!refreshing ? <Empty text="No trades in this market." /> : null} renderItem={({ item }) => <View style={styles.card}>
      <View style={styles.rowBetween}><View><Text style={styles.ticker}>{item.ticker}</Text><Text style={styles.meta}>{item.status} · bought {item.boughtOn}</Text></View><Text style={item.progress.pnlPct !== null && item.progress.pnlPct >= 0 ? styles.goodValue : styles.badValue}>{pct(item.progress.pnlPct)}</Text></View>
      <View style={styles.metricRow}><Metric label="BUY" value={money(item.buyPrice, market)} /><Metric label="CURRENT" value={item.currentPrice === null ? "STALE" : money(item.currentPrice, market)} /><Metric label="TARGET" value={money(item.projectedTarget, market)} positive /></View>
      <Text style={styles.cardFoot}>{item.remainingQuantity} remaining · {item.progress.daysHeld} held / {item.progress.daysRemaining} left · {item.risk.state.replaceAll("_", " ")}</Text>
    </View>} />
  </View>;
}

const Centered = ({ children }: { children: React.ReactNode }) => <View style={styles.center}>{children}</View>;
const ScreenHead = ({ title, subtitle }: { title: string; subtitle: string }) => <View style={styles.screenHead}><Text style={styles.title}>{title}</Text><Text style={styles.muted}>{subtitle}</Text></View>;
const TabButton = ({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) => <Pressable style={[styles.tab, active && styles.tabActive]} onPress={onPress}><Text style={active ? styles.tabTextActive : styles.tabText}>{label}</Text></Pressable>;
const Score = ({ value }: { value: number }) => <View style={styles.score}><Text style={styles.scoreText}>{Math.round(value)}</Text></View>;
const Metric = ({ label, value, positive, negative }: { label: string; value: string; positive?: boolean; negative?: boolean }) => <View style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text numberOfLines={1} style={[styles.metricValue, positive && styles.goodValue, negative && styles.badValue]}>{value}</Text></View>;
const Summary = ({ label, value }: { label: string; value: string }) => <View style={styles.summaryCard}><Text style={styles.metricLabel}>{label}</Text><Text style={styles.summaryValue}>{value}</Text></View>;
const Empty = ({ text }: { text: string }) => <View style={styles.empty}><Text style={styles.muted}>{text}</Text></View>;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#05070a" }, flex: { flex: 1 }, center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#05070a" },
  login: { flexGrow: 1, justifyContent: "center", padding: 28, gap: 14, backgroundColor: "#05070a" }, brand: { color: "#f7f8fa", fontSize: 30, fontWeight: "900" }, brandSmall: { color: "#f7f8fa", fontSize: 20, fontWeight: "900" }, accent: { color: "#34d399" }, eyebrow: { color: "#34d399", fontSize: 11, fontWeight: "800", letterSpacing: 3 },
  title: { color: "#f7f8fa", fontSize: 27, fontWeight: "900" }, muted: { color: "#858c95", fontSize: 14, lineHeight: 21 }, input: { color: "#f7f8fa", backgroundColor: "#0c1015", borderColor: "#242a32", borderWidth: 1, borderRadius: 8, paddingHorizontal: 15, height: 52 },
  error: { color: "#fb7185" }, primary: { backgroundColor: "#34d399", borderRadius: 8, minHeight: 52, alignItems: "center", justifyContent: "center" }, primaryText: { color: "#04110d", fontSize: 16, fontWeight: "900" },
  header: { paddingHorizontal: 18, paddingVertical: 12, borderBottomColor: "#1d2229", borderBottomWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, user: { color: "#707780", fontSize: 10, marginTop: 2 }, link: { color: "#5eead4", fontWeight: "700" },
  switchRow: { flexDirection: "row", padding: 12, gap: 8 }, switch: { flex: 1, alignItems: "center", padding: 10, borderWidth: 1, borderColor: "#252b33", borderRadius: 7 }, switchActive: { backgroundColor: "#102a22", borderColor: "#2b8c70" }, switchText: { color: "#777f89", fontWeight: "800" }, switchTextActive: { color: "#6ee7b7", fontWeight: "900" },
  screenHead: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 12, gap: 5 }, errorBanner: { color: "#fecdd3", backgroundColor: "#35131d", marginHorizontal: 18, marginBottom: 10, padding: 12, borderRadius: 7 }, list: { padding: 14, gap: 10, paddingBottom: 28 },
  card: { backgroundColor: "#0b0f14", borderColor: "#252b33", borderWidth: 1, borderRadius: 8, padding: 15, gap: 14 }, rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }, ticker: { color: "#f8fafc", fontSize: 19, fontWeight: "900" }, meta: { color: "#707780", fontSize: 12, marginTop: 3 }, score: { minWidth: 43, height: 32, paddingHorizontal: 8, alignItems: "center", justifyContent: "center", borderRadius: 16, backgroundColor: "#103126" }, scoreText: { color: "#6ee7b7", fontWeight: "900" },
  metricRow: { flexDirection: "row", gap: 8 }, metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginVertical: 18 }, metric: { flex: 1, minWidth: 88, backgroundColor: "#080b0f", borderRadius: 6, padding: 10 }, metricLabel: { color: "#656c75", fontSize: 10, fontWeight: "700" }, metricValue: { color: "#e5e7eb", fontSize: 14, fontWeight: "800", marginTop: 5 }, goodValue: { color: "#34d399" }, badValue: { color: "#fb7185" }, cardFoot: { color: "#949ba4", fontSize: 12 },
  tabs: { flexDirection: "row", borderTopWidth: 1, borderTopColor: "#20252c", backgroundColor: "#080b0f", padding: 8, gap: 8 }, tab: { flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 7 }, tabActive: { backgroundColor: "#123126" }, tabText: { color: "#727983", fontWeight: "800" }, tabTextActive: { color: "#6ee7b7", fontWeight: "900" },
  detail: { padding: 20, paddingBottom: 50 }, detailTicker: { color: "#f8fafc", fontSize: 34, fontWeight: "900", marginTop: 22 }, sectionTitle: { color: "#f8fafc", fontSize: 18, fontWeight: "900", marginTop: 8, marginBottom: 10 }, gate: { flexDirection: "row", gap: 12, borderTopWidth: 1, borderTopColor: "#1c2229", paddingVertical: 13 }, gateText: { flex: 1 }, gateLabel: { color: "#e5e7eb", fontWeight: "800", marginBottom: 3 }, good: { color: "#34d399", fontSize: 11, fontWeight: "900", width: 38 }, bad: { color: "#fbbf24", fontSize: 11, fontWeight: "900", width: 38 },
  summary: { paddingHorizontal: 14, paddingBottom: 8, gap: 8 }, summaryCard: { width: 140, backgroundColor: "#0b0f14", borderColor: "#252b33", borderWidth: 1, borderRadius: 8, padding: 12 }, summaryValue: { color: "#f8fafc", fontSize: 17, fontWeight: "900", marginTop: 5 }, empty: { padding: 50, alignItems: "center" },
});
