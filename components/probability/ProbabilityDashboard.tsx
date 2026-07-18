import type { ProbabilitySummary } from "@/lib/analytics/probability/types";
import { formatMoney } from "@/lib/markets";

const pct = (value: number, digits = 1) => `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
const plainPct = (value: number, digits = 1) => `${value.toFixed(digits)}%`;

function toneClass(value: number): string {
  if (value >= 60) return "text-emerald-300";
  if (value <= 45) return "text-rose-300";
  return "text-white/75";
}

function contributionTone(tone: "positive" | "negative" | "neutral") {
  if (tone === "positive") return "border-emerald-400/20 bg-emerald-400/8 text-emerald-200";
  if (tone === "negative") return "border-rose-400/20 bg-rose-400/8 text-rose-200";
  return "border-white/10 bg-white/[0.04] text-white/55";
}

export default function ProbabilityDashboard({ summary }: { summary: ProbabilitySummary }) {
  const hitRate = summary.rows.find((r) => r.calibration.hitRatePct !== null)?.calibration.hitRatePct ?? null;

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-[var(--ig-accent)]">Probability Engine</p>
            <h2 className="mt-2 text-2xl font-black">21 trading-day return distribution</h2>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-white/55">
              Probabilistic estimates, not recommendations. Historical hit rate: {hitRate === null ? "calibration pending" : plainPct(hitRate)}.
              Current version uses local OHLCV momentum, snapback, and EWMA volatility while the heavier GARCH/HMM/sentiment/backtest pipeline is staged.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
              <b className="block text-lg tabular-nums">{summary.coverage.forecasted}</b>
              <span className="text-white/40">Forecasts</span>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
              <b className="block text-lg tabular-nums">{summary.horizonDays}d</b>
              <span className="text-white/40">Horizon</span>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
              <b className="block text-lg tabular-nums">{summary.coverage.skippedInsufficientHistory}</b>
              <span className="text-white/40">Skipped</span>
            </div>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-3xl border border-white/10">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1220px] text-sm">
            <thead className="bg-white/[0.035] text-left text-xs uppercase tracking-wider text-white/40">
              <tr>
                <th className="px-4 py-3">Ticker</th>
                <th className="px-4 py-3 text-right">Price</th>
                <th className="px-4 py-3 text-right">P(up)</th>
                <th className="px-4 py-3 text-right">Median ret.</th>
                <th className="px-4 py-3 text-right">21d sigma</th>
                <th className="px-4 py-3 text-right">Drawdown risk</th>
                <th className="px-4 py-3 text-right">5th price</th>
                <th className="px-4 py-3 text-right">Median price</th>
                <th className="px-4 py-3 text-right">95th price</th>
                <th className="px-4 py-3">Top contributors</th>
                <th className="px-4 py-3 text-right">As of</th>
              </tr>
            </thead>
            <tbody>
              {summary.rows.map((row) => (
                <tr key={`${row.exchange}:${row.ticker}`} className="border-t border-white/5 align-top">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-white/90">{row.ticker}</div>
                    <div className="max-w-[190px] truncate text-[11px] text-white/35">{row.name}</div>
                    <div className="text-[10px] uppercase text-white/25">{row.exchange} · {row.bars} bars</div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="font-semibold tabular-nums text-white/90">{formatMoney(row.lastPrice, row.currency)}</div>
                    {row.changePct === null ? (
                      <div className="text-[10px] text-white/25">last close</div>
                    ) : (
                      <div className={`text-[11px] tabular-nums ${row.changePct >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                        {pct(row.changePct, 2)}
                      </div>
                    )}
                  </td>
                  <td className={`px-4 py-3 text-right text-lg font-black tabular-nums ${toneClass(row.probabilityUpPct)}`}>
                    {plainPct(row.probabilityUpPct, 0)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-white/80">{pct(row.percentiles.p50)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-white/65">{plainPct(row.sigma21Pct)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-amber-200">{plainPct(row.drawdownRiskPct, 0)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-rose-200">{formatMoney(row.priceRange.p5, row.currency)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-white/80">{formatMoney(row.priceRange.p50, row.currency)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-emerald-200">{formatMoney(row.priceRange.p95, row.currency)}</td>
                  <td className="px-4 py-3">
                    <div className="flex max-w-[320px] flex-wrap gap-1.5">
                      {row.contributions.map((c) => (
                        <span key={c.label} className={`rounded-full border px-2 py-0.5 text-[10px] ${contributionTone(c.tone)}`}>
                          {c.label} {c.value >= 0 ? "+" : ""}{c.value.toFixed(1)}z
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right text-xs tabular-nums text-white/35">{row.asOf}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="rounded-2xl border border-amber-300/20 bg-amber-300/8 px-4 py-3 text-xs leading-relaxed text-amber-100/80">
        Limitations: this first version does not yet include earnings surprise, news sentiment, GARCH convergence diagnostics, HMM regime probabilities, or walk-forward calibration. Rows should be read as scenario distributions only.
      </p>
    </div>
  );
}
