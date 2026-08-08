"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import type { LongTermCandidate, LongTermResult } from "@/lib/long-term-actions";
import { getLongTermCandidates } from "@/lib/long-term-actions";
import {
  LONG_TERM_STRATEGY_META,
  type LongTermMarket,
  type LongTermStrategyKey,
} from "@/lib/analytics/longTermStrategies";
import StrategyBadge from "./StrategyBadge";

const fmt1 = (value: number | null) => value === null ? "—" : value.toFixed(1);
const fmtPct = (value: number | null) => value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
const fmtValue = (value: number | null) => value === null ? "—" : Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(2);

function fmtMarketCap(value: number | null, currency: string): string {
  if (value === null) return "—";
  if (currency === "USD") {
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}T`;
    if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}B`;
    return `$${Math.round(value)}M`;
  }
  if (value >= 100_000) return `${(value / 100_000).toFixed(2)}L Cr`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k Cr`;
  return `${Math.round(value)} Cr`;
}

function confidenceTone(confidence: number): string {
  if (confidence >= 85) return "border-emerald-500/25 bg-emerald-500/10 text-emerald-300";
  if (confidence >= 70) return "border-sky-500/25 bg-sky-500/10 text-sky-300";
  return "border-amber-500/25 bg-amber-500/10 text-amber-300";
}

function CandidateRow({ candidate, rank }: { candidate: LongTermCandidate; rank: number }) {
  const [expanded, setExpanded] = useState(false);
  const score = candidate.selectedScore;
  return (
    <article className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-white/30">#{rank}</span>
            <h3 className="text-base font-bold text-white">{candidate.symbol}</h3>
            {candidate.name && <span className="truncate text-sm text-white/45">{candidate.name}</span>}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/50">
            <span className="font-mono text-white/80">{candidate.ltp?.toLocaleString("en-IN", { maximumFractionDigits: 2 }) ?? "—"}</span>
            <span className={(candidate.changePct1d ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}>{fmtPct(candidate.changePct1d)}</span>
            <span>MCap {fmtMarketCap(candidate.marketCap, candidate.currency)}</span>
            <span>P/E {fmt1(candidate.peRatio)}×</span>
            <span>ROE {fmtPct(candidate.roe)}</span>
            {candidate.sector && <span className="text-white/35">{candidate.sector}</span>}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/35">
            <span>Report period {candidate.reportPeriod}</span>
            <span>Statements {candidate.statementPeriod ?? "not yet synced"}</span>
            <span>Quote {candidate.quoteAsOf ?? "unknown"}</span>
            <span>{candidate.historyYears}y annual history</span>
            <span>{candidate.statementPeriods} cash-flow periods</span>
            <span>Source {candidate.source ?? "unknown"}</span>
          </div>
        </div>

        <div className="flex items-start gap-2 lg:justify-end">
          <StrategyBadge strategyKey={score.key} score={score.matchScore} />
          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] ${confidenceTone(score.confidence)}`}>
            Evidence {score.confidence}%
          </span>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/5 pt-3 text-xs sm:grid-cols-4 lg:grid-cols-8">
        <div><span className="block text-white/30">Revenue CAGR 3Y</span><b className="font-mono text-white/70">{fmtPct(candidate.revenueCagr3y)}</b></div>
        <div><span className="block text-white/30">Profit CAGR 3Y</span><b className="font-mono text-white/70">{fmtPct(candidate.profitCagr3y)}</b></div>
        <div><span className="block text-white/30">Median ROCE</span><b className="font-mono text-white/70">{fmtPct(candidate.medianRoce5y)}</b></div>
        <div><span className="block text-white/30">FCF yield</span><b className="font-mono text-white/70">{fmtPct(candidate.freeCashFlowYield)}</b></div>
        <div><span className="block text-white/30">Current ratio</span><b className="font-mono text-white/70">{fmt1(candidate.currentRatio)}×</b></div>
        <div><span className="block text-white/30">Net debt / EBITDA</span><b className="font-mono text-white/70">{fmt1(candidate.netDebtToEbitda)}×</b></div>
        <div><span className="block text-white/30">Cash conversion</span><b className="font-mono text-white/70">{fmt1(candidate.medianCashConversion5y)}×</b></div>
        <div><span className="block text-white/30">Price / book</span><b className="font-mono text-white/70">{fmt1(candidate.priceToBook)}×</b></div>
      </div>

      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="mt-3 text-xs text-white/45 hover:text-white/75"
      >
        {expanded ? "Hide" : "Show"} scoring evidence · {score.availableCriteria}/{score.totalCriteria} criteria available
      </button>
      {expanded && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {score.outcomes.map((outcome) => (
            <div key={outcome.label} className="rounded-md border border-white/5 bg-black/20 p-2 text-[11px]">
              <div className="flex items-center justify-between gap-3">
                <span className={outcome.dataMissing ? "text-white/30" : outcome.passed ? "text-emerald-300" : "text-amber-300"}>{outcome.label}</span>
                <span className="font-mono text-white/45">{fmtValue(outcome.value)} · {outcome.score}/100</span>
              </div>
              <p className="mt-1 leading-relaxed text-white/30">{outcome.dataMissing ? "No usable data. " : ""}{outcome.description}</p>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

export default function LongTermCandidatesClient({ market, initial }: { market: LongTermMarket; initial: LongTermResult }) {
  const [activeStrategy, setActiveStrategy] = useState<LongTermStrategyKey>(initial.activeStrategy);
  const [minScore, setMinScore] = useState(50);
  const [minConfidence, setMinConfidence] = useState(60);
  const [result, setResult] = useState(initial);
  const [pending, startTransition] = useTransition();

  const refresh = (strategy: LongTermStrategyKey, score: number, confidence: number) => {
    startTransition(async () => {
      setResult(await getLongTermCandidates({ market, strategy, minScore: score, minConfidence: confidence, limit: 50 }));
    });
  };

  const chooseStrategy = (strategy: LongTermStrategyKey) => {
    setActiveStrategy(strategy);
    refresh(strategy, minScore, minConfidence);
  };

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-white/10 bg-white/[0.03] p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-[var(--ig-accent)]">Long-Term Investment Candidates</p>
            <h2 className="mt-2 text-2xl font-black">Strategy-specific rankings with evidence controls</h2>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-white/55">
              Rankings use the full fundamentals-covered universe, multi-year history, current-price-adjusted valuation,
              sector eligibility and a minimum evidence threshold. Review the{" "}
              <Link href="/help/long-term-engine" className="text-[var(--ig-accent)] hover:underline">methodology</Link>{" "}
              before making an investment decision.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-md border border-white/10 bg-black/25 px-3 py-2"><b className="block text-lg">{result.candidates.length}</b><span className="text-white/35">Shown</span></div>
            <div className="rounded-md border border-white/10 bg-black/25 px-3 py-2"><b className="block text-lg">{result.eligible}</b><span className="text-white/35">Eligible</span></div>
            <div className="rounded-md border border-white/10 bg-black/25 px-3 py-2"><b className="block text-lg">{result.scanned}</b><span className="text-white/35">Scanned</span></div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t border-white/5 pt-3 text-[11px] text-white/35">
          <span>Latest report period: {result.fundamentalsLatestPeriod ?? "unknown"}</span>
          <span>Oldest included period: {result.fundamentalsOldestPeriod ?? "unknown"}</span>
          <span>Excluded for sector/evidence: {result.excludedForEvidence}</span>
        </div>
      </section>

      <section className="rounded-lg border border-white/10 bg-white/[0.03] p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/45">Choose one ranking strategy</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {LONG_TERM_STRATEGY_META.map((meta) => (
            <button
              key={meta.key}
              type="button"
              onClick={() => chooseStrategy(meta.key)}
              className={`rounded-md border px-3 py-2 text-left text-xs transition-colors ${activeStrategy === meta.key ? "border-[var(--ig-accent)]/60 bg-[var(--ig-accent)]/15 text-[var(--ig-accent)]" : "border-white/10 bg-black/20 text-white/55 hover:border-white/25"}`}
            >
              <b className="block">{meta.label}</b>
              <span className="mt-0.5 block text-[10px] opacity-60">{meta.investor}</span>
            </button>
          ))}
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-xs text-white/45">
            <span className="mb-1 flex justify-between"><b>Minimum score</b><span>{minScore}%</span></span>
            <input type="range" min={0} max={100} step={5} value={minScore} onChange={(event) => { const value = Number(event.target.value); setMinScore(value); refresh(activeStrategy, value, minConfidence); }} className="w-full" />
          </label>
          <label className="text-xs text-white/45">
            <span className="mb-1 flex justify-between"><b>Minimum evidence</b><span>{minConfidence}%</span></span>
            <input type="range" min={60} max={100} step={5} value={minConfidence} onChange={(event) => { const value = Number(event.target.value); setMinConfidence(value); refresh(activeStrategy, minScore, value); }} className="w-full" />
          </label>
        </div>
      </section>

      <section className={`space-y-3 transition-opacity ${pending ? "opacity-45" : ""}`}>
        {result.candidates.length === 0
          ? <div className="rounded-lg border border-white/10 bg-white/[0.03] p-8 text-center text-sm text-white/50">No candidates meet both the score and evidence thresholds.</div>
          : result.candidates.map((candidate, index) => <CandidateRow key={candidate.assetId} candidate={candidate} rank={index + 1} />)}
      </section>
    </div>
  );
}
