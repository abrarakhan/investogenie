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
  const sharedStocks = new Set(
    overlap?.stockExposure
      .filter((stock) => stock.contributingFunds.length > 1)
      .map((stock) => stock.stockTicker) ?? [],
  );
  const fundCompositions = overlap?.fundCompositions ?? [];

  return (
    <div className="space-y-8">
      <h2 className="text-sm uppercase tracking-[0.25em] text-white/40">
        Analytical engines · live
      </h2>

      <div className="space-y-8">
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
        <Panel title="Fund Overlap X-Ray" tag="Your funds · overlaps · underlying stocks">
          {!overlap ? (
            <p className="text-sm text-white/50">No fund holdings imported yet.</p>
          ) : (
            <div className="space-y-5">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-white/35">Funds</p>
                  <p className="mt-2 text-2xl font-bold text-white">{overlap.fundValues.length}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-white/35">Matched Look-Through</p>
                  <p className="mt-2 text-2xl font-bold text-cyan-200">
                    {fundCompositions.filter((fund) => fund.lookThroughAvailable).length}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-white/35">Shared Stocks</p>
                  <p className="mt-2 text-2xl font-bold text-amber-200">{sharedStocks.size}</p>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/38">All uploaded funds</p>
                  <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/50">
                    INR {Math.round(overlap.totalValue).toLocaleString("en-IN")}
                  </span>
                </div>
                <div className="max-h-80 space-y-2 overflow-auto pr-1">
                  {overlap.fundValues.map((fund) => {
                    const composition = fundCompositions.find((item) => item.fundTicker === fund.ticker);
                    return (
                      <div key={fund.ticker} className="grid gap-2 rounded-xl border border-white/5 bg-white/[0.025] px-3 py-2 text-xs md:grid-cols-[1fr_auto_auto] md:items-center">
                        <span className="truncate font-semibold text-white/75" title={fund.ticker}>{fund.ticker}</span>
                        <span className="font-mono text-white/80">{fund.sharePct.toFixed(2)}%</span>
                        <span className={composition?.lookThroughAvailable ? "text-cyan-200" : "text-amber-200/80"}>
                          {composition?.lookThroughAvailable ? `${composition.stocks.length} stocks` : "disclosure needed"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-white/38">Fund overlap pairs</p>
                {overlap.pairwiseOverlaps.length === 0 ? (
                  <p className="text-sm text-white/45">No overlap pairs yet. Import the missing AMC disclosures for unmatched funds to complete the X-Ray.</p>
                ) : (
                  <div className="space-y-2">
                    {overlap.pairwiseOverlaps.map((o) => (
                      <div key={`${o.fundA}:${o.fundB}`} className="rounded-xl border border-white/5 bg-white/[0.025] px-3 py-2 text-xs">
                        <div className="flex items-center justify-between gap-3">
                          <span className="truncate text-white/72">{o.fundA} ↔ {o.fundB}</span>
                          <span className={o.overlapPct >= 30 ? "font-mono text-rose-300" : "font-mono text-cyan-100"}>{o.overlapPct.toFixed(2)}%</span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {o.sharedStocks.slice(0, 12).map((stock) => (
                            <span key={stock} className="rounded-full border border-amber-300/20 bg-amber-300/10 px-2 py-0.5 text-[10px] text-amber-100">
                              {stock}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-white/38">Stocks inside each fund</p>
                <div className="grid gap-3 lg:grid-cols-2">
                  {fundCompositions.map((fund) => (
                    <div key={fund.fundTicker} className="rounded-2xl border border-white/5 bg-white/[0.025] p-3">
                      <div className="mb-2 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-white/80" title={fund.fundTicker}>{fund.fundTicker}</p>
                          <p className="mt-0.5 text-[11px] text-white/35">{fund.sharePct.toFixed(2)}% of portfolio</p>
                        </div>
                        <span className={fund.lookThroughAvailable ? "rounded-full border border-cyan-300/20 px-2 py-0.5 text-[10px] text-cyan-100" : "rounded-full border border-amber-300/20 px-2 py-0.5 text-[10px] text-amber-100"}>
                          {fund.lookThroughAvailable ? `${fund.stocks.length} stocks` : "pending"}
                        </span>
                      </div>
                      {fund.lookThroughAvailable ? (
                        <div className="max-h-64 space-y-1.5 overflow-auto pr-1">
                          {fund.stocks.slice(0, 25).map((stock) => {
                            const shared = stock.sharedByFunds.length > 1 || sharedStocks.has(stock.stockTicker);
                            return (
                              <div key={stock.stockTicker} className={shared ? "grid grid-cols-[1fr_auto] gap-3 rounded-lg border border-amber-300/20 bg-amber-300/10 px-2 py-1.5 text-[11px]" : "grid grid-cols-[1fr_auto] gap-3 rounded-lg border border-white/5 bg-black/20 px-2 py-1.5 text-[11px]"}>
                                <span className={shared ? "truncate font-semibold text-amber-100" : "truncate text-white/65"} title={stock.stockTicker}>{stock.stockTicker}</span>
                                <span className="font-mono text-white/75">{stock.weightPct.toFixed(2)}%</span>
                                {shared && (
                                  <span className="col-span-2 truncate text-[10px] text-amber-100/70">Also in {stock.sharedByFunds.filter((name) => name !== fund.fundTicker).join(", ")}</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="rounded-xl border border-amber-300/15 bg-amber-300/5 px-3 py-2 text-xs text-white/50">
                          Underlying stocks are not available until this fund&apos;s AMC monthly portfolio disclosure is matched/imported.
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
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
