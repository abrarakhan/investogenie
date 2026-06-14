import type { TopSetup } from "@/lib/engines-runtime";
import type { OverlapReport } from "@/lib/analytics/fundOverlap";
import type { MacroMatrix } from "@/lib/analytics/macroCorrelator";

const VERDICT_STYLE: Record<string, string> = {
  LONG_BREAKOUT: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  COILED_SPRING: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  BREAKOUT_UNCONFIRMED: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  SHORT_BREAKDOWN: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  SHORT_COILED_SPRING: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30",
  BREAKDOWN_UNCONFIRMED: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  NO_SETUP: "bg-white/5 text-white/40 border-white/10",
};

const MACRO_STYLE: Record<string, string> = {
  ACCUMULATION_ZONE: "text-emerald-300",
  DISTRIBUTION_ZONE: "text-rose-300",
  COINCIDENT: "text-cyan-300",
  WEAK: "text-white/40",
};

function Panel({
  title,
  tag,
  children,
}: {
  title: string;
  tag: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.02] p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold">{title}</h2>
        <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] uppercase tracking-widest text-[var(--ig-accent)]">
          {tag}
        </span>
      </div>
      {children}
    </section>
  );
}

export default function EngineSection({
  swing,
  overlap,
  macro,
}: {
  swing: TopSetup[];
  overlap: OverlapReport | null;
  macro: MacroMatrix | null;
}) {
  return (
    <div className="space-y-8">
      <h2 className="text-sm uppercase tracking-[0.25em] text-white/40">
        Analytical engines · live
      </h2>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* ---- Swing setups ---- */}
        <Panel title="Swing Signals" tag="Derivatives · OI-validated">
          {swing.length === 0 ? (
            <p className="text-sm text-white/50">No active setups on the latest bar.</p>
          ) : (
            <ul className="space-y-3">
              {swing.map((s) => (
                <li
                  key={s.ticker}
                  className="rounded-2xl border border-white/5 bg-black/20 p-4"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">
                      {s.ticker}
                      <span className={`ml-2 rounded px-1.5 py-0.5 text-[9px] font-bold ${s.direction === "SHORT" ? "bg-rose-500/20 text-rose-300" : "bg-emerald-500/20 text-emerald-300"}`}>
                        {s.direction}
                      </span>
                    </span>
                    <span
                      className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${VERDICT_STYLE[s.verdict]}`}
                    >
                      {s.verdict.replaceAll("_", " ")}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[var(--ig-primary)] to-[var(--ig-accent)]"
                      style={{ width: `${Math.round(s.score * 100)}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-white/50">{s.reason}</p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] tabular-nums">
                    <span className="text-white/70">Entry <b>{s.entry.toFixed(2)}</b></span>
                    <span className="text-emerald-400">Target <b>{s.target.toFixed(2)}</b></span>
                    <span className="text-rose-400">Stop <b>{s.stopLoss.toFixed(2)}</b></span>
                    <span className="text-amber-300/80">Trail <b>{s.trailingStop.toFixed(2)}</b></span>
                    <span className="text-white/50">~{s.expectedDays}d</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* ---- Fund overlap ---- */}
        <Panel title="Fund Overlap X-Ray" tag="Mutual funds · congruence">
          {!overlap ? (
            <p className="text-sm text-white/50">No fund look-through data.</p>
          ) : (
            <div className="space-y-4">
              {overlap.flaggedOverlaps.length > 0 ? (
                overlap.flaggedOverlaps.map((o) => (
                  <div
                    key={`${o.fundA}-${o.fundB}`}
                    className="flex items-center justify-between rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-3"
                  >
                    <span className="text-sm">
                      {o.fundA} ↔ {o.fundB}
                    </span>
                    <span className="font-bold tabular-nums text-rose-300">
                      {o.overlapPct.toFixed(0)}% overlap
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-emerald-300">No overlaps above threshold.</p>
              )}

              {overlap.instructions.length > 0 && (
                <ul className="space-y-2">
                  {overlap.instructions.slice(0, 3).map((ins, i) => (
                    <li key={i} className="flex gap-2 text-xs text-white/60">
                      <span className="mt-0.5 text-[var(--ig-accent)]">▸</span>
                      <span>{ins.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Panel>
      </div>

      {/* ---- Macro correlator ---- */}
      <Panel title="Cross-Asset Macro Correlator" tag="Rolling 30 / 90-day lead-lag">
        {!macro ? (
          <p className="text-sm text-white/50">No macro series available.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-white/40">
                <tr>
                  <th className="py-2">Indicator</th>
                  <th className="py-2">Sector</th>
                  <th className="py-2 text-right">30d ρ</th>
                  <th className="py-2 text-right">90d ρ</th>
                  <th className="py-2 text-right">Lead</th>
                  <th className="py-2 text-right">Signal</th>
                </tr>
              </thead>
              <tbody>
                {macro.pairs.slice(0, 6).map((p) => (
                  <tr key={`${p.indicator}-${p.sector}`} className="border-t border-white/5">
                    <td className="py-2.5">{p.indicator}</td>
                    <td className="py-2.5 text-white/60">{p.sector}</td>
                    <td className="py-2.5 text-right tabular-nums">
                      {(p.windowCoef["30"] ?? 0).toFixed(2)}
                    </td>
                    <td className="py-2.5 text-right tabular-nums">
                      {(p.windowCoef["90"] ?? 0).toFixed(2)}
                    </td>
                    <td className="py-2.5 text-right tabular-nums">
                      {p.leadDays > 0 ? `${p.leadDays}d` : "—"}
                    </td>
                    <td className={`py-2.5 text-right text-xs ${MACRO_STYLE[p.signal]}`}>
                      {p.signal.replaceAll("_", " ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
