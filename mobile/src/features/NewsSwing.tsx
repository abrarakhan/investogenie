import { useCallback, useEffect, useState } from "react";
import { FlatList, Linking, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { getNewsSwing, type Market, type NewsSwingCandidate } from "../api";

const money = (value: number, market: Market) => new Intl.NumberFormat(market === "IN" ? "en-IN" : "en-US", {
  style: "currency", currency: market === "IN" ? "INR" : "USD", maximumFractionDigits: 2,
}).format(value);
const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : "Could not load News & AI Swing";

export default function NewsSwing({ market }: { market: Market }) {
  const [rows, setRows] = useState<NewsSwingCandidate[]>([]);
  const [refreshing, setRefreshing] = useState(true);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState({ articles: 0, impacts: 0, fetchedAt: null as string | null });
  const apply = (result: Awaited<ReturnType<typeof getNewsSwing>>) => {
    setRows(result.candidates);
    setSummary({ articles: result.articleCount, impacts: result.impactCount, fetchedAt: result.lastFetchedAt });
  };
  const load = useCallback(async () => {
    setRefreshing(true); setError("");
    try { apply(await getNewsSwing(market)); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setRefreshing(false); }
  }, [market]);
  useEffect(() => {
    let active = true;
    getNewsSwing(market).then((result) => { if (active) apply(result); })
      .catch((cause) => { if (active) setError(errorMessage(cause)); })
      .finally(() => { if (active) setRefreshing(false); });
    return () => { active = false; };
  }, [market]);
  useEffect(() => { const timer = setInterval(load, 300_000); return () => clearInterval(timer); }, [load]);
  return <View style={styles.flex}>
    <View style={styles.screenHead}><Text style={styles.title}>News & AI Swing</Text><Text style={styles.muted}>Existing Strong Swing setups in the exact server-ranked News & AI order.</Text></View>
    <Text style={styles.summary}>{summary.articles} articles · {summary.impacts} impacts · {summary.fetchedAt ? `fetched ${new Date(summary.fetchedAt).toLocaleString()}` : "awaiting news sync"}</Text>
    {!!error && <Text style={styles.error}>{error}</Text>}
    <FlatList data={rows} keyExtractor={(item) => item.assetId} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor="#34d399" />} contentContainerStyle={styles.list} ListEmptyComponent={!refreshing ? <View style={styles.empty}><Text style={styles.muted}>No News & AI candidates available.</Text></View> : null} renderItem={({ item, index }) => <View style={styles.card}>
      <View style={styles.row}><View><Text style={styles.ticker}>#{index + 1} {item.ticker}</Text><Text style={styles.meta}>Strong rank #{item.strongSwingRank} · {item.status.replaceAll("_", " ")}</Text></View><StatePill state={item.state} /></View>
      <View style={styles.metrics}><Metric label="TECHNICAL" value={item.technicalScore.toFixed(1)} /><Metric label="NEWS" value={`${item.newsAdjustment >= 0 ? "+" : ""}${item.newsAdjustment.toFixed(1)}`} tone={item.newsAdjustment > 0 ? "good" : item.newsAdjustment < 0 ? "bad" : undefined} /><Metric label="COMBINED" value={item.combinedScore.toFixed(1)} /></View>
      <View style={styles.metrics}><Metric label="ENTRY" value={money(item.strongEntry, market)} /><Metric label="TARGET" value={money(item.strongTarget, market)} tone="good" /><Metric label="STOP" value={money(item.strongStop, market)} tone="bad" /></View>
      {item.news.slice(0, 3).map((evidence) => <Pressable key={`${evidence.articleId}:${evidence.direction}`} onPress={() => void Linking.openURL(evidence.url)} style={styles.evidence}><Text style={evidence.direction === "POSITIVE" ? styles.good : evidence.direction === "NEGATIVE" ? styles.bad : styles.meta}>{evidence.direction} · {evidence.sourceName ?? "Source"}</Text><Text numberOfLines={2} style={styles.evidenceTitle}>{evidence.title}</Text><Text numberOfLines={2} style={styles.meta}>{evidence.rationale}</Text></Pressable>)}
    </View>} />
  </View>;
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return <View style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text numberOfLines={1} style={[styles.metricValue, tone === "good" && styles.good, tone === "bad" && styles.bad]}>{value}</Text></View>;
}
function StatePill({ state }: { state: NewsSwingCandidate["state"] }) {
  return <View style={[styles.pill, state === "FAVORED" ? styles.favored : state === "RISK_OFF" ? styles.risk : state === "CAUTION" ? styles.caution : null]}><Text style={styles.pillText}>{state.replaceAll("_", " ")}</Text></View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 }, screenHead: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 12, gap: 5 }, title: { color: "#f7f8fa", fontSize: 27, fontWeight: "900" }, muted: { color: "#858c95", fontSize: 14, lineHeight: 21 }, summary: { color: "#697078", fontSize: 10, paddingHorizontal: 18, paddingBottom: 8 }, error: { color: "#fecdd3", backgroundColor: "#35131d", marginHorizontal: 18, marginBottom: 10, padding: 12, borderRadius: 7 }, list: { padding: 14, gap: 10, paddingBottom: 28 }, empty: { padding: 50, alignItems: "center" },
  card: { backgroundColor: "#0b0f14", borderColor: "#252b33", borderWidth: 1, borderRadius: 8, padding: 15, gap: 14 }, row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }, ticker: { color: "#f8fafc", fontSize: 19, fontWeight: "900" }, meta: { color: "#707780", fontSize: 12, marginTop: 3 }, metrics: { flexDirection: "row", gap: 8 }, metric: { flex: 1, minWidth: 88, backgroundColor: "#080b0f", borderRadius: 6, padding: 10 }, metricLabel: { color: "#656c75", fontSize: 10, fontWeight: "700" }, metricValue: { color: "#e5e7eb", fontSize: 14, fontWeight: "800", marginTop: 5 }, good: { color: "#34d399" }, bad: { color: "#fb7185" },
  evidence: { borderTopWidth: 1, borderTopColor: "#1d2229", paddingTop: 10, gap: 3 }, evidenceTitle: { color: "#e5e7eb", fontSize: 13, fontWeight: "700" }, pill: { borderRadius: 12, borderWidth: 1, borderColor: "#343a43", paddingHorizontal: 8, paddingVertical: 5 }, favored: { borderColor: "#23835f", backgroundColor: "#0d2c21" }, risk: { borderColor: "#9f2942", backgroundColor: "#35131d" }, caution: { borderColor: "#8a6417", backgroundColor: "#30250d" }, pillText: { color: "#d5dae0", fontSize: 9, fontWeight: "900" },
});
