import Link from "next/link";
import type { OverlapReport } from "@/lib/analytics/fundOverlap";

/** Mutual-fund look-through: imported funds, pairwise overlap and shared underlying stocks. */
export default function FundXRay({ overlap }: { overlap: OverlapReport | null }) {
  // Stocks that show up in more than one fund — the actual duplication the
  // X-Ray exists to surface. Kept as a list (not just a Set) so it can be
  // rendered directly, sorted by how much of the whole portfolio it represents.
  const multiFundStocks =
    overlap?.stockExposure
      .filter((stock) => stock.contributingFunds.length > 1)
      .sort(
        (a, b) =>
          b.contributingFunds.length - a.contributingFunds.length ||
          b.effectiveWeightPct - a.effectiveWeightPct,
      ) ?? [];
  const sharedStocks = new Set(multiFundStocks.map((stock) => stock.stockTicker));
  const fundCompositions = overlap?.fundCompositions ?? [];
  const lookThroughFundCount = (overlap?.fundCompositions ?? []).filter(
    (fund) => fund.lookThroughAvailable,
  ).length;
  const fundCompositionMatches = new Map<string, number>();

  const nextCompositionFor = (fundTicker: string) => {
    const offset = fundCompositionMatches.get(fundTicker) ?? 0;
    const matches = fundCompositions.filter((item) => item.fundTicker === fundTicker);
    const composition = matches[offset] ?? matches[0];
    fundCompositionMatches.set(fundTicker, offset + 1);
    return composition;
  };

  return (
        <section className="rounded-3xl border border-white/10 bg-white/[0.02] p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold">Fund Overlap X-Ray</h2>
            <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] uppercase tracking-widest text-[var(--ig-accent)]">Your funds · overlaps · underlying stocks</span>
          </div>
          {!overlap ? (
            <div className="space-y-2">
              <p className="text-sm text-white/50">
                No mutual fund holdings imported yet — the X-Ray needs your fund list before it can
                compare anything.
              </p>
              <Link
                href="/terminal/in/cas"
                className="inline-block rounded-full border border-[var(--ig-accent)]/30 px-3 py-1 text-[11px] font-semibold text-[var(--ig-accent)] hover:bg-[var(--ig-accent)]/10"
              >
                Import a CAS statement
              </Link>
            </div>
          ) : lookThroughFundCount === 0 ? (
            <div className="space-y-2">
              <p className="text-sm text-white/50">
                {overlap.fundValues.length} fund{overlap.fundValues.length === 1 ? "" : "s"} imported,
                but none are mapped to an AMC portfolio disclosure yet — so there are no underlying
                stocks to compare. Map a fund (or import its monthly disclosure) to start the X-Ray.
              </p>
              <Link
                href="/portfolio/fund-mapping"
                className="inline-block rounded-full border border-[var(--ig-accent)]/30 px-3 py-1 text-[11px] font-semibold text-[var(--ig-accent)] hover:bg-[var(--ig-accent)]/10"
              >
                Open fund mapping
              </Link>
            </div>
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
                  <div className="flex items-center gap-2">
                    <Link href="/portfolio/fund-mapping" className="rounded-full border border-[var(--ig-accent)]/30 px-2 py-0.5 text-[10px] font-semibold text-[var(--ig-accent)] hover:bg-[var(--ig-accent)]/10">
                      Fix mapping
                    </Link>
                    <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/50">
                      INR {Math.round(overlap.totalValue).toLocaleString("en-IN")}
                    </span>
                  </div>
                </div>
                <div className="max-h-80 space-y-2 overflow-auto pr-1">
                  {overlap.fundValues.map((fund, index) => {
                    const composition = nextCompositionFor(fund.ticker);
                    return (
                      <div key={`${fund.ticker}:${index}`} className="grid gap-2 rounded-xl border border-white/5 bg-white/[0.025] px-3 py-2 text-xs md:grid-cols-[1fr_auto_auto] md:items-center">
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
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/38">
                    Same stock across multiple funds
                  </p>
                  <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/50">
                    {multiFundStocks.length} duplicated
                  </span>
                </div>
                {multiFundStocks.length === 0 ? (
                  <p className="text-sm text-white/45">
                    No stock appears in more than one of your mapped funds yet.
                  </p>
                ) : (
                  <>
                    <p className="mb-3 text-[11px] text-white/40">
                      &quot;Portfolio weight&quot; is the combined effective exposure across every fund
                      holding this stock — the real concentration you carry, not the weight inside any
                      single fund.
                    </p>
                    <div className="max-h-80 space-y-1.5 overflow-auto pr-1">
                      {multiFundStocks.map((stock) => (
                        <div
                          key={stock.stockTicker}
                          className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-xl border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs"
                        >
                          <span className="truncate font-semibold text-amber-100" title={stock.stockTicker}>
                            {stock.stockTicker}
                          </span>
                          <span className="rounded-full border border-amber-300/25 px-2 py-0.5 text-[10px] text-amber-100/90">
                            {stock.contributingFunds.length} funds
                          </span>
                          <span className="font-mono text-white/80">
                            {stock.effectiveWeightPct.toFixed(2)}%
                          </span>
                          <span className="col-span-3 truncate text-[10px] text-amber-100/70">
                            {stock.contributingFunds.join(" · ")}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-white/38">Stocks inside each fund</p>
                <div className="grid gap-3 lg:grid-cols-2">
                  {fundCompositions.map((fund, index) => (
                    <div key={`${fund.fundTicker}:${index}`} className="rounded-2xl border border-white/5 bg-white/[0.025] p-3">
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
        </section>
  );
}
