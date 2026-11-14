"use client";

import Link from "next/link";
import type { StrongSwingCandidate } from "@/lib/strongSwing";
import type { StrongSwingStatus } from "@/lib/analytics/strongSwing";
import { STRONG_SWING_BLOCKED_BUY_LABEL, STRONG_SWING_STATUS_LABEL } from "@/lib/candidateStatusCopy";
import TradingViewChartModal, { useTradingViewChart, type ChartGestureProps, type ChartSymbol } from "@/components/charts/TradingViewChartModal";
import LazyCandidateGroup, { type LazySource } from "@/components/screener/LazyCandidateGroup";
import { LAZY_STATUSES } from "@/lib/lazyCandidateGroups";

const STATUS_STYLE: Record<StrongSwingStatus, string> = {
  EXECUTION_READY: "border-emerald-400/35 bg-emerald-400/10 text-emerald-300",
  WAIT_FOR_ENTRY: "border-cyan-400/35 bg-cyan-400/10 text-cyan-200",
  WATCHLIST: "border-amber-400/35 bg-amber-400/10 text-amber-200",
  UNVERIFIED: "border-slate-400/35 bg-slate-400/10 text-slate-200",
  RISK_OFF: "border-orange-400/35 bg-orange-400/10 text-orange-200",
  INVALIDATED: "border-rose-400/35 bg-rose-400/10 text-rose-300",
};

const fmt = (value: number | null, digits = 2) =>
  value === null || !Number.isFinite(value) ? "-" : value.toFixed(digits);

function rankMovement(candidate: StrongSwingCandidate): string {
  const delta = candidate.baseSwingRank - candidate.strongSwingRank;
  if (delta > 0) return `Up ${delta} after confirmation checks`;
  if (delta < 0) return `Down ${Math.abs(delta)} after confirmation checks`;
  return "Rank unchanged after confirmation checks";
}

function rankReason(candidate: StrongSwingCandidate): string {
  if (candidate.status === "EXECUTION_READY") return "Every technical and execution gate passed.";
  // Say plainly that this is a data gap, not a judgement about the stock or the market.
  if (candidate.status === "UNVERIFIED") {
    return "Benchmark data is missing, stale or too short to judge the market against. Buying is blocked until it can be verified — this is not a view on the stock.";
  }
  const failed = candidate.gates.filter((gate) => !gate.passed);
  const technical = failed.filter((gate) => gate.category === "technical").slice(0, 2);
  const execution = failed.filter((gate) => gate.category === "execution").slice(0, 2);
  const reasons = [...technical, ...execution].map((gate) => gate.label);
  return reasons.length
    ? `Held back by ${reasons.join(", ")}.`
    : "Strong score reflects the confirmation gates passed.";
}

