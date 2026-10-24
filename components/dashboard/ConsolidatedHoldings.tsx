import Link from "next/link";
import type { ConsolidatedHolding, ConsolidatedHoldings } from "@/lib/portfolioHoldings";

const inr = (value: number | null) => value === null
  ? "—"
  : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
const qty = (value: number) => value.toLocaleString("en-IN", { maximumFractionDigits: 3 });
const day = (value: string | null) => value
  ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" }).format(new Date(value))
  : "—";

export function HoldingsGroup({ title, rows, note, total }: { title: string; rows: ConsolidatedHolding[]; note: string; total: number }) {
  const showCost = rows.some((row) => row.invested !== null);
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold">{title} <span className="font-normal text-white/40">({rows.length})</span></h3>
        <span className="text-sm font-semibold tabular-nums">{inr(total)}</span>
      </div>
      <p className="mb-2 text-[11px] text-white/38">{note}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-white/45">None.</p>
      ) : (
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[#090c12] text-left text-xs uppercase tracking-wider text-white/40">
              <tr>
                <th className="py-2">Holding</th>
                <th className="py-2 text-right">Qty</th>
                <th className="py-2 text-right">Price</th>
                {showCost && <th className="py-2 text-right">Invested</th>}
                <th className="py-2 text-right">Value</th>
                {showCost && <th className="py-2 text-right">P/L</th>}
                <th className="py-2 text-right">Share</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-t border-white/5">
                  <td className="max-w-[18rem] py-2">
                    <span className="block truncate font-semibold" title={row.name ?? row.ticker}>{row.source === "MUTUAL_FUND" ? (row.name ?? row.ticker) : row.ticker}</span>
                    {row.source === "ICICI" && row.name && <span className="block truncate text-[11px] text-white/40">{row.name}</span>}
                  </td>
                  <td className="py-2 text-right tabular-nums">{qty(row.quantity)}</td>
                  <td className="py-2 text-right tabular-nums">
                    {row.price === null ? "No price" : row.price.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                    {row.priceSource === "STATEMENT" && <span className="ml-1 text-[10px] text-amber-200/80">CAS</span>}
                    {row.stale && <span className="block text-[10px] text-amber-200/80">as of {day(row.asOf)}</span>}
                  </td>
                  {showCost && <td className="py-2 text-right tabular-nums text-white/70">{inr(row.invested)}</td>}
                  <td className="py-2 text-right tabular-nums">{inr(row.value)}</td>
                  {showCost && (
                    <td className={`py-2 text-right tabular-nums ${row.value !== null && row.invested !== null && row.value < row.invested ? "text-rose-400" : "text-emerald-400"}`}>
                      {row.value !== null && row.invested !== null ? `${row.value >= row.invested ? "+" : ""}${inr(row.value - row.invested)}` : "—"}
                    </td>
                  )}
                  <td className="py-2 text-right tabular-nums text-white/55">
                    {row.value === null || total <= 0 ? "—" : `${((row.value / total) * 100).toFixed(1)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Terminal holdings: ICICI stock holdings in full, mutual funds only as a total (the fund list
 * lives on the Mutual Funds page), and the consolidated INR value of both.
 */
export default function ConsolidatedHoldingsSection({ data, manualValue }: { data: ConsolidatedHoldings; manualValue: number }) {
  const icici = data.holdings.filter((row) => row.source === "ICICI");
  const iciciCosted = icici.filter((row) => row.invested !== null && row.value !== null);
  const iciciInvested = iciciCosted.reduce((sum, row) => sum + (row.invested ?? 0), 0);
  const iciciGain = iciciCosted.reduce((sum, row) => sum + (row.value ?? 0), 0) - iciciInvested;
  const total = data.totalValue + manualValue;
  const unpriced = data.totals.ICICI.unpriced + data.totals.MUTUAL_FUND.unpriced;
  return (
    <section className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-[var(--ig-accent)]/30 bg-[var(--ig-accent)]/[0.06] p-5">
          <div className="text-xs uppercase tracking-widest text-white/45">Consolidated value</div>
          <div className="mt-1 text-3xl font-bold tabular-nums">{inr(total)}</div>
          <div className="mt-1 text-xs text-white/45">
            ICICI stocks + mutual funds{manualValue > 0 ? " + recorded positions" : ""}
            {unpriced > 0 ? ` · ${unpriced} holding${unpriced === 1 ? "" : "s"} without a price excluded` : ""}
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <div className="text-xs uppercase tracking-widest text-white/45">ICICI stocks</div>
          <div className="mt-1 text-2xl font-bold tabular-nums">{inr(data.totals.ICICI.value)}</div>
          {iciciCosted.length > 0 && (
            <div className={`text-sm tabular-nums ${iciciGain >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {iciciGain >= 0 ? "▲" : "▼"} {inr(Math.abs(iciciGain))} on {inr(iciciInvested)} invested
            </div>
          )}
          <div className="mt-1 text-xs text-white/45">
            {data.totals.ICICI.count} holdings · synced {day(data.iciciCapturedAt)}
            {data.totals.ICICI.unpriced > 0 && <span className="block text-amber-200/80">{data.totals.ICICI.unpriced} without a Breeze price</span>}
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <div className="text-xs uppercase tracking-widest text-white/45">Mutual funds</div>
          <div className="mt-1 text-2xl font-bold tabular-nums">{inr(data.totals.MUTUAL_FUND.value)}</div>
          <div className="mt-1 text-xs text-white/45">
            {data.totals.MUTUAL_FUND.stale > 0 && <span className="block text-amber-200/80">{data.totals.MUTUAL_FUND.stale} valued at an NAV older than 5 days</span>}
            {data.totals.MUTUAL_FUND.count} funds · <Link href="/portfolio/mutual-funds" className="text-[var(--ig-accent)] hover:underline">View fund holdings</Link>
          </div>
        </div>
      </div>
      <HoldingsGroup
        title="ICICI Direct stocks"
        rows={icici}
        total={data.totals.ICICI.value}
        note="ICICI demat holdings valued by Breeze: the live Breeze quote when newer than the last account sync, otherwise the market price and average cost Breeze reported at that sync."
      />
    </section>
  );
}
