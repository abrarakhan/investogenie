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

const formatVerdict = (verdict: string) => verdict.replace(/^LONG_/, "BUY_").replaceAll("_", " ");

function LinkedMessage({ message }: { message: string }) {
  const parts = message.split(/(https?:\/\/\S+)/g);

  return (
    <span>
      {parts.map((part, index) =>
        part.startsWith("http") ? (
          <a
            key={`${part}-${index}`}
            href={part}
            target="_blank"
            rel="noreferrer"
            className="text-[var(--ig-accent)] underline decoration-[var(--ig-accent)]/40 underline-offset-4 transition hover:text-white"
          >
            {part}
          </a>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        ),
      )}
    </span>
  );
}

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
  const hasSnapshotContext = Boolean(
    overlap?.availableSnapshots?.length || overlap?.referenceOverlaps?.length,
  );
  const visibleInstructions =
    overlap?.instructions.filter(
      (ins) => ins.kind !== "DISCLOSURE_REQUIRED" || !hasSnapshotContext,
    ) ?? [];

  return (
    <div className="space-y-8">
      <h2 className="text-sm uppercase tracking-[0.25em] text-white/40">
        Analytical engines · live
      </h2>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* ---- Swing setups ---- */}
        <Panel title="Buy Candidates" tag="Derivatives · OI-validated">
          {swing.length === 0 ? (
            <p className="text-sm text-white/50">No buy candidates on the latest bar.</p>
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
                        {s.direction === "SHORT" ? "SHORT" : "BUY"}
                      </span>
                    </span>
                    <span
                      className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${VERDICT_STYLE[s.verdict]}`}
                    >
                      {formatVerdict(s.verdict)}
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
                    <span className="text-white/70">Current <b>{s.currentPrice.toFixed(2)}</b></span>
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
              {overlap.availableSnapshots && overlap.availableSnapshots.length > 0 && overlap.stockExposure.length === 0 && (
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Loaded AMC disclosures</p>
                    <span className="rounded-full border border-cyan-300/20 bg-cyan-300/5 px-2 py-0.5 text-[10px] font-semibold text-cyan-100">
                      {overlap.availableSnapshots.length} active
                    </span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {overlap.availableSnapshots.slice(0, 8).map((s) => (
                      <div key={`${s.schemeCode}:${s.month}`} className="rounded-xl border border-white/5 bg-white/[0.025] px-3 py-2 text-xs">
                        <div className="truncate font-semibold text-white/75">{s.name}</div>
                        <div className="mt-1 flex items-center justify-between gap-3 text-[11px] text-white/38">
                          <span>{s.month}</span>
                          <span>{s.equityWeightPct === null ? "-" : `${s.equityWeightPct.toFixed(2)}% equity`}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {overlap.referenceOverlaps && overlap.referenceOverlaps.length > 0 && overlap.stockExposure.length === 0 && (
                <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/5 p-4">
                  <p className="text-sm font-semibold text-cyan-200">Loaded disclosure reference detail</p>
                  <p className="mt-1 text-xs leading-relaxed text-white/55">
                    These AMC disclosures are loaded in the database, but they are not linked to your currently held fund assets yet. Import the matching pension-scheme disclosures to make this portfolio-weighted.
                  </p>
                  <div className="mt-3 space-y-2">
                    {overlap.referenceOverlaps.slice(0, 5).map((o) => (
                      <div key={`${o.fundA}:${o.fundB}`} className="rounded-xl border border-white/5 bg-black/20 px-3 py-2 text-xs">
                        <div className="flex items-center justify-between gap-3">
                          <span className="truncate text-white/72">{o.fundA} ↔ {o.fundB}</span>
                          <span className="font-mono text-cyan-100">{o.overlapPct.toFixed(2)}%</span>
                        </div>
                        <div className="mt-1 truncate text-[11px] text-white/35">Shared: {o.sharedStocks.slice(0, 5).join(", ")}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

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
              ) : overlap.stockExposure.length === 0 && overlap.instructions.length > 0 ? (
                <div className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4">
                  <p className="text-sm font-semibold text-amber-200">
                    Matching fund disclosures still required
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-white/55">
                    Your uploaded holdings contain funds that are not matched to the loaded AMC snapshots yet. Add those exact scheme disclosures to activate portfolio-weighted overlap and concentration scoring.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-emerald-300">No overlaps above threshold.</p>
              )}

              {overlap.stockExposure.length > 0 && (
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-white/38">Top effective stock exposure</p>
                  <div className="space-y-2">
                    {overlap.stockExposure.slice(0, 6).map((s) => (
                      <div key={s.stockTicker} className="grid grid-cols-[1fr_auto] gap-3 text-xs">
                        <span className="truncate text-white/70">{s.stockTicker}</span>
                        <span className="font-mono text-white/85">{s.effectiveWeightPct.toFixed(2)}%</span>
                        <span className="col-span-2 truncate text-[11px] text-white/35">via {s.contributingFunds.join(", ")}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {overlap.pairwiseOverlaps.length > 0 && (
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-white/38">Pairwise overlap detail</p>
                  <div className="space-y-2">
                    {overlap.pairwiseOverlaps.slice(0, 5).map((o) => (
                      <div key={`${o.fundA}:${o.fundB}`} className="rounded-xl border border-white/5 bg-white/[0.025] px-3 py-2 text-xs">
                        <div className="flex items-center justify-between gap-3">
                          <span className="truncate text-white/72">{o.fundA} ↔ {o.fundB}</span>
                          <span className="font-mono text-white/85">{o.overlapPct.toFixed(2)}%</span>
                        </div>
                        <div className="mt-1 truncate text-[11px] text-white/35">Shared: {o.sharedStocks.slice(0, 5).join(", ")}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}


              {visibleInstructions.length > 0 && (
                <ul className="space-y-2">
                  {visibleInstructions.slice(0, 5).map((ins, i) => (
                    <li key={i} className="flex gap-2 text-xs text-white/60">
                      <span className="mt-0.5 text-[var(--ig-accent)]">▸</span>
                      <LinkedMessage message={ins.message} />
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
