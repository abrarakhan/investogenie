"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import type { LongTermCandidate, LongTermResult } from "@/lib/long-term-actions";
import { getLongTermCandidates } from "@/lib/long-term-actions";
import {
  LONG_TERM_STRATEGY_META,
  type LongTermStrategyKey,
} from "@/lib/analytics/longTermStrategies";
import type { Market } from "@/lib/screener/service";
import StrategyBadge from "./StrategyBadge";

// Local formatters, matching components/screener/ScreenerTable.tsx's existing
// conventions (fmtCr / fmtMarketCap / fmtPct) — small pure functions, not
// imported, since that file exports nothing and this feature must not touch it.
const fmt1 = (n: number | null) => (n === null ? "—" : n.toFixed(1));
const fmtPct = (n: number | null) => (n === null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`);
const fmtCr = (n: number | null): string => {
  if (n === null) return "—";
  if (n >= 100_000) return `${(n / 100_000).toFixed(2)}L Cr`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k Cr`;
  return `${Math.round(n)} Cr`;
};
const fmtMarketCap = (n: number | null, currency: string): string => {
  if (currency !== "USD") return fmtCr(n);
  if (n === null) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}T`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}B`;
  return `$${Math.round(n)}M`;
};
const varColor = (n: number | null) =>
  n === null ? "text-white/30" : n >= 0 ? "text-emerald-400" : "text-rose-400";

function CandidateRow({ candidate }: { candidate: LongTermCandidate }) {
  const [expanded, setExpanded] = useState(false);
  const topScore = candidate.scores[0];

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-base font-bold text-white">{candidate.symbol}</h3>
            {candidate.name && <span className="truncate text-sm text-white/45">{candidate.name}</span>}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/50">
            <span className="font-mono text-white/75">
              {candidate.ltp !== null ? candidate.ltp.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}
            </span>
            <span className={varColor(candidate.changePct1d)}>{fmtPct(candidate.changePct1d)}</span>
            <span>MCap {fmtMarketCap(candidate.marketCap, candidate.currency)}</span>
            {candidate.peRatio !== null && <span>P/E {fmt1(candidate.peRatio)}×</span>}
            {candidate.roe !== null && <span>ROE {fmt1(candidate.roe)}%</span>}
            {candidate.sector && <span className="text-white/35">{candidate.sector}</span>}
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 lg:justify-end">
          {candidate.scores.slice(0, 3).map((s) => (
            <StrategyBadge key={s.key} strategyKey={s.key} score={s.matchScore} />
          ))}
          {candidate.scores.length > 3 && (
            <span className="self-center text-[10px] text-white/30">+{candidate.scores.length - 3} more</span>
          )}
        </div>
      </div>

      {topScore && (
        <div className="mt-3 border-t border-white/5 pt-3">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-white/45 hover:text-white/70"
          >
            <span className="text-[10px]">{expanded ? "▲" : "▼"}</span>
            {topScore.matchedCriteria}/{topScore.totalCriteria} {LONG_TERM_STRATEGY_META.find((m) => m.key === topScore.key)?.label} criteria matched
          </button>
          {expanded && (
            <div className="mt-2 grid gap-1 sm:grid-cols-2">
              {topScore.outcomes.map((o) => (
                <div
                  key={o.label}
                  className={`flex items-start gap-1.5 text-[11px] ${o.passed ? "text-emerald-300/90" : o.dataMissing ? "text-white/30" : "text-rose-300/80"}`}
                >
                  <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
                  <span>{o.label}{o.dataMissing ? " — no data" : ""}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function LongTermCandidatesClient({
  market,
  initial,
}: {
  market: Market;
  initial: LongTermResult;
}) {
  const [activeStrategies, setActiveStrategies] = useState<LongTermStrategyKey[]>([]);
  const [minScore, setMinScore] = useState(0);
  const [result, setResult] = useState(initial);
  const [pending, startTransition] = useTransition();

  const toggleStrategy = (key: LongTermStrategyKey) => {
    const next = activeStrategies.includes(key)
      ? activeStrategies.filter((k) => k !== key)
      : [...activeStrategies, key];
    setActiveStrategies(next);
    startTransition(async () => {
      setResult(await getLongTermCandidates({ market, strategies: next, minScore, limit: 50 }));
    });
  };

  const applyMinScore = (value: number) => {
    setMinScore(value);
    startTransition(async () => {
      setResult(await getLongTermCandidates({ market, strategies: activeStrategies, minScore: value, limit: 50 }));
    });
  };

  const clearStrategies = () => {
    setActiveStrategies([]);
    startTransition(async () => {
      setResult(await getLongTermCandidates({ market, strategies: [], minScore, limit: 50 }));
    });
  };

  const asOf = useMemo(
    () => (result.refreshedAt ? new Date(result.refreshedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : null),
    [result.refreshedAt],
  );

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-[var(--ig-accent)]">Long-Term Investment Candidates</p>
            <h2 className="mt-2 text-2xl font-black">Six investors&apos; fundamentals screens, scored together</h2>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-white/55">
              Every stock is scored against Lynch, Buffett, Graham, Fisher, Templeton and Greenblatt&apos;s
              published criteria, adapted to the fundamentals this app actually has. Several criteria are
              approximations, clearly marked — read{" "}
              <Link href="/help/long-term-engine" className="text-[var(--ig-accent)] hover:underline">
                how it works
              </Link>{" "}
              before treating a high score as a literal match to any investor&apos;s original test.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-center text-xs">
            <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
              <b className="block text-lg tabular-nums">{result.candidates.length}</b>
              <span className="text-white/40">Candidates</span>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
              <b className="block text-lg tabular-nums">{result.scanned}</b>
              <span className="text-white/40">Scanned</span>
            </div>
          </div>
        </div>
        {asOf && <p className="mt-3 text-[11px] text-white/30">Fundamentals as of {asOf} IST</p>}
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/45">Filter by strategy</p>
          {activeStrategies.length > 0 && (
            <button type="button" onClick={clearStrategies} className="text-xs text-white/40 hover:text-white/70 underline">
              Clear ({activeStrategies.length})
            </button>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {LONG_TERM_STRATEGY_META.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => toggleStrategy(m.key)}
              title={m.tagline}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeStrategies.includes(m.key)
                  ? "border-[var(--ig-accent)]/60 bg-[var(--ig-accent)]/15 text-[var(--ig-accent)]"
                  : "border-white/10 bg-black/20 text-white/55 hover:border-white/25 hover:text-white/80"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="mt-4 flex items-center gap-3">
          <label htmlFor="min-score" className="shrink-0 text-xs font-semibold uppercase tracking-[0.18em] text-white/45">
            Min score
          </label>
          <input
            id="min-score"
            type="range"
            min={0}
            max={100}
            step={5}
            value={minScore}
            onChange={(e) => applyMinScore(Number(e.target.value))}
            className="w-full max-w-xs"
          />
          <span className="w-10 shrink-0 text-right font-mono text-sm text-white/75">{minScore}%</span>
        </div>
      </section>

      <section className={`space-y-3 transition-opacity ${pending ? "opacity-50" : ""}`}>
        {result.candidates.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
            <p className="text-white/55">No stocks match the selected strategies and minimum score.</p>
            <p className="mt-1 text-xs text-white/35">Try lowering the minimum score or clearing strategy filters.</p>
          </div>
        ) : (
          result.candidates.map((c) => <CandidateRow key={c.assetId} candidate={c} />)
        )}
      </section>
    </div>
  );
}
