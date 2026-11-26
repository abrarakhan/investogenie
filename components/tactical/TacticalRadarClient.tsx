"use client";

import { useMemo, useState } from "react";
import {
  TACTICAL_BUCKET_META,
  type TacticalBucketKey,
  type TacticalCandidate,
  type TacticalRadarResult,
} from "@/lib/tacticalRadarTypes";
import { formatPrice, formatPct } from "@/lib/markets";
import type { MarketId } from "@/lib/types";
import TradingViewChartModal, { useTradingViewChart } from "@/components/charts/TradingViewChartModal";

const BUCKET_ORDER: TacticalBucketKey[] = [
  "NEAR_TRIGGER",
  "MID_TREND_PULLBACK",
  "OVERSOLD_SNAPBACK",
];

function regimeTone(regime: TacticalRadarResult["context"]["regime"]): string {
  if (regime === "TREND_BREAKOUT") return "border-emerald-400/30 bg-emerald-500/10 text-emerald-300";
  if (regime === "SNAPBACK_REVERSAL") return "border-amber-400/30 bg-amber-500/10 text-amber-300";
  if (regime === "DEFENSIVE") return "border-rose-400/30 bg-rose-500/10 text-rose-300";
  if (regime === "UNVERIFIED") return "border-white/25 bg-white/10 text-white/75";
  return "border-sky-400/30 bg-sky-500/10 text-sky-300";
}

function riskBadgeTone(tier: TacticalCandidate["riskTier"]): string {
  return tier === "HIGHER_MEAN_REVERSION"
    ? "border-amber-400/35 bg-amber-500/15 text-amber-300"
    : "border-emerald-400/25 bg-emerald-500/10 text-emerald-300";
}