function CandidateCard({ candidate, planId, chartGesture }: { candidate: StrongSwingCandidate; planId: string | null; chartGesture: ChartGestureProps }) {
  const passed = candidate.gates.filter((gate) => gate.passed).length;
  const ledgerParams = new URLSearchParams({
    assetId: candidate.assetId,
    ticker: candidate.ticker,
    strategy: "STRONG_SWING",
    planId: planId ?? "",
    current: String(candidate.strongEntry),
    entry: String(candidate.strongEntry),
    target: String(candidate.strongTarget),
    stop: String(candidate.strongStop),
    trail: String(candidate.strongTrail),
    days: String(candidate.strongExpectedDays),
  });
  return (
    <article {...chartGesture} className="pointer-coarse:select-none touch-pan-y rounded-lg border border-white/10 bg-white/[0.025] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold">{candidate.ticker}</h2>
            <span className="text-[10px] uppercase tracking-wider text-white/35">{candidate.exchange} · {candidate.assetClass}</span>
          </div>
          <div className="mt-1 text-sm text-white/48">EOD {candidate.latestDate} · {candidate.confirmationMode === "OI" ? "OI validation" : "Cash-equity validation"}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-white/60">{candidate.strengthScore}/100</span>
          <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-wide ${STATUS_STYLE[candidate.status]}`}>
            {STRONG_SWING_STATUS_LABEL[candidate.status]}
          </span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Confirmed entry", candidate.strongEntry, "text-white"],
          ["Target", candidate.strongTarget, "text-emerald-300"],
          ["Stop", candidate.strongStop, "text-rose-300"],
          ["Trail", candidate.strongTrail, "text-amber-200"],
          ["Current", candidate.lastQuote ?? candidate.latestClose, "text-white"],
          ["Horizon", `~${candidate.strongExpectedDays}d`, "text-cyan-200"],
        ].map(([label, value, color]) => (
          <div key={String(label)} className="rounded-md bg-black/30 px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wide text-white/35">{label}</div>
            <div className={`mt-1 font-mono text-sm ${color}`}>
              {typeof value === "number" ? fmt(value) : value}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 grid gap-2 rounded-md border border-white/8 bg-black/20 px-3 py-3 sm:grid-cols-[auto_auto_1fr] sm:items-center sm:gap-5">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-white/35">Base Swing</div>
          <div className="mt-0.5 font-mono text-sm font-bold text-white/75">
            #{candidate.baseSwingRank} · {Math.round(candidate.score * 100)}/100
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-white/35">Strong Swing</div>
          <div className="mt-0.5 font-mono text-sm font-bold text-cyan-200">
            #{candidate.strongSwingRank} · {candidate.strengthScore}/100
          </div>
        </div>
        <div className="text-xs leading-relaxed text-white/48">
          <span className="font-semibold text-white/68">{rankMovement(candidate)}.</span>{" "}
          {rankReason(candidate)}
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {candidate.gates.map((gate) => (
          <div key={gate.key} className={`rounded-md border px-3 py-2 ${gate.passed ? "border-emerald-400/15 bg-emerald-400/[0.035]" : gate.category === "execution" ? "border-orange-400/15 bg-orange-400/[0.035]" : "border-rose-400/15 bg-rose-400/[0.035]"}`}>
            <div className="flex items-center gap-2 text-xs font-semibold">
              <span className={gate.passed ? "text-emerald-300" : !gate.blocking ? "text-amber-300" : gate.category === "execution" ? "text-orange-300" : "text-rose-300"}>
                {gate.passed ? "PASS" : !gate.blocking ? "CAUTION" : gate.category === "execution" ? "BLOCK" : "WAIT"}
              </span>
              <span className="text-white/75">{gate.label}</span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-white/42">{gate.detail}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t border-white/8 pt-3 text-[11px] text-white/45">
        <span>{passed}/{candidate.gates.length} gates passed</span>
        <span>Volume {candidate.volumeRatio.toFixed(2)}x</span>
        <span>RS {fmt(candidate.relativeStrength20Pct, 1)}%</span>
        <span>Breakout {candidate.triggerClearanceAtr.toFixed(2)} ATR</span>
        <span>Close location {(candidate.closeLocation * 100).toFixed(0)}%</span>
        <span>ATR risk {candidate.atrPct.toFixed(1)}%</span>
        <span>Stop risk {candidate.stopRiskPct.toFixed(1)}%</span>
        <span>Suggested exposure {candidate.suggestedExposurePct}%</span>
      </div>
      <div className="mt-4 border-t border-white/8 pt-4">
        {candidate.status === "EXECUTION_READY" && planId ? (
          <>
          <Link
            href={`/terminal/${candidate.country.toLowerCase()}/trade-ledger?${ledgerParams.toString()}`}
            className="inline-flex min-h-11 items-center rounded-lg border border-emerald-400/35 bg-emerald-400/10 px-4 text-sm font-bold text-emerald-200 hover:bg-emerald-400/15"
          >
            Buy &amp; Track
          </Link>
          <p className="mt-2 text-[11px] leading-relaxed text-white/38">
            Records your purchase against this frozen plan. Broker order placement is not connected yet.
          </p>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled
              className="inline-flex min-h-11 cursor-not-allowed items-center rounded-lg border border-white/10 bg-white/[0.025] px-4 text-sm font-bold text-white/30"
            >
              {candidate.status === "EXECUTION_READY" ? "Unsafe plan withheld" : STRONG_SWING_BLOCKED_BUY_LABEL[candidate.status]}
            </button>
            <p className="mt-2 text-[11px] leading-relaxed text-white/38">
              {candidate.status === "EXECUTION_READY" && !planId
                ? "The current entry, target, or stop geometry is not safely executable."
                : "Buy & Track unlocks only after every technical and execution-safety gate passes."}
            </p>
          </>
        )}
      </div>
    </article>
  );
}

function CandidateGroup({
  title,
  candidates,
  source,
  limit,
  limitNote,
  color,
  defaultOpen = false,
  totalCount,
  planIds,
  bindChartGesture,
}: {
  title: string;
  /** Cards to render now; omit and pass `source` to load them when opened. */
  candidates?: StrongSwingCandidate[];
  source?: LazySource;
  limit?: number;
  limitNote?: (shown: number, total: number) => string;
  color: string;
  defaultOpen?: boolean;
  totalCount?: number;
  planIds: Record<string, string>;
  bindChartGesture: (symbol: ChartSymbol) => ChartGestureProps;
}) {
  const count = totalCount ?? candidates?.length ?? 0;
  if (count === 0) return null;
  const shownCount = limit === undefined ? count : Math.min(limit, count);
  const note = limitNote && count > shownCount ? limitNote(shownCount, count) : undefined;
  return (
    <LazyCandidateGroup<StrongSwingCandidate>
      defaultOpen={defaultOpen}
      items={candidates}
      source={source}
      summary={
        <div className="min-w-0">
          <div className={`text-sm font-bold uppercase tracking-[0.18em] ${color}`}>
            {title} <span className="font-mono text-white/45">({count})</span>
          </div>
          {note && <div className="mt-1 text-[11px] normal-case tracking-normal text-white/35">{note}</div>}
        </div>
      }
      render={(items) => items.slice(0, limit).map((candidate) => <CandidateCard key={candidate.assetId} candidate={candidate} planId={planIds[`STRONG_SWING:${candidate.status}:${candidate.assetId}`] ?? null} chartGesture={bindChartGesture({ ticker: candidate.ticker, exchange: candidate.exchange })} />)}
    />
  );
}

export default function StrongSwingCandidates({ candidates, counts, planIds, market }: {
  /** Cards for groups open by default; collapsed groups load on demand when `market` is set. */
  candidates: StrongSwingCandidate[];
  /** Exact per-status totals when the server trimmed `candidates` to the rendered cards. */
  counts?: Partial<Record<StrongSwingStatus, number>>;
  planIds: Record<string, string>;
  /** Enables on-demand loading of the collapsed groups for this market. */
  market?: string;
}) {
  const { chart, closeChart, bindChartGesture } = useTradingViewChart();
  const ranked = candidates;
  const of = (status: StrongSwingStatus) => ranked.filter((candidate) => candidate.status === status);
  const total = (status: StrongSwingStatus) => counts?.[status] ?? of(status).length;
  // Collapsed groups come from the server on first open when this screen defers them.
  const group = (status: StrongSwingStatus) => market && LAZY_STATUSES.strong.has(status)
    ? { source: { screen: "strong" as const, market, status } }
    : { candidates: of(status) };
  const executionReady = of("EXECUTION_READY");

  return (
    <div className="space-y-8">
      <div className="rounded-lg border border-cyan-400/15 bg-cyan-400/[0.035] px-4 py-3 text-xs leading-relaxed text-cyan-50/65">
        Strong Swing starts with the same base Swing classifier. Every base Swing setup is assessed; base rank is its position in that list. Pullback candidates are confirmed breakouts that are above the buy zone (confirmed entry + 0.50 ATR) or more than 15% above the 20-day average. They are not buyable, and a later pullback does not reactivate them automatically: Execution ready still needs a current breakout with two confirming closes, so most re-qualify only by setting up again. Strong rank is recalculated after confirmation, liquidity, volatility, circuit-behaviour and entry-safety gates.
        <span className="mt-2 block text-white/45">Double-click a stock card, or long-press it on mobile, to open its interactive chart.</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6 sm:gap-3">
        {[
          ["Execution ready", total("EXECUTION_READY"), "text-emerald-300"],
          ["Pullback candidates", total("WAIT_FOR_ENTRY"), "text-cyan-200"],
          ["Watchlist", total("WATCHLIST"), "text-amber-200"],
          ["Unverified data", total("UNVERIFIED"), "text-slate-200"],
          ["Risk off", total("RISK_OFF"), "text-orange-200"],
          ["Invalidated", total("INVALIDATED"), "text-rose-300"],
        ].map(([label, value, color]) => (
          <div key={String(label)} className="border-b border-white/10 px-1 pb-3">
            <div className={`font-mono text-2xl font-bold ${color}`}>{value}</div>
            <div className="mt-1 text-[10px] uppercase tracking-wider text-white/38">{label}</div>
          </div>
        ))}
      </div>

      {total("EXECUTION_READY") === 0 && (
        <div className="rounded-lg border border-amber-400/20 bg-amber-400/[0.04] px-4 py-5 text-sm text-amber-100/75">
          No stock currently passes every technical and execution-safety gate. This is intentional: missed entries, parabolic moves, excessive stop risk and circuit-prone behaviour are not actionable.
        </div>
      )}

      <CandidateGroup title="Execution ready" candidates={executionReady} totalCount={total("EXECUTION_READY")} planIds={planIds} color="text-emerald-300" defaultOpen bindChartGesture={bindChartGesture} />
      <CandidateGroup title="Pullback candidates" {...group("WAIT_FOR_ENTRY")} totalCount={total("WAIT_FOR_ENTRY")} planIds={planIds} color="text-cyan-200" bindChartGesture={bindChartGesture} />
      <CandidateGroup
        title="Awaiting confirmation"
        {...group("WATCHLIST")}
        limit={30}
        limitNote={(shown, count) => `Showing the strongest ${shown} of ${count}`}
        planIds={planIds}
        totalCount={total("WATCHLIST")}
        color="text-amber-200"
        bindChartGesture={bindChartGesture}
      />
      <CandidateGroup title="Unverified data" {...group("UNVERIFIED")} limit={30} planIds={planIds} totalCount={total("UNVERIFIED")} color="text-slate-200" bindChartGesture={bindChartGesture} />
      <CandidateGroup title="Risk off" {...group("RISK_OFF")} limit={30} planIds={planIds} totalCount={total("RISK_OFF")} color="text-orange-200" bindChartGesture={bindChartGesture} />
      <CandidateGroup
        title="Invalidated"
        {...group("INVALIDATED")}
        limit={20}
        limitNote={(shown, count) => `Showing the highest-ranked ${shown} of ${count}`}
        planIds={planIds}
        totalCount={total("INVALIDATED")}
        color="text-rose-300"
        bindChartGesture={bindChartGesture}
      />
      <TradingViewChartModal chart={chart} onClose={closeChart} />
    </div>
  );
}
