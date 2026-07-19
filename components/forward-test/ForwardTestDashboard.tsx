import type { ScorecardRow, PositionRow } from "@/lib/forwardTest";

const pct = (v: number | null, d = 2) => (v === null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(d)}%`);
const num = (v: number | null, d = 2) => (v === null ? "—" : v.toFixed(d));
const label = (m: string) => (m === "PROBABILITY" ? "Probability" : m.replace("SWING:", ""));

const STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-white/10 text-white/50",
  OPEN: "bg-sky-400/15 text-sky-300",
  TARGET_HIT: "bg-emerald-400/15 text-emerald-300",
  STOP_HIT: "bg-rose-400/15 text-rose-300",
  EXPIRED: "bg-amber-400/15 text-amber-200",
  UNFILLED: "bg-white/5 text-white/35",
};

function tone(v: number | null): string {
  if (v === null) return "text-white/35";
  return v > 0 ? "text-emerald-300" : v < 0 ? "text-rose-300" : "text-white/70";
}

export default function ForwardTestDashboard({
  scorecard, positions,
}: {
  scorecard: ScorecardRow[];
  positions: PositionRow[];
}) {
  const graded = scorecard.reduce((s, r) => s + r.closed_positions, 0);

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
        <p className="text-xs uppercase tracking-[0.22em] text-[var(--ig-accent)]">Forward test</p>
        <h2 className="mt-2 text-2xl font-black">Out-of-sample scorecard</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-white/55">
          Every call is frozen when it is made and graded against what actually happened — no re-running the
          model with hindsight. Swing calls rest at their trigger and only count once filled.
        </p>
        {graded === 0 && (
          <p className="mt-3 rounded-2xl border border-amber-300/20 bg-amber-300/8 px-4 py-3 text-xs leading-relaxed text-amber-100/80">
            No positions have closed yet, so every accuracy column is empty — that is expected, not a failure.
            Probability calls need their full horizon, and swing calls must fill first. Treat the numbers as
            meaningless until the closed count is well into double digits.
          </p>
        )}
      </section>

      <section className="overflow-hidden rounded-3xl border border-white/10">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] text-sm">
            <thead className="bg-white/[0.035] text-left text-xs uppercase tracking-wider text-white/40">
              <tr>
                <th className="px-4 py-3">Method</th>
                <th className="px-4 py-3 text-right">Pending</th>
                <th className="px-4 py-3 text-right">Open</th>
                <th className="px-4 py-3 text-right">Unfilled</th>
                <th className="px-4 py-3 text-right">Closed</th>
                <th className="px-4 py-3 text-right">Win rate</th>
                <th className="px-4 py-3 text-right">Projected</th>
                <th className="px-4 py-3 text-right">Realised</th>
                <th className="px-4 py-3 text-right">Bias</th>
                <th className="px-4 py-3 text-right">Avg max DD</th>
                <th className="px-4 py-3 text-right">Band cov.</th>
              </tr>
            </thead>
            <tbody>
              {scorecard.length === 0 && (
                <tr><td colSpan={11} className="px-4 py-10 text-center text-white/35">No cohorts enrolled yet.</td></tr>
              )}
              {scorecard.map((r) => (
                <tr key={`${r.method}:${r.market}`} className="border-t border-white/5">
                  <td className="px-4 py-3 font-semibold text-white/90">{label(r.method)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-white/45">{r.pending_positions}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-sky-300">{r.open_positions}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-white/35">{r.unfilled_positions}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-white/70">{r.closed_positions}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-white/85">{r.win_rate_pct === null ? "—" : `${r.win_rate_pct.toFixed(0)}%`}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-white/55">{pct(r.avg_projected_pct)}</td>
                  <td className={`px-4 py-3 text-right tabular-nums ${tone(r.avg_realized_pct)}`}>{pct(r.avg_realized_pct)}</td>
                  {/* Realised minus projected. Persistently non-zero is bias, not noise. */}
                  <td className={`px-4 py-3 text-right font-semibold tabular-nums ${tone(r.avg_projection_error_pct)}`}>{pct(r.avg_projection_error_pct)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-amber-200">{pct(r.avg_max_adverse_pct)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-white/70">{r.band_coverage_pct === null ? "—" : `${r.band_coverage_pct.toFixed(0)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-white/5 px-4 py-3 text-[11px] leading-relaxed text-white/35">
          <b className="text-white/55">Bias</b> is realised minus projected: a value that stays negative means the engine
          systematically over-promises, which is actionable long before the win rate settles.
          <b className="ml-2 text-white/55">Band cov.</b> is the share of outcomes landing inside the projected 5th–95th
          range; a well-calibrated 90% band should sit near 90%.
        </p>
      </section>

      <section className="overflow-hidden rounded-3xl border border-white/10">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] text-sm">
            <thead className="bg-white/[0.035] text-left text-xs uppercase tracking-wider text-white/40">
              <tr>
                <th className="px-4 py-3">Ticker</th>
                <th className="px-4 py-3">Method</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Entry</th>
                <th className="px-4 py-3 text-right">Target</th>
                <th className="px-4 py-3 text-right">Stop</th>
                <th className="px-4 py-3 text-right">Projected</th>
                <th className="px-4 py-3 text-right">Realised</th>
                <th className="px-4 py-3 text-right">Max DD</th>
                <th className="px-4 py-3 text-right">Enrolled</th>
              </tr>
            </thead>
            <tbody>
              {positions.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-white/35">No positions yet.</td></tr>
              )}
              {positions.map((p) => (
                <tr key={p.id} className="border-t border-white/5">
                  <td className="px-4 py-3">
                    <span className="font-semibold text-white/90">{p.ticker}</span>
                    {p.direction === "SHORT" && <span className="ml-2 rounded bg-rose-400/15 px-1.5 py-0.5 text-[10px] text-rose-300">SHORT</span>}
                  </td>
                  <td className="px-4 py-3 text-white/55">{label(p.method)}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLE[p.status] ?? "bg-white/10 text-white/50"}`}>
                      {p.status.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-white/80">{num(p.entry_price)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-emerald-200/80">{num(p.projected_target)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-rose-200/80">{num(p.projected_stop)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-white/55">{pct(p.projected_return_pct)}</td>
                  <td className={`px-4 py-3 text-right tabular-nums ${tone(p.realized_return_pct)}`}>{pct(p.realized_return_pct)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-amber-200/80">{pct(p.max_adverse_pct)}</td>
                  <td className="px-4 py-3 text-right text-xs tabular-nums text-white/35">{p.enrolled_on}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
