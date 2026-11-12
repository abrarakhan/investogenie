"use client";

import Link from "next/link";
import type { TrendContinuationCandidate, TrendContinuationStatus } from "@/lib/trendContinuation";
import { TREND_CONTINUATION_STATUS_LABEL } from "@/lib/candidateStatusCopy";
import TradingViewChartModal, { useTradingViewChart, type ChartGestureProps, type ChartSymbol } from "@/components/charts/TradingViewChartModal";
import LazyCandidateGroup, { type LazySource } from "@/components/screener/LazyCandidateGroup";
import { LAZY_STATUSES } from "@/lib/lazyCandidateGroups";

const style: Record<TrendContinuationStatus, string> = {
  IMPULSE_DETECTED: "border-cyan-400/30 text-cyan-200",
  CONTINUATION_WATCH: "border-amber-400/30 text-amber-200",
  TREND_CONTINUATION_READY: "border-emerald-400/30 text-emerald-200",
  EXTENDED_RISK: "border-rose-400/30 text-rose-200",
};

const value = (number: unknown, suffix = "") => typeof number === "number" && Number.isFinite(number)
  ? `${number.toFixed(2)}${suffix}` : "—";

function CandidateCard({ candidate, rank, planId, chartGesture }: { candidate: TrendContinuationCandidate; rank: number; planId: string | null; chartGesture: ChartGestureProps }) {
  const developingStaircase = candidate.metrics.developing_staircase === true;
  const volumeRatios = Array.isArray(candidate.metrics.volume_ratios)
    ? candidate.metrics.volume_ratios.filter((item): item is number => typeof item === "number") : [];
  const averageVolume = volumeRatios.length
    ? volumeRatios.reduce((sum, item) => sum + item, 0) / volumeRatios.length : null;
  const ledgerParams = new URLSearchParams({
    assetId: candidate.assetId, ticker: candidate.ticker, strategy: "TREND_CONTINUATION", planId: planId ?? "",
    current: String(candidate.currentPrice ?? candidate.entry ?? ""), entry: String(candidate.entry ?? ""),
    target: String(candidate.target ?? ""), stop: String(candidate.stop ?? ""), days: String(candidate.metrics.expected_holding_days ?? 5),
  });

  return <article {...chartGesture} className="pointer-coarse:select-none touch-pan-y rounded-lg border border-white/10 bg-white/[0.025] p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-white/30">#{rank}</span>
          <h3 className="text-xl font-black">{candidate.ticker}</h3>
          <span className="text-[10px] font-bold uppercase tracking-wide text-white/30">NSE</span>
        </div>
        <p className="mt-1 text-xs text-white/40">{candidate.name ?? "—"}</p>
      </div>
      <div className="flex items-center gap-2">
        <span className="font-mono text-lg font-bold text-white/75">{candidate.score}/100</span>
        <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase ${style[candidate.status]}`}>
          {developingStaircase
            ? candidate.status === "TREND_CONTINUATION_READY" ? "Day-two continuation ready" : "Staircase developing"
            : TREND_CONTINUATION_STATUS_LABEL[candidate.status]}
        </span>
      </div>
    </div>

    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <Metric label="3-session move" text={value(candidate.metrics.move3_atr, " ATR")} />
      <Metric label="Efficiency" text={value(typeof candidate.metrics.efficiency3 === "number" ? candidate.metrics.efficiency3 * 100 : null, "%")} />
      <Metric label="Average volume" text={value(averageVolume, "x")} />
      <Metric label="5-session move" text={value(candidate.metrics.return5_pct, "%")} />
      <Metric label="RS vs Nifty · 5d" text={value(candidate.metrics.relative_strength5_pct, "%")} />
      <Metric label="Distance from EMA10" text={value(candidate.metrics.distance_ema10_atr, " ATR")} />
    </div>

    {candidate.entry !== null && <div className="mt-3 grid grid-cols-3 gap-2">
      <Metric label="Reference entry" text={value(candidate.entry)} />
      <Metric label="Protective stop" text={value(candidate.stop)} />
      <Metric label="2R target" text={value(candidate.target)} />
    </div>}

    <details className="mt-4 rounded-lg border border-white/8 bg-black/15 px-4 py-3">
      <summary className="cursor-pointer text-xs font-bold text-white/55">Why it is here</summary>
      <div className="mt-3 space-y-1.5 text-xs leading-relaxed text-white/48">
        {candidate.reasons.map((reason) => <p key={reason}>• {reason}</p>)}
      </div>
    </details>

    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/8 pt-3 text-[11px]">
      {candidate.executionEligible && planId ? <Link
        href={`/terminal/in/trade-ledger?${ledgerParams.toString()}`}
        className="inline-flex min-h-11 items-center rounded-lg border border-emerald-400/35 bg-emerald-400/10 px-4 text-sm font-bold text-emerald-200 hover:bg-emerald-400/15"
      >Buy &amp; Track</Link> : <span className="font-semibold text-violet-200/75">
        {candidate.status === "TREND_CONTINUATION_READY" && candidate.executionBlockers.length
          ? `Buy blocked: ${candidate.executionBlockers[0]}`
          : "Observation only — wait for confirmed day-two execution gates."}
      </span>}
      <span className="text-white/30">Signal session {candidate.asOfMarketDate}</span>
    </div>
  </article>;
}

function CandidateGroup({ title, candidates, source, totalCount, color, ranked, planIds, bindChartGesture, defaultOpen = false }: {
  title: string;
  /** Cards to render now; omit and pass `source` to load them when opened. */
  candidates?: TrendContinuationCandidate[];
  source?: LazySource;
  totalCount?: number;
  color: string;
  ranked: Map<string, number>;
  planIds: Record<string, string>;
  bindChartGesture: (symbol: ChartSymbol) => ChartGestureProps;
  defaultOpen?: boolean;
}) {
  const count = totalCount ?? candidates?.length ?? 0;
  if (!count) return null;
  return <LazyCandidateGroup<TrendContinuationCandidate>
    defaultOpen={defaultOpen}
    items={candidates}
    source={source}
    summary={<div className={`text-sm font-bold uppercase tracking-[0.18em] ${color}`}>
      {title} <span className="font-mono text-white/45">({count})</span>
    </div>}
    render={(items, ranks) => items.map((candidate) => <CandidateCard key={candidate.assetId} candidate={candidate} rank={ranks[candidate.assetId] ?? ranked.get(candidate.assetId) ?? 0} planId={planIds[`TREND_CONTINUATION:${candidate.status}:${candidate.assetId}`] ?? null} chartGesture={bindChartGesture({ ticker: candidate.ticker, exchange: "NSE" })} />)}
  />;
}

export default function TrendContinuationCandidates({ candidates, planIds, counts, ranks, market, dayTwoWatch = [], regimePositive, scanTotals }: {
  /** Second-day staircases still held back from entry; always shown, open by default. */
  dayTwoWatch?: TrendContinuationCandidate[];
  /** Broad market above its 50-session average; undefined when unknown. */
  regimePositive?: boolean;
  /** Per-status totals across the whole scan; the list itself is capped. */
  scanTotals?: Record<string, number>;
  /** With `market`, holds only the groups open by default. */
  candidates: TrendContinuationCandidate[];
  planIds: Record<string, string>;
  /** Exact per-status totals across the whole list. */
  counts?: Record<string, number>;
  /** 1-based positions in the full list for the cards in `candidates`. */
  ranks?: Record<string, number>;
  /** Enables on-demand loading of the collapsed groups for this market. */
  market?: string;
}) {
  const { chart, closeChart, bindChartGesture } = useTradingViewChart();
  const ranked = new Map(candidates.map((candidate, index) => [candidate.assetId, ranks?.[candidate.assetId] ?? index + 1]));
  const total = (status: TrendContinuationStatus, shown: number) => counts?.[status] ?? shown;
  const group = (status: TrendContinuationStatus, shown: TrendContinuationCandidate[]) => market && LAZY_STATUSES.trend.has(status)
    ? { source: { screen: "trend" as const, market, status }, totalCount: total(status, shown.length) }
    : { candidates: shown, totalCount: total(status, shown.length) };
  const candidateCount = counts ? Object.values(counts).reduce((sum, value) => sum + value, 0) : candidates.length;
  const ready = candidates.filter((candidate) => candidate.status === "TREND_CONTINUATION_READY");
  const watch = candidates.filter((candidate) => candidate.status === "CONTINUATION_WATCH");
  const impulse = candidates.filter((candidate) => candidate.status === "IMPULSE_DETECTED");
  const extended = candidates.filter((candidate) => candidate.status === "EXTENDED_RISK");
  const regime = regimePositive;
  // Tiles count the whole scan; the groups below list only the top-ranked stocks.
  const scanCount = (status: TrendContinuationStatus, shown: number) => scanTotals?.[status] ?? total(status, shown);
  const scanTotal = scanTotals ? Object.values(scanTotals).reduce((sum, item) => sum + item, 0) : candidateCount;

  return <div className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/10 pb-4">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-violet-300">Python signal engine · protected manual execution</div>
        <h2 className="mt-1 text-2xl font-black">Trend Continuation</h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-white/45">
          Finds stocks rising for a second session. A two-session staircase becomes an entry after 10:15 IST only above its 20-session high, in a rising broad market, for a liquid stock with top-30% six-month strength. Heavy-volume day-one breakouts are confirmed the same way on day two. Stocks that reverse are dropped, and pullbacks are watch-only.
        </p>
      </div>
      <div className="text-right text-xs text-white/40">
        <div><span className="font-mono font-bold text-white/75">{candidateCount}</span> ranked continuation signals{scanTotal > candidateCount ? <> of <span className="font-mono font-bold text-white/75">{scanTotal}</span> in the scan</> : null}</div>
        <div>Rescanned every 2 minutes in market hours</div>
      </div>
    </div>

    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {[
        ["Continuation ready", scanCount("TREND_CONTINUATION_READY", ready.length), "text-emerald-300"],
        ["Continuation watch", scanCount("CONTINUATION_WATCH", watch.length), "text-amber-200"],
        ["Impulse detected", scanCount("IMPULSE_DETECTED", impulse.length), "text-cyan-200"],
        ["Extended risk", scanCount("EXTENDED_RISK", extended.length), "text-rose-200"],
      ].map(([summaryLabel, count, color]) => <div key={String(summaryLabel)} className="border-b border-white/10 px-1 pb-2">
        <div className={`font-mono text-xl font-bold ${color}`}>{count}</div>
        <div className="text-[10px] uppercase tracking-wide text-white/35">{summaryLabel}</div>
      </div>)}
    </div>

    {regime === false && <div className="rounded-lg border border-amber-400/25 bg-amber-400/[0.06] px-4 py-3 text-xs leading-relaxed text-amber-100/80">
      <span className="font-bold">Broad market is below its 50-session average.</span> New entries are withheld: in this condition continuation trades lost money on average. Second-day movers are still listed as watch-only.
    </div>}
    <div className="rounded-lg border border-violet-400/15 bg-violet-400/[0.035] px-4 py-3 text-xs leading-relaxed text-violet-100/65">
      A confirmed day-two entry may unlock manual Buy &amp; Track after 10:15 IST only when fresh Breeze depth, spread, circuit room, results calendar, plan geometry and freshness checks pass. Day-one impulses and pullbacks remain observation-only; auto-buy stays disabled.
      <span className="mt-2 block text-white/55">
        In a day-by-day replay of 2025–26 NSE data the day-two continuation entry averaged +0.3% a trade before costs with 45% winners — about break-even, so size it as an experiment. Its live results are tracked under Strategy Tests.
      </span>
      <span className="mt-2 block text-white/45">Double-click a stock card, or long-press it on mobile, to open its interactive chart.</span>
    </div>

    {!candidateCount
      ? <div className="rounded-lg border border-white/10 px-4 py-8 text-center text-sm text-white/45">No recent multi-session impulse currently passes the Trend Continuation floor.</div>
      : <div className="space-y-3">
        <CandidateGroup title="Continuation ready" {...group("TREND_CONTINUATION_READY", ready)} ranked={ranked} planIds={planIds} color="text-emerald-300" defaultOpen bindChartGesture={bindChartGesture} />
        <CandidateGroup title="Second-day movers · watch-only" candidates={dayTwoWatch} ranked={ranked} planIds={planIds} color="text-cyan-200" defaultOpen bindChartGesture={bindChartGesture} />
        <CandidateGroup title="Continuation watch" {...group("CONTINUATION_WATCH", watch)} ranked={ranked} planIds={planIds} color="text-amber-200" bindChartGesture={bindChartGesture} />
        <CandidateGroup title="Impulse detected" {...group("IMPULSE_DETECTED", impulse)} ranked={ranked} planIds={planIds} color="text-cyan-200" bindChartGesture={bindChartGesture} />
        <CandidateGroup title="Extended · do not chase" {...group("EXTENDED_RISK", extended)} ranked={ranked} planIds={planIds} color="text-rose-200" bindChartGesture={bindChartGesture} />
      </div>}
    <TradingViewChartModal chart={chart} onClose={closeChart} />
  </div>;
}

function Metric({ label: metricLabel, text }: { label: string; text: string }) {
  return <div className="rounded-md bg-black/30 px-3 py-2">
    <div className="text-[9px] uppercase text-white/35">{metricLabel}</div>
    <div className="mt-1 font-mono font-bold text-white/80">{text}</div>
  </div>;
}
