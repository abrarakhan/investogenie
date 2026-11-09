import type { StrategyRetrospectiveScorecard } from "@/lib/strategyRetrospective";

const ENGINE_LABELS: Record<string, string> = {
  STRONG_SWING: "Strong Swing",
  MOMENTUM_IGNITION: "Momentum Ignition",
  MOMENTUM_IGNITION_V2: "Momentum Ignition V2",
  TREND_CONTINUATION: "Trend Continuation",
};
const pct = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
const tone = (value: number) => value > 0 ? "text-emerald-300" : value < 0 ? "text-rose-300" : "text-white/65";

export default function RetrospectiveDashboard({ rows }: { rows: StrategyRetrospectiveScorecard[] }) {
  const horizons = [...new Set(rows.map((row) => row.horizonSessions))];
  return (
    <section className="space-y-4 rounded-3xl border border-white/10 bg-white/[0.025] p-5">
      <div>
        <p className="text-xs uppercase tracking-[0.22em] text-violet-300">Backward-looking test</p>
        <h2 className="mt-2 text-2xl font-black">Recorded-signal retrospective</h2>
        <p className="mt-2 max-w-4xl text-sm leading-relaxed text-white/55">
          This grades signals the production app actually recorded as ready. Entry is the next completed session&apos;s
          open, never the signal-day close, and outcomes are calculated in Python after 5, 10 and 20 sessions.
          It is point-in-time evidence, not a reconstructed multi-year simulation.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-amber-300/20 bg-amber-300/8 px-4 py-3 text-sm text-amber-100/75">
          No recorded ready signal has completed a five-session horizon yet. Collection continues automatically.
        </p>
      ) : horizons.map((horizon) => {
        const group = rows.filter((row) => row.horizonSessions === horizon);
        const leader = group.filter((row) => row.observations >= 20)
          .sort((a, b) => b.averageReturnPct - a.averageReturnPct)[0];
        return (
          <div key={horizon} className="overflow-hidden rounded-2xl border border-white/8">
            <div className="flex items-center justify-between bg-white/[0.035] px-4 py-3">
              <h3 className="font-bold">{horizon}-session outcome</h3>
              <span className="text-xs text-white/40">
                {leader ? `Current leader: ${ENGINE_LABELS[leader.engine] ?? leader.engine}` : "Need 20+ observations for a leader"}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] text-sm">
                <thead className="text-left text-[11px] uppercase tracking-wider text-white/35">
                  <tr><th className="px-4 py-3">Strategy</th><th className="px-4 py-3 text-right">Sample</th>
                    <th className="px-4 py-3 text-right">Positive</th><th className="px-4 py-3 text-right">Average</th>
                    <th className="px-4 py-3 text-right">Median</th><th className="px-4 py-3 text-right">Avg MFE</th>
                    <th className="px-4 py-3 text-right">Avg MAE</th><th className="px-4 py-3">Confidence</th></tr>
                </thead>
                <tbody>{group.map((row) => (
                  <tr key={row.engine} className="border-t border-white/5">
                    <td className="px-4 py-3 font-semibold">{ENGINE_LABELS[row.engine] ?? row.engine}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.observations}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.winRatePct.toFixed(1)}%</td>
                    <td className={`px-4 py-3 text-right font-semibold tabular-nums ${tone(row.averageReturnPct)}`}>{pct(row.averageReturnPct)}</td>
                    <td className={`px-4 py-3 text-right tabular-nums ${tone(row.medianReturnPct)}`}>{pct(row.medianReturnPct)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-emerald-200/80">{pct(row.averageMaxFavorablePct)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-rose-200/80">{pct(row.averageMaxAdversePct)}</td>
                    <td className="px-4 py-3 text-xs text-white/45">{row.observations >= 100 ? "Useful" : row.observations >= 30 ? "Developing" : "Too small"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        );
      })}
      <p className="text-[11px] leading-relaxed text-white/35">
        MFE/MAE are the average best and worst intraperiod moves from the next-session open. Rankings are withheld below
        20 observations and remain advisory; different holding horizons must not be mixed.
      </p>
    </section>
  );
}
