import { addSwingTrade, closeSwingTrade } from "@/app/terminal/[market]/trade-ledger/actions";
import DeleteTradeButton from "@/components/trade-ledger/DeleteTradeButton";
import type { SwingLedgerTrade, SwingTradeState } from "@/lib/swingTradeLedger";

const STATE: Record<SwingTradeState, { label: string; style: string }> = {
  ON_TRACK: { label: "On track", style: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" },
  TARGET_REACHED: { label: "Target reached", style: "border-cyan-400/30 bg-cyan-400/10 text-cyan-200" },
  STOP_BREACHED: { label: "Stop breached", style: "border-rose-500/35 bg-rose-500/12 text-rose-300" },
  TRAIL_BREACHED: { label: "Trail breached", style: "border-rose-500/35 bg-rose-500/12 text-rose-300" },
  WINDOW_EXPIRED: { label: "Window expired", style: "border-amber-500/35 bg-amber-500/10 text-amber-300" },
  NO_QUOTE: { label: "Quote unavailable", style: "border-white/15 bg-white/5 text-white/50" },
  CLOSED: { label: "Closed", style: "border-white/15 bg-white/5 text-white/50" },
};

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
  const invested = open.reduce((sum, trade) => sum + trade.progress.investedValue, 0);
  const marked = open.reduce((sum, trade) => sum + (trade.progress.currentValue ?? trade.progress.investedValue), 0);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-3">
        <Summary label="Open trades" value={String(open.length)} />
        <Summary label="Capital logged" value={money(invested, market === "IN" ? "INR" : "USD")} />
        <Summary label="Open P&L" value={money(marked - invested, market === "IN" ? "INR" : "USD")} tone={marked >= invested ? "good" : "bad"} />
      </section>

      <details open={Boolean(defaults.ticker)} className="rounded-lg border border-white/10 bg-white/[0.02]">
        <summary className="cursor-pointer list-none px-5 py-4 font-semibold [&::-webkit-details-marker]:hidden">
          Log a purchased swing trade
          <span className="ml-2 text-sm font-normal text-white/40">Freeze the plan you bought against</span>
        </summary>
        <form action={addSwingTrade} className="grid gap-4 border-t border-white/10 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <input type="hidden" name="market" value={market} />
          <input type="hidden" name="assetId" value={defaults.assetId ?? ""} />
          <Field label="Ticker"><input name="ticker" required defaultValue={defaults.ticker ?? ""} className="field uppercase" /></Field>
          <Field label="Purchase date"><input name="boughtOn" type="date" required max={today} defaultValue={defaults.boughtOn ?? today} className="field" /></Field>
          <Field label="Actual buy price"><input name="buyPrice" type="number" min="0.000001" step="any" required defaultValue={defaults.buyPrice ?? defaults.current ?? ""} className="field" /></Field>
          <Field label="Quantity"><input name="quantity" type="number" min="0.000001" step="any" required className="field" /></Field>
          <Field label="Strategy">
            <select name="strategyKey" defaultValue={defaults.strategy ?? "DEFAULT_SWING"} className="field bg-[#090c12]">
              <option value="DEFAULT_SWING">Default Swing</option><option value="QULLAMAGGIE">Qullamaggie Momentum</option>
              <option value="MINERVINI">Minervini VCP</option><option value="DARVAS">Darvas Box</option>
              <option value="PTJ">PTJ 200-Day Trend</option><option value="SIMONS">Simons Quant Reversion</option>
            </select>
          </Field>
          <Field label="Projected target"><input name="projectedTarget" type="number" min="0" step="any" defaultValue={defaults.target ?? ""} placeholder="Use current signal" className="field" /></Field>
          <Field label="Initial stop"><input name="projectedStop" type="number" min="0" step="any" defaultValue={defaults.stop ?? ""} placeholder="Use current signal" className="field" /></Field>
          <Field label="Expected trading days"><input name="expectedHoldingDays" type="number" min="1" max="365" defaultValue={defaults.days ?? ""} placeholder="Use current signal" className="field" /></Field>
          <input type="hidden" name="projectedTrailingStop" value={defaults.trail ?? ""} />
          <label className="text-xs text-white/50 sm:col-span-2 lg:col-span-3">Notes<input name="notes" maxLength={1000} placeholder="Broker order, thesis, or exit discipline" className="field" /></label>
          <button className="h-11 self-end rounded-lg bg-[var(--ig-accent)] px-5 text-sm font-bold text-black transition-opacity hover:opacity-90">Add to ledger</button>
        </form>
      </details>

      <section>
        <div className="mb-3"><h2 className="text-xl font-bold">Open trades</h2><p className="mt-1 text-sm text-white/42">Targets are projections, not guarantees. Exit alerts follow the frozen strategy plan.</p></div>
        {open.length === 0
          ? <div className="rounded-lg border border-white/10 px-5 py-12 text-center text-white/40">No open trades logged yet.</div>
          : <div className="grid gap-4 xl:grid-cols-2">{open.map((trade) => <TradeCard key={trade.id} trade={trade} today={today} />)}</div>}
      </section>

      {closed.length > 0 && <section><h2 className="mb-3 text-xl font-bold">Closed trades</h2><div className="grid gap-3 xl:grid-cols-2">{closed.map((trade) => <TradeCard key={trade.id} trade={trade} today={today} />)}</div></section>}
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
        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${state.style}`}>{state.label}</span>
      </div>
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
        <DeleteTradeButton tradeId={trade.id} market={trade.market} ticker={trade.ticker} />
      </div>
    </article>
  );
}

function Metric({ label, value, tone = "muted" }: { label: string; value: string; tone?: "good" | "bad" | "warn" | "muted" }) {
  const color = tone === "good" ? "text-emerald-300" : tone === "bad" ? "text-rose-300" : tone === "warn" ? "text-amber-300" : "text-white/85";
  return <div className="rounded-lg bg-black/25 px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-white/35">{label}</div><div className={`mt-1 text-sm font-semibold tabular-nums ${color}`}>{value}</div></div>;
}
