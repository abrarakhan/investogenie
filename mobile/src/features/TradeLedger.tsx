import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Alert, AppState, FlatList, Modal, Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import {
  createMutationKey, deleteTrade, getLedger, recordSale, updateSale, updateTrade,
  type LedgerSummary, type LedgerTrade, type Market,
} from "../api";
import { Card } from "../design/Card";
import { Pill } from "../design/Pill";
import { colors, hapticSuccess, hapticWarning, radius, tabularNums } from "../design/tokens";
import { amount, errorMessage, marketDate, money, pct } from "../format";
import { Action, Banner, Empty, Metric, ScreenHead } from "../ui";

export default function TradeLedger({ market }: { market: Market }) {
  const [trades, setTrades] = useState<LedgerTrade[]>([]); const [summary, setSummary] = useState<LedgerSummary | null>(null);
  const [refreshing, setRefreshing] = useState(true); const [error, setError] = useState("");
  const [pendingIds, setPendingIds] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<LedgerTrade | null>(null); const [selling, setSelling] = useState<LedgerTrade | null>(null);
  const [editingSale, setEditingSale] = useState<{ trade: LedgerTrade; sale: LedgerTrade["exits"][number] } | null>(null);
  const markPending = (tradeId: string, label: string | null) =>
    setPendingIds((current) => {
      if (!label) {
        const next = { ...current };
        delete next[tradeId];
        return next;
      }
      return { ...current, [tradeId]: label };
    });
  const load = useCallback(async () => { setRefreshing(true); setError(""); try { const result = await getLedger(market); setTrades(result.trades); setSummary(result.summary); } catch (cause) { setError(errorMessage(cause, "Could not load ledger")); } finally { setRefreshing(false); } }, [market]);
  useEffect(() => { let active = true; getLedger(market).then((result) => { if (active) { setTrades(result.trades); setSummary(result.summary); } }).catch((cause) => { if (active) setError(errorMessage(cause, "Could not load ledger")); }).finally(() => { if (active) setRefreshing(false); }); return () => { active = false; }; }, [market]);
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
  const remove = (trade: LedgerTrade) => Alert.alert("Delete trade?", `${trade.ticker} and its sale history will be removed.`, [
    { text: "Cancel", style: "cancel" },
    {
      text: "Delete",
      style: "destructive",
      onPress: () => {
        markPending(trade.id, "Deleting…");
        void deleteTrade(trade.id)
          .then(async () => { hapticSuccess(); await load(); })
          .catch((cause) => { hapticWarning(); setError(errorMessage(cause, "Delete failed")); })
          .finally(() => markPending(trade.id, null));
      },
    },
  ]);
  return <View style={styles.flex}><ScreenHead title="Trade Ledger" subtitle="Edit entries and record partial or final sales without changing the frozen projection." />
    {summary && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.summary}><Summary label="OPEN" value={String(summary.openCount)} /><Summary label="CAPITAL" value={money(summary.capitalEmployedValue, market)} /><Summary label="UNREALIZED" value={money(summary.unrealizedPnlValue, market)} /><Summary label="REALIZED" value={money(summary.realizedPnlValue, market)} /><Summary label="OVERALL" value={money(summary.overallPnlValue, market)} /><Summary label="ROI" value={pct(summary.roiPct)} /><Summary label="XIRR" value={pct(summary.xirrPct)} /></ScrollView>}{!!error && <Banner>{error}</Banner>}
    <FlatList data={trades} keyExtractor={(item) => item.id} removeClippedSubviews windowSize={7} initialNumToRender={10} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={colors.emerald} />} contentContainerStyle={styles.list} ListEmptyComponent={!refreshing ? <Empty>No trades in this market.</Empty> : null} renderItem={({ item }) => {
      const pendingLabel = pendingIds[item.id] ?? null;
      return <Card style={pendingLabel ? styles.cardPending : undefined}>
      <View style={styles.rowBetween}><View><Text style={styles.ticker}>{item.ticker}</Text><Text style={styles.meta}>{item.status} · bought {item.boughtOn}</Text></View>{pendingLabel ? <Pill label={pendingLabel} tone="warning" compact /> : <Text style={item.progress.pnlPct !== null && item.progress.pnlPct >= 0 ? styles.goodValue : styles.badValue}>{pct(item.progress.pnlPct)}</Text>}</View>
      <View style={styles.metricRow}><Metric label="BUY" value={money(item.buyPrice, market)} /><Metric label="CURRENT" value={item.currentPrice === null ? "STALE" : money(item.currentPrice, market)} /><Metric label="TARGET" value={money(item.projectedTarget, market)} positive /></View>
      <View style={styles.metricRow}><Metric label="INVESTED" value={money(item.progress.investedValue, market)} /><Metric label={item.status === "CLOSED" ? "EXIT VALUE" : "CURRENT VALUE"} value={item.status === "CLOSED" ? money(item.progress.investedValue + item.realizedPnlValue, market) : item.progress.currentValue === null ? "STALE" : money(item.progress.currentValue, market)} positive={(item.progress.pnlValue ?? 0) >= 0} negative={(item.progress.pnlValue ?? 0) < 0} /><Metric label="P&L" value={item.progress.pnlValue === null ? "--" : money(item.progress.pnlValue, market)} positive={(item.progress.pnlValue ?? 0) >= 0} negative={(item.progress.pnlValue ?? 0) < 0} /></View>
      {item.status === "OPEN" && item.recovery && item.recovery.status !== "NONE" && item.recovery.headline && (
        <View style={[styles.recoveryBox, item.recovery.status === "UNVERIFIED" ? styles.recoveryUnverified : styles.recoveryActive]}>
          <View style={styles.rowBetween}>
            <Text style={item.recovery.status === "UNVERIFIED" ? styles.recoveryUnverifiedTitle : styles.recoveryTitle}>
              {item.recovery.status === "STOP_RECLAIMED" ? "STOP RECLAIMED" : item.recovery.status === "REBOUND_DETECTED" ? "REBOUND DETECTED" : "RECOVERY UNVERIFIED"}
            </Text>
            {!!item.recovery.sectorThrustGroup && <Text style={styles.recoveryMeta}>{item.recovery.sectorThrustGroup}</Text>}
          </View>
          <Text style={styles.recoveryHeadline}>{item.recovery.headline}</Text>
          <Text style={styles.recoveryMeta}>
            {[
              item.recovery.move2dPct !== null ? `2D ${pct(item.recovery.move2dPct)}` : null,
              item.recovery.volumePace !== null ? `20D Vol ${item.recovery.volumePace.toFixed(1)}x` : null,
              item.recovery.relativeStrength20d !== null ? `20D RS ${pct(item.recovery.relativeStrength20d)}` : null,
            ].filter(Boolean).join(" · ")}
          </Text>
          {item.recovery.freshSetup.status === "QUALIFIED" && (
            <Text style={styles.recoveryQualified}>
              Fresh setup qualified: {item.recovery.freshSetup.label}
              {item.recovery.freshSetup.entry !== null ? ` · Entry ${money(item.recovery.freshSetup.entry, market)}` : ""}
              {item.recovery.freshSetup.stop !== null ? ` · Stop ${money(item.recovery.freshSetup.stop, market)}` : ""}
              {item.recovery.freshSetup.target !== null ? ` · Target ${money(item.recovery.freshSetup.target, market)}` : ""}
            </Text>
          )}
          {item.recovery.freshSetup.status === "RECENT_SIGNAL" && (
            <Text style={styles.recoveryRecent}>
              {item.recovery.freshSetup.label}
              {item.recovery.freshSetup.blocker ? ` (${item.recovery.freshSetup.blocker})` : ""}
            </Text>
          )}
          {item.recovery.freshSetup.status === "BLOCKED" && !!item.recovery.freshSetup.blocker && (
            <Text style={styles.recoveryMeta}>Fresh setup recheck: Not qualified — {item.recovery.freshSetup.blocker}</Text>
          )}
        </View>
      )}
      {item.status === "OPEN" && <View style={styles.revisedPlan}>
        <View style={styles.rowBetween}><Text style={styles.revisedPlanTitle}>LIVE REVISED PLAN</Text><Text style={item.revisedPlan.action === "EXIT" ? styles.badValue : item.revisedPlan.action === "EXTEND_RUNNER" ? styles.goodValue : styles.warningValue}>{item.revisedPlan.label.toUpperCase()}</Text></View>
        <Text style={item.revisedPlan.action === "EXIT" ? styles.badValue : styles.evidenceTitle}>{item.revisedPlan.action === "EXIT" ? `ACTION NOW: Exit the remaining ${item.remainingQuantity} shares at the next executable market price. Do not wait for the old target.` : item.revisedPlan.action === "EXTEND_RUNNER" ? `ACTION NOW: Hold toward ${item.revisedPlan.revisedTarget === null ? "--" : money(item.revisedPlan.revisedTarget, market)} while protecting at ${item.revisedPlan.protectiveStop === null ? "--" : money(item.revisedPlan.protectiveStop, market)}.` : item.revisedPlan.action === "PROTECT_RECOVERY" ? `ACTION NOW: Hold only above ${item.revisedPlan.protectiveStop === null ? "--" : money(item.revisedPlan.protectiveStop, market)}; exit the remaining shares if that level trades.` : `ACTION NOW: Follow the displayed target and protection level for the remaining ${item.remainingQuantity} shares.`}</Text>
        <View style={styles.metricRow}><Metric label="REVISED OBJECTIVE" value={item.revisedPlan.revisedTarget === null ? "--" : money(item.revisedPlan.revisedTarget, market)} positive={item.revisedPlan.revisedTarget !== null} /><Metric label={item.revisedPlan.action === "EXIT" ? "OLD STOP · REFERENCE" : "PROTECT AT"} value={item.revisedPlan.action === "EXIT" || item.revisedPlan.protectiveStop === null ? "--" : money(item.revisedPlan.protectiveStop, market)} /><Metric label="UPSIDE LEFT" value={pct(item.revisedPlan.remainingUpsidePct)} positive={(item.revisedPlan.remainingUpsidePct ?? 0) > 0} /></View>
        <Text style={styles.cardFoot}>{item.revisedPlan.reasons[0]}</Text>
      </View>}
      <Text style={styles.cardFoot}>{item.remainingQuantity} remaining · {item.progress.daysHeld} held / {item.progress.daysRemaining} left · {item.risk.recommendation.replaceAll("_", " ")}</Text>
      {!!item.firstStopBreachedAt && (
        <Text style={styles.breachFoot}>
          First stop breach: {item.firstStopBreachPrice !== null && item.firstStopBreachPrice !== undefined ? money(item.firstStopBreachPrice, market) : "--"}
          {item.firstStopBreachStopLevel !== null && item.firstStopBreachStopLevel !== undefined ? ` vs stop ${money(item.firstStopBreachStopLevel, market)}` : ""}
          {" "}({item.firstStopBreachSource ?? "verified"})
        </Text>
      )}
      {item.exits.map((sale) => <Pressable key={sale.id} disabled={!!pendingLabel} onPress={() => setEditingSale({ trade: item, sale })} style={styles.saleRow}><Text style={styles.meta}>{sale.soldOn} · {sale.quantity} @ {money(sale.exitPrice, market)}</Text><Text style={styles.link}>Edit sale</Text></Pressable>)}
      <View style={styles.actions}><SmallAction label="Edit" disabled={!!pendingLabel} onPress={() => setEditing(item)} />{item.status === "OPEN" && <SmallAction label="Record sale" disabled={!!pendingLabel} onPress={() => setSelling(item)} />}<SmallAction label="Delete" disabled={!!pendingLabel} destructive onPress={() => remove(item)} /></View>
    </Card>;
    }} />
    <EditTradeSheet trade={editing} market={market} onClose={() => setEditing(null)} onSaved={(tradeId) => { setEditing(null); hapticSuccess(); markPending(tradeId, "Syncing…"); void load().finally(() => markPending(tradeId, null)); }} />
    <SaleSheet trade={selling} market={market} onClose={() => setSelling(null)} onSaved={(tradeId) => { setSelling(null); hapticSuccess(); markPending(tradeId, "Syncing…"); void load().finally(() => markPending(tradeId, null)); }} />
    <SaleSheet trade={editingSale?.trade ?? null} sale={editingSale?.sale} market={market} onClose={() => setEditingSale(null)} onSaved={(tradeId) => { setEditingSale(null); hapticSuccess(); markPending(tradeId, "Syncing…"); void load().finally(() => markPending(tradeId, null)); }} />
  </View>;
}