function csvEscape(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

export default function TacticalRadarClient({
  data,
  market,
}: {
  data: TacticalRadarResult;
  market: MarketId;
}) {
  const [activeBucket, setActiveBucket] = useState<TacticalBucketKey>(data.context.favoredBucket);
  const [search, setSearch] = useState("");
  const { chart, openChart, closeChart, bindChartGesture } = useTradingViewChart();
  const m = market.toLowerCase();

  const rows = useMemo(() => {
    const list = data.buckets[activeBucket] ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (c) =>
        c.ticker.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        (c.sector ?? "").toLowerCase().includes(q) ||
        c.reason.toLowerCase().includes(q),
    );
  }, [data.buckets, activeBucket, search]);

  const bucketMeta = TACTICAL_BUCKET_META[activeBucket];

  const handleExportCsv = () => {
    const headers = [
      "Ticker",
      "Name",
      "Bucket",
      "RiskTier",
      "Score",
      "Price",
      "ChangePct",
      "ReferenceLevel",
      "InvalidationLevel",
      "TargetZone",
      "RiskPct",
      "RSI14",
      "VolumeRatio",
      "Return20D",
      "Engines",
      "Rationale",
    ];
    const lines = [
      headers.join(","),
      ...rows.map((r) =>
        [
          r.ticker,
          r.name,
          r.bucket,
          r.riskTier,
          r.score,
          r.price,
          r.changePct ?? "",
          r.referenceEntry,
          r.invalidationStop,
          r.targetZone,
          r.riskPct,
          r.rsi14 ?? "",
          r.volumeRatio ?? "",
          r.return20d ?? "",
          r.engines.join(" | "),
          r.reason,
        ]
          .map(csvEscape)
          .join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `tactical-radar-${m}-${activeBucket.toLowerCase()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const { context } = data;
  const breadthTotal = context.advancers + context.decliners;

  return (
    <div className="space-y-6">
      {/* Market-context regime banner */}
      <section className="rounded-xl border border-white/10 bg-white/[0.025] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${regimeTone(context.regime)}`}
              >
                {context.regimeLabel}
              </span>
              <span className="text-xs text-white/45">
                Favored today:{" "}
                <strong className="text-white/85">
                  {TACTICAL_BUCKET_META[context.favoredBucket].label}
                </strong>
              </span>
            </div>
            <p className="max-w-3xl text-sm text-white/65">{context.summary}</p>
          </div>

          <div className="flex flex-wrap gap-3 text-xs">
            <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-white/40">
                {context.benchmarkTicker}
              </div>
              <div className="mt-0.5 flex items-baseline gap-2 font-mono text-sm font-semibold text-white">
                <span>{context.benchmarkPrice !== null ? context.benchmarkPrice.toFixed(2) : "--"}</span>
                {context.benchmarkChangePct !== null && (
                  <span className={context.benchmarkChangePct >= 0 ? "text-emerald-400" : "text-rose-400"}>
                    {formatPct(context.benchmarkChangePct)}
                  </span>
                )}
              </div>
              <div className="text-[10px] text-white/45">
                {context.benchmarkAboveSma50 === null
                  ? "50DMA n/a"
                  : context.benchmarkAboveSma50
                    ? "Above 50DMA"
                    : "Below 50DMA"}
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-white/40">Breadth</div>
              <div className="mt-0.5 font-mono text-sm font-semibold text-white">
                <span className="text-emerald-400">{context.advancers}</span>
                <span className="mx-1 text-white/30">/</span>
                <span className="text-rose-400">{context.decliners}</span>
              </div>
              <div className="text-[10px] text-white/45">
                {breadthTotal > 0 && context.breadthPct !== null
                  ? `${context.breadthPct.toFixed(0)}% advancing`
                  : "Pending quotes"}
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-white/40">Guardrails</div>
              <div className="mt-0.5 font-mono text-sm font-semibold text-white/85">
                {data.excludedCounts.adverseNews + data.excludedCounts.resultsBlackout} filtered
              </div>
              <div className="text-[10px] text-white/45">
                {data.excludedCounts.adverseNews} news · {data.excludedCounts.resultsBlackout} results
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Bucket selector tabs */}
      <div className="grid gap-3 md:grid-cols-3">
        {BUCKET_ORDER.map((key) => {
          const meta = TACTICAL_BUCKET_META[key];
          const count = data.buckets[key].length;
          const isActive = key === activeBucket;
          const isFavored = key === context.favoredBucket;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setActiveBucket(key)}
              className={`rounded-xl border p-4 text-left transition-all ${
                isActive
                  ? "border-[var(--ig-accent)] bg-[var(--ig-accent)]/10 shadow-[0_0_0_1px_var(--ig-accent)]"
                  : "border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-white">{meta.label}</span>
                <span className="rounded-full bg-white/10 px-2 py-0.5 font-mono text-xs text-white/80">
                  {count}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${riskBadgeTone(meta.riskTier)}`}
                >
                  {meta.riskLabel}
                </span>
                {isFavored && (
                  <span className="rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-[10px] font-medium text-white/80">
                    Fits today&apos;s tape
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Bucket guidance + filter bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/25 px-4 py-3">
        <p className="max-w-2xl text-xs leading-relaxed text-white/55">{bucketMeta.description}</p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter ticker or sector..."
            className="w-48 rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 text-xs text-white placeholder:text-white/35 focus:border-[var(--ig-accent)] focus:outline-none"
          />
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={rows.length === 0}
            className="rounded-lg border border-white/15 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-white/75 transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-40"
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* Candidate list */}
      {rows.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-8 text-center text-sm text-white/50">
          No watchlist candidates match this tactical bucket right now after liquidity, news, and results guardrails.
        </div>
      ) : (
        <div className="grid gap-3">
          {rows.map((c, idx) => (
            <article
              key={`${c.bucket}:${c.assetId}`}
              {...bindChartGesture({ ticker: c.ticker, exchange: c.exchange, market })}
              className="touch-manipulation select-none rounded-xl border border-white/10 bg-white/[0.025] p-4 transition-colors hover:border-white/20"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-white/35">#{idx + 1}</span>
                    <button
                      type="button"
                      data-chart-trigger
                      aria-label={`Open ${c.ticker} chart`}
                      onClick={() => openChart({ ticker: c.ticker, exchange: c.exchange, market })}
                      className="text-base font-bold tracking-tight text-white hover:text-[var(--ig-accent)]"
                    >
                      {c.ticker}
                    </button>
                    <span className="text-xs text-white/45">{c.exchange}</span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${riskBadgeTone(c.riskTier)}`}
                    >
                      {c.riskTier === "HIGHER_MEAN_REVERSION" ? "Mean Reversion" : "Tactical"}
                    </span>
                    {c.confluenceCount >= 2 && (
                      <span className="rounded-full border border-[var(--ig-accent)]/40 bg-[var(--ig-accent)]/15 px-2 py-0.5 text-[10px] font-semibold text-[var(--ig-accent)]">
                        {c.confluenceCount}× Engine Confluence
                      </span>
                    )}
                    {c.engines.map((eng) => (
                      <span
                        key={eng}
                        className="rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-white/65"
                      >
                        {eng}
                      </span>
                    ))}
                  </div>
                  <div className="truncate text-xs text-white/50">
                    {c.name}
                    {c.sector ? ` · ${c.sector}` : ""}
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className="font-mono text-base font-semibold text-white">
                      {formatPrice(c.price, market)}
                    </div>
                    {c.changePct !== null && (
                      <div
                        className={`font-mono text-xs font-medium ${
                          c.changePct >= 0 ? "text-emerald-400" : "text-rose-400"
                        }`}
                      >
                        {formatPct(c.changePct)}
                      </div>
                    )}
                  </div>
                  <div className="rounded-lg border border-white/10 bg-black/35 px-2.5 py-1.5 text-center">
                    <div className="text-[9px] uppercase tracking-wider text-white/40">Score</div>
                    <div className="font-mono text-sm font-bold text-[var(--ig-accent)]">
                      {c.score}
                    </div>
                  </div>
                </div>
              </div>

              {/* Levels & metrics */}
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                <div className="rounded-lg bg-black/25 px-2.5 py-1.5">
                  <div className="text-[10px] uppercase text-white/38">Reference</div>
                  <div className="font-mono text-xs font-semibold text-white">
                    {formatPrice(c.referenceEntry, market)}
                  </div>
                </div>
                <div className="rounded-lg bg-black/25 px-2.5 py-1.5">
                  <div className="text-[10px] uppercase text-white/38">Invalidation</div>
                  <div className="font-mono text-xs font-semibold text-rose-300">
                    {formatPrice(c.invalidationStop, market)}
                  </div>
                </div>
                <div className="rounded-lg bg-black/25 px-2.5 py-1.5">
                  <div className="text-[10px] uppercase text-white/38">Target Zone</div>
                  <div className="font-mono text-xs font-semibold text-emerald-300">
                    {formatPrice(c.targetZone, market)}
                  </div>
                </div>
                <div className="rounded-lg bg-black/25 px-2.5 py-1.5">
                  <div className="text-[10px] uppercase text-white/38">ATR Risk</div>
                  <div className="font-mono text-xs font-semibold text-white/85">
                    {c.riskPct.toFixed(1)}%
                  </div>
                </div>
                <div className="rounded-lg bg-black/25 px-2.5 py-1.5">
                  <div className="text-[10px] uppercase text-white/38">RSI (14)</div>
                  <div className="font-mono text-xs font-semibold text-white/85">
                    {c.rsi14 !== null ? c.rsi14.toFixed(1) : "--"}
                  </div>
                </div>
                <div className="rounded-lg bg-black/25 px-2.5 py-1.5">
                  <div className="text-[10px] uppercase text-white/38">Vol / 20D</div>
                  <div className="font-mono text-xs font-semibold text-white/85">
                    {c.volumeRatio !== null ? `${c.volumeRatio.toFixed(2)}x` : "--"}
                  </div>
                </div>
                <div className="rounded-lg bg-black/25 px-2.5 py-1.5">
                  <div className="text-[10px] uppercase text-white/38">20D Move</div>
                  <div
                    className={`font-mono text-xs font-semibold ${
                      (c.return20d ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"
                    }`}
                  >
                    {c.return20d !== null ? formatPct(c.return20d) : "--"}
                  </div>
                </div>
              </div>

              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-white/55">
                <span>{c.reason}</span>
                {c.asOfDate && <span className="font-mono text-[11px] text-white/35">As of {c.asOfDate}</span>}
              </div>
              {c.newsNote && (
                <div className="mt-2 rounded-lg border border-sky-400/20 bg-sky-500/10 px-3 py-1.5 text-xs text-sky-200/90">
                  News context: {c.newsNote}
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      <TradingViewChartModal chart={chart} onClose={closeChart} />
      <p className="text-[11px] text-white/35">
        Research watchlist candidates only — tactical levels are statistical ATR projections, separate from Strong Swing&apos;s strict execution gates.
      </p>
    </div>
  );
}
