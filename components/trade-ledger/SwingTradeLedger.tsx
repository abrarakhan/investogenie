import { addSwingTrade, closeSwingTrade, updateSwingTrade } from "@/app/terminal/[market]/trade-ledger/actions";
import AssetPicker from "@/components/dashboard/AssetPicker";
import DeleteTradeButton from "@/components/trade-ledger/DeleteTradeButton";
import { summarizeSwingTradeLedger, type SwingLedgerTrade, type SwingTradeState } from "@/lib/swingTradeLedger";

const STATE: Record<SwingTradeState, { label: string; style: string }> = {
  ON_TRACK: { label: "On track", style: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" },
  TARGET_REACHED: { label: "Target reached", style: "border-cyan-400/30 bg-cyan-400/10 text-cyan-200" },
  STOP_BREACHED: { label: "Stop breached", style: "border-rose-500/35 bg-rose-500/12 text-rose-300" },
  TRAIL_BREACHED: { label: "Trail breached", style: "border-rose-500/35 bg-rose-500/12 text-rose-300" },
  WINDOW_EXPIRED: { label: "Window expired", style: "border-amber-500/35 bg-amber-500/10 text-amber-300" },
  NO_QUOTE: { label: "Quote unavailable", style: "border-white/15 bg-white/5 text-white/50" },
  CLOSED: { label: "Closed", style: "border-white/15 bg-white/5 text-white/50" },
};
const RISK = {
  NORMAL: { label: "Risk normal", style: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" },
  CAUTION: { label: "Market caution", style: "border-amber-500/35 bg-amber-500/10 text-amber-200" },
  RISK_OFF: { label: "Exit risk", style: "border-rose-500/40 bg-rose-500/12 text-rose-200" },
} as const;

const money = (value: number | null, currency: string) => value === null ? "—" : new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
const pct = (value: number | null) => value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
const price = (value: number | null) => value === null ? "—" : value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function SwingTradeLedger({ market, trades, defaults }: {
  market: "IN" | "US";
  trades: SwingLedgerTrade[];
  defaults: Record<string, string | undefined>;
}) {
  const open = trades.filter((trade) => trade.status === "OPEN");
  const closed = trades.filter((trade) => trade.status === "CLOSED");
  const summary = summarizeSwingTradeLedger(trades);
  const currency = market === "IN" ? "INR" : "USD";
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Summary label="Open trades" value={String(summary.openCount)} />
        <Summary label="Open capital" value={money(summary.openInvestedValue, currency)} />
        <Summary label="Unrealized P&L" value={money(summary.unrealizedPnlValue, currency)} tone={summary.unrealizedPnlValue >= 0 ? "good" : "bad"} />
        <Summary label={`Realized P&L · ${summary.closedCount} closed`} value={money(summary.realizedPnlValue, currency)} tone={summary.realizedPnlValue >= 0 ? "good" : "bad"} />
        <Summary label="Overall P&L" value={money(summary.overallPnlValue, currency)} tone={summary.overallPnlValue >= 0 ? "good" : "bad"} />
      </section>

      <details open={Boolean(defaults.ticker)} className="rounded-lg border border-white/10 bg-white/[0.02]">
        <summary className="cursor-pointer list-none px-5 py-4 font-semibold [&::-webkit-details-marker]:hidden">
          Log a purchased swing trade
          <span className="ml-2 text-sm font-normal text-white/40">Freeze the plan you bought against</span>
        </summary>
        <form action={addSwingTrade} className="grid gap-4 border-t border-white/10 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <input type="hidden" name="market" value={market} />
          <input type="hidden" name="entryStatus" value="OPEN" />
          <Field label="Stock name or ticker">
            <AssetPicker
              name="assetId"
              queryName="ticker"
              country={market}
              defaultAssetId={defaults.assetId}
              defaultTicker={defaults.ticker}
              placeholder="e.g. RELIANCE or Reliance Industries"
              required
            />
          </Field>
          <Field label="Purchase date"><input name="boughtOn" type="date" required max={today} defaultValue={defaults.boughtOn ?? today} className="field" /></Field>
          <Field label="Actual buy price"><input name="buyPrice" type="number" min="0.000001" step="any" required defaultValue={defaults.buyPrice ?? defaults.current ?? ""} className="field" /></Field>
          <Field label="Quantity"><input name="quantity" type="number" min="0.000001" step="any" required className="field" /></Field>
          <input type="hidden" name="strategyKey" value={defaults.strategy ?? ""} />
          <input type="hidden" name="projectionEntry" value={defaults.entry ?? ""} />
          <input type="hidden" name="projectedTarget" value={defaults.target ?? ""} />
          <input type="hidden" name="projectedStop" value={defaults.stop ?? ""} />
          <input type="hidden" name="expectedHoldingDays" value={defaults.days ?? ""} />
          <input type="hidden" name="projectedTrailingStop" value={defaults.trail ?? ""} />
          <p className="text-xs leading-5 text-white/40 sm:col-span-2 lg:col-span-3">
            Strategy, target, stop, trailing stop, and projected holding period are captured automatically from the latest swing candidate data.
          </p>
          <button className="h-11 self-end rounded-lg bg-[var(--ig-accent)] px-5 text-sm font-bold text-black transition-opacity hover:opacity-90">Add to ledger</button>
        </form>
      </details>

      <details className="rounded-lg border border-white/10 bg-white/[0.02]">
        <summary className="cursor-pointer list-none px-5 py-4 font-semibold [&::-webkit-details-marker]:hidden">
          Log a past trade
          <span className="ml-2 text-sm font-normal text-white/40">Record a trade that has already been sold</span>
        </summary>
        <form action={addSwingTrade} className="grid gap-4 border-t border-white/10 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <input type="hidden" name="market" value={market} />
          <input type="hidden" name="entryStatus" value="CLOSED" />
          <Field label="Stock name or ticker">
            <AssetPicker name="assetId" queryName="ticker" country={market} placeholder="e.g. RELIANCE" required />
          </Field>
          <Field label="Purchase date"><input name="boughtOn" type="date" required max={today} className="field" /></Field>
          <Field label="Actual buy price"><input name="buyPrice" type="number" min="0.000001" step="any" required className="field" /></Field>
          <Field label="Quantity"><input name="quantity" type="number" min="0.000001" step="any" required className="field" /></Field>
          <Field label="Exit date"><input name="closedOn" type="date" required max={today} className="field" /></Field>
          <Field label="Exit price"><input name="exitPrice" type="number" min="0.000001" step="any" required className="field" /></Field>
          <Field label="Exit reason"><select name="closeReason" className="field bg-[#090c12]"><option>Target reached</option><option>Trailing stop</option><option>Stop loss</option><option>Holding window expired</option><option>Manual exit</option></select></Field>
          <button className="h-11 self-end rounded-lg bg-[var(--ig-accent)] px-5 text-sm font-bold text-black transition-opacity hover:opacity-90">Add past trade</button>
          <p className="text-xs leading-5 text-white/40 sm:col-span-2 lg:col-span-4">
            The ledger uses the stock&apos;s existing swing analysis to fill the frozen strategy projection and records your actual realized result.
          </p>
        </form>
      </details>

      <section>
        <div className="mb-3"><h2 className="text-xl font-bold">Open trades</h2><p className="mt-1 text-sm text-white/42">Targets are projections, not guarantees. Exit alerts follow the frozen strategy plan.</p></div>
        {open.length === 0
          ? <div className="rounded-lg border border-white/10 px-5 py-12 text-center text-white/40">No open trades logged yet.</div>
          : <div className="grid gap-4">{open.map((trade) => <TradeCard key={trade.id} trade={trade} today={today} />)}</div>}
      </section>

      {closed.length > 0 && <section><div className="mb-3 flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-xl font-bold">Closed trades</h2><span className={`text-sm font-semibold tabular-nums ${summary.realizedPnlValue >= 0 ? "text-emerald-300" : "text-rose-300"}`}>Realized P&amp;L {money(summary.realizedPnlValue, currency)}</span></div><div className="grid gap-3">{closed.map((trade) => <TradeCard key={trade.id} trade={trade} today={today} />)}</div></section>}
    </div>
  );
}

function Summary({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return <div className="rounded-lg border border-white/10 bg-white/[0.025] p-4"><div className="text-xs uppercase tracking-[0.16em] text-white/35">{label}</div><div className={`mt-2 text-2xl font-bold ${tone === "good" ? "text-emerald-300" : tone === "bad" ? "text-rose-300" : ""}`}>{value}</div></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="text-xs text-white/50">{label}{children}</label>;
}

function TradeCard({ trade, today }: { trade: SwingLedgerTrade; today: string }) {
  const state = STATE[trade.progress.state];
  const progressWidth = Math.max(0, Math.min(100, trade.progress.targetProgressPct ?? 0));
  return (
    <article className="rounded-lg border border-white/10 bg-white/[0.025] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><div className="flex items-center gap-2"><h3 className="text-xl font-black">{trade.ticker}</h3><span className="text-xs text-white/35">{trade.exchange}</span></div><div className="mt-1 text-sm text-white/45">{trade.strategyLabel} · bought {trade.boughtOn}</div></div>
        <div className="flex flex-wrap justify-end gap-2">
          <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${state.style}`}>{state.label}</span>
          {trade.status === "OPEN" && <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${RISK[trade.risk.state].style}`}>{RISK[trade.risk.state].label}</span>}
        </div>
      </div>
      {trade.status === "OPEN" && <TradeRiskPanel trade={trade} />}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Buy" value={price(trade.buyPrice)} />
        <Metric label={trade.status === "CLOSED" ? "Exit" : "Current"} value={price(trade.status === "CLOSED" ? trade.exitPrice : trade.currentPrice)} tone={(trade.progress.pnlPct ?? 0) >= 0 ? "good" : "bad"} />
        <Metric label="P&L" value={pct(trade.progress.pnlPct)} tone={(trade.progress.pnlPct ?? 0) >= 0 ? "good" : "bad"} />
        <Metric label="Held / projected" value={`${trade.progress.daysHeld} / ${trade.expectedHoldingDays} days`} />
      </div>
      <div className="mt-5"><div className="flex justify-between text-xs"><span className="text-white/45">Progress from buy to projected target</span><span className="font-mono text-white/70">{trade.progress.targetProgressPct === null ? "—" : `${trade.progress.targetProgressPct.toFixed(0)}%`}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-white/8"><div className="h-full rounded-full bg-[var(--ig-accent)]" style={{ width: `${progressWidth}%` }} /></div></div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Target" value={price(trade.projectedTarget)} tone="good" />
        <Metric label="Upside to target" value={pct(trade.progress.remainingUpsidePct)} tone={(trade.progress.remainingUpsidePct ?? 0) >= 0 ? "good" : "muted"} />
        <Metric label="Effective trail" value={price(trade.effectiveTrailingStop)} tone={trade.progress.state === "TRAIL_BREACHED" ? "bad" : "warn"} />
        <Metric label="Days remaining" value={String(trade.progress.daysRemaining)} tone={trade.progress.daysRemaining ? "muted" : "warn"} />
      </div>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t border-white/8 pt-3 text-xs text-white/38"><span>Initial stop {price(trade.projectedStop)}</span><span>Quantity {trade.quantity.toLocaleString("en-IN")}</span><span>Quote {trade.quoteAsOf ?? "unavailable"}</span>{trade.notes && <span>{trade.notes}</span>}</div>
      {trade.status === "OPEN" && <details className="mt-4"><summary className="cursor-pointer text-sm font-semibold text-white/55 hover:text-white">Close trade</summary><form action={closeSwingTrade} className="mt-3 grid gap-3 rounded-lg border border-white/10 bg-black/25 p-3 sm:grid-cols-4"><input type="hidden" name="tradeId" value={trade.id} /><input type="hidden" name="market" value={trade.market} /><input aria-label="Exit date" name="closedOn" type="date" required min={trade.boughtOn} max={today} defaultValue={today} className="field" /><input aria-label="Exit price" name="exitPrice" type="number" min="0.000001" step="any" required defaultValue={trade.currentPrice ?? ""} placeholder="Exit price" className="field" /><select aria-label="Exit reason" name="closeReason" className="field bg-[#090c12]"><option>Target reached</option><option>Trailing stop</option><option>Stop loss</option><option>Holding window expired</option><option>Manual exit</option></select><button className="h-11 rounded-lg border border-white/15 bg-white/8 text-sm font-semibold hover:bg-white/12">Record exit</button></form></details>}
      <div className="mt-3 border-t border-white/5 pt-2">
        <details>
          <summary className="min-h-10 cursor-pointer list-none rounded-lg px-3 py-2.5 text-sm font-semibold text-white/55 hover:bg-white/5 hover:text-white [&::-webkit-details-marker]:hidden">Edit trade</summary>
          <form action={updateSwingTrade} className="mt-2 grid gap-3 rounded-lg border border-white/10 bg-black/25 p-3 sm:grid-cols-2 lg:grid-cols-4">
            <input type="hidden" name="tradeId" value={trade.id} />
            <input type="hidden" name="market" value={trade.market} />
            <Field label="Purchase date"><input name="boughtOn" type="date" required max={today} defaultValue={trade.boughtOn} className="field" /></Field>
            <Field label="Buy price"><input name="buyPrice" type="number" min="0.000001" step="any" required defaultValue={trade.buyPrice} className="field" /></Field>
            <Field label="Quantity"><input name="quantity" type="number" min="0.000001" step="any" required defaultValue={trade.quantity} className="field" /></Field>
            {trade.status === "CLOSED" && <>
              <Field label="Exit date"><input name="closedOn" type="date" required min={trade.boughtOn} max={today} defaultValue={trade.closedOn ?? ""} className="field" /></Field>
              <Field label="Exit price"><input name="exitPrice" type="number" min="0.000001" step="any" required defaultValue={trade.exitPrice ?? ""} className="field" /></Field>
              <Field label="Exit reason"><select name="closeReason" defaultValue={trade.closeReason ?? "Manual exit"} className="field bg-[#090c12]"><option>Target reached</option><option>Trailing stop</option><option>Stop loss</option><option>Holding window expired</option><option>Manual exit</option></select></Field>
            </>}
            <Field label="Notes"><input name="notes" maxLength={500} defaultValue={trade.notes ?? ""} className="field" /></Field>
            <button className="h-11 self-end rounded-lg border border-[var(--ig-accent)]/40 bg-[var(--ig-accent)]/10 px-4 text-sm font-semibold text-[var(--ig-accent)] hover:bg-[var(--ig-accent)]/15">Save changes</button>
          </form>
        </details>
        <DeleteTradeButton tradeId={trade.id} market={trade.market} ticker={trade.ticker} />
      </div>
    </article>
  );
}