function EditTradeSheet({ trade, market, onClose, onSaved }: { trade: LedgerTrade | null; market: Market; onClose: () => void; onSaved: (tradeId: string) => void }) { return trade ? <EditTradeForm key={trade.id} trade={trade} market={market} onClose={onClose} onSaved={onSaved} /> : null; }
function EditTradeForm({ trade, market, onClose, onSaved }: { trade: LedgerTrade; market: Market; onClose: () => void; onSaved: (tradeId: string) => void }) {
  const [date, setDate] = useState(trade.boughtOn); const [price, setPrice] = useState(String(trade.buyPrice)); const [quantity, setQuantity] = useState(String(trade.quantity)); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [idempotencyKey] = useState(createMutationKey);
  const save = async () => { setBusy(true); setError(""); try { await updateTrade(trade.id, { market, boughtOn: date, buyPrice: amount(price), quantity: amount(quantity) }, idempotencyKey); onSaved(trade.id); } catch (cause) { hapticWarning(); setError(errorMessage(cause, "Trade could not be updated")); } finally { setBusy(false); } };
  return <Sheet visible title={`Edit ${trade.ticker}`} onClose={onClose}><Field value={date} onChangeText={setDate} placeholder="Purchase date YYYY-MM-DD" /><Field value={price} onChangeText={setPrice} placeholder="Buy price" keyboard="decimal-pad" /><Field value={quantity} onChangeText={setQuantity} placeholder="Quantity" keyboard="decimal-pad" />{!!error && <Text style={styles.errorText}>{error}</Text>}<Action label="Save trade" busy={busy} onPress={save} /></Sheet>;
}
function SaleSheet({ trade, sale, market, onClose, onSaved }: { trade: LedgerTrade | null; sale?: LedgerTrade["exits"][number]; market: Market; onClose: () => void; onSaved: (tradeId: string) => void }) { return trade ? <SaleForm key={`${trade.id}:${sale?.id ?? "new"}`} trade={trade} sale={sale} market={market} onClose={onClose} onSaved={onSaved} /> : null; }
function SaleForm({ trade, sale, market, onClose, onSaved }: { trade: LedgerTrade; sale?: LedgerTrade["exits"][number]; market: Market; onClose: () => void; onSaved: (tradeId: string) => void }) {
  const [date, setDate] = useState(sale?.soldOn ?? marketDate(market)); const [price, setPrice] = useState(String(sale?.exitPrice ?? trade.currentPrice ?? "")); const [quantity, setQuantity] = useState(String(sale?.quantity ?? trade.remainingQuantity)); const [reason, setReason] = useState(sale?.reason ?? "Manual exit"); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [idempotencyKey] = useState(createMutationKey);
  const save = async () => { setBusy(true); setError(""); try { const input = { market, soldOn: date, exitPrice: amount(price), quantity: amount(quantity), reason }; if (sale) await updateSale(trade.id, sale.id, input, idempotencyKey); else await recordSale(trade.id, input, idempotencyKey); onSaved(trade.id); } catch (cause) { hapticWarning(); setError(errorMessage(cause, "Sale could not be recorded")); } finally { setBusy(false); } };
  return <Sheet visible title={`${sale ? "Edit sale" : "Record sale"} · ${trade.ticker}`} onClose={onClose}><Field value={date} onChangeText={setDate} placeholder="Sale date YYYY-MM-DD" /><Field value={price} onChangeText={setPrice} placeholder="Sale price" keyboard="decimal-pad" /><Field value={quantity} onChangeText={setQuantity} placeholder="Quantity" keyboard="decimal-pad" /><Field value={reason} onChangeText={setReason} placeholder="Reason" />{!!error && <Text style={styles.errorText}>{error}</Text>}<Action label={sale ? "Save sale" : "Record sale"} busy={busy} onPress={save} /></Sheet>;
}
function Sheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: ReactNode }) { return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}><View style={styles.modalBackdrop}><View style={styles.sheet}><View style={styles.rowBetween}><Text style={styles.sectionTitle}>{title}</Text><Pressable onPress={onClose}><Text style={styles.link}>Close</Text></Pressable></View>{children}</View></View></Modal>; }
function Field({ value, onChangeText, placeholder, keyboard }: { value: string; onChangeText: (value: string) => void; placeholder: string; keyboard?: "decimal-pad" }) { return <TextInput style={styles.input} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.textSubtle} autoCapitalize="none" autoCorrect={false} keyboardType={keyboard} />; }
const SmallAction = ({ label, onPress, destructive, disabled }: { label: string; onPress: () => void; destructive?: boolean; disabled?: boolean }) => <Pressable disabled={disabled} style={[styles.smallAction, disabled && styles.actionDisabled]} onPress={onPress}><Text style={destructive ? styles.badValue : styles.link}>{label}</Text></Pressable>;
const Summary = ({ label, value }: { label: string; value: string }) => <View style={styles.summaryCard}><Text style={styles.metricLabel}>{label}</Text><Text style={styles.summaryValue}>{value}</Text></View>;

const styles = StyleSheet.create({
  flex: { flex: 1 }, errorText: { color: colors.rose }, list: { padding: 14, gap: 10, paddingBottom: 28 }, cardPending: { opacity: 0.72, borderColor: colors.amberBorder }, rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }, ticker: { color: colors.text, fontSize: 19, fontWeight: "900" }, meta: { color: colors.textSubtle, fontSize: 12, marginTop: 3 },
  metricRow: { flexDirection: "row", gap: 8 }, metricLabel: { color: colors.textSubtle, fontSize: 10, fontWeight: "700" }, goodValue: { color: colors.emerald, ...tabularNums }, badValue: { color: colors.rose, ...tabularNums }, warningValue: { color: colors.amber, fontSize: 11, fontWeight: "900" }, evidenceTitle: { color: colors.textSecondary, fontSize: 13, fontWeight: "700" }, cardFoot: { color: colors.textMuted, fontSize: 12 }, revisedPlan: { borderTopWidth: 1, borderTopColor: colors.borderStrong, paddingTop: 12, gap: 9 }, revisedPlanTitle: { color: colors.link, fontSize: 10, fontWeight: "900", letterSpacing: 1.1 },
  summary: { paddingHorizontal: 14, paddingBottom: 8, gap: 8 }, summaryCard: { width: 140, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: 12 }, summaryValue: { color: colors.text, fontSize: 17, fontWeight: "900", marginTop: 5, ...tabularNums }, actions: { flexDirection: "row", gap: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 }, smallAction: { minHeight: 40, justifyContent: "center", paddingHorizontal: 10 }, actionDisabled: { opacity: 0.4 }, saleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: colors.surfaceInset, borderRadius: radius.sm, padding: 10 }, link: { color: colors.link, fontWeight: "700" },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.72)" }, sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, borderColor: colors.borderStrong, borderWidth: 1, padding: 20, paddingBottom: 36, gap: 12 }, sectionTitle: { color: colors.text, fontSize: 18, fontWeight: "900", marginTop: 8, marginBottom: 10 }, input: { color: colors.text, backgroundColor: colors.surfaceInset, borderColor: colors.borderStrong, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 15, height: 50 },
  recoveryBox: { borderRadius: radius.md, borderWidth: 1, padding: 10, gap: 4 },
  recoveryActive: { backgroundColor: "rgba(14, 165, 233, 0.12)", borderColor: "rgba(56, 189, 248, 0.35)" },
  recoveryUnverified: { backgroundColor: colors.surfaceInset, borderColor: colors.border },
  recoveryTitle: { color: "#7dd3fc", fontSize: 10, fontWeight: "900", letterSpacing: 0.9 },
  recoveryUnverifiedTitle: { color: colors.textSubtle, fontSize: 10, fontWeight: "900", letterSpacing: 0.9 },
  recoveryHeadline: { color: colors.text, fontSize: 12, fontWeight: "700" },
  recoveryMeta: { color: colors.textMuted, fontSize: 11 },
  recoveryQualified: { color: colors.emerald, fontSize: 11, fontWeight: "700", marginTop: 2 },
  recoveryRecent: { color: colors.amber, fontSize: 11, fontWeight: "700", marginTop: 2 },
  breachFoot: { color: colors.rose, fontSize: 11, opacity: 0.85 },
});