function TradeRiskPanel({ trade }: { trade: SwingLedgerTrade }) {
  const hasWarning = trade.risk.state !== "NORMAL" || trade.risk.coverageWarning;
  if (!hasWarning) return null;
  const riskOff = trade.risk.state === "RISK_OFF";
  const panelClass = riskOff
    ? "border-rose-500/30 bg-rose-500/[0.08]"
    : "border-amber-500/25 bg-amber-500/[0.06]";
  return (
    <div className={`mt-4 rounded-lg border p-4 ${panelClass}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className={`text-sm font-bold ${riskOff ? "text-rose-200" : "text-amber-200"}`}>
          Market &amp; AI risk assessment
        </h4>
        <div className="flex gap-3 font-mono text-[11px] text-white/55">
          {trade.risk.marketMove1dPct !== null && <span>Market 1d {pct(trade.risk.marketMove1dPct)}</span>}
          {trade.risk.marketMove2dPct !== null && <span>Market 2d {pct(trade.risk.marketMove2dPct)}</span>}
          <span>News score {trade.risk.newsAdjustment >= 0 ? "+" : ""}{trade.risk.newsAdjustment.toFixed(1)}</span>
        </div>
      </div>
      {trade.risk.reasons.length > 0 && <ul className="mt-2 space-y-1 text-sm text-white/75">
        {trade.risk.reasons.map((reason) => <li key={reason}>• {reason}</li>)}
      </ul>}
      {trade.risk.coverageWarning && <p className="mt-2 text-xs font-medium text-amber-200/80">
        {trade.risk.coverageWarning} <a href="/settings" className="underline underline-offset-2">Open Settings</a>
      </p>}
      {trade.risk.newsAsOf && <p className="mt-2 text-[11px] text-white/35">
        News and AI last assessed {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(trade.risk.newsAsOf))} IST
      </p>}
      {trade.risk.evidence.length > 0 && <div className="mt-3 border-t border-white/10 pt-2">
        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/35">Recent evidence</div>
        <div className="mt-1 space-y-1.5">
          {trade.risk.evidence.map((item) => <a key={`${item.url}-${item.publishedAt}`} href={item.url} target="_blank" rel="noreferrer" className="block text-xs text-white/60 hover:text-white hover:underline">
            {item.direction === "NEGATIVE" ? "Negative" : item.direction === "POSITIVE" ? "Positive" : "Neutral"}: {item.title}
          </a>)}
        </div>
      </div>}
      <p className="mt-3 text-[11px] text-white/35">This warning does not rewrite the frozen strategy plan or guarantee an outcome.</p>
    </div>
  );
}

function Metric({ label, value, tone = "muted" }: { label: string; value: string; tone?: "good" | "bad" | "warn" | "muted" }) {
  const color = tone === "good" ? "text-emerald-300" : tone === "bad" ? "text-rose-300" : tone === "warn" ? "text-amber-300" : "text-white/85";
  return <div className="rounded-lg bg-black/25 px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-white/35">{label}</div><div className={`mt-1 text-sm font-semibold tabular-nums ${color}`}>{value}</div></div>;
}
