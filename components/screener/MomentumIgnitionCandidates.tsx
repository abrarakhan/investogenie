import Link from "next/link";
import type { MomentumIgnitionCandidate, MomentumIgnitionResult } from "@/lib/momentumIgnition";
import type { MomentumIgnitionV2Status } from "@/lib/analytics/momentumIgnitionV2";

const STATUS_STYLE: Record<MomentumIgnitionV2Status, string> = {
  MOMENTUM_READY: "border-emerald-400/35 bg-emerald-400/10 text-emerald-200",
  FIRST_THRUST: "border-cyan-400/35 bg-cyan-400/10 text-cyan-200",
  RETEST_SETUP: "border-sky-400/35 bg-sky-400/10 text-sky-200",
  PRE_IGNITION: "border-amber-400/35 bg-amber-400/10 text-amber-200",
  LATE_PROFIT_BOOKING: "border-orange-400/35 bg-orange-400/10 text-orange-200",
  FAILED_BREAKOUT: "border-rose-400/35 bg-rose-400/10 text-rose-200",
  NOT_QUALIFIED: "border-white/15 bg-white/5 text-white/45",
};

const STATUS_LABEL: Record<MomentumIgnitionV2Status, string> = {
  MOMENTUM_READY: "Momentum ready",
  FIRST_THRUST: "First thrust",
  RETEST_SETUP: "Retest setup",
  PRE_IGNITION: "Pre-ignition",
  LATE_PROFIT_BOOKING: "Late / profit-booking risk",
  FAILED_BREAKOUT: "Failed breakout",
  NOT_QUALIFIED: "Not qualified",
};

const number = (value: number, digits = 2) => Number.isFinite(value) ? value.toFixed(digits) : "-";
const signed = (value: number | null, digits = 1) => value === null || !Number.isFinite(value)
  ? "-"
  : `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;

const breakoutDistance = (value: number) => value >= 0
  ? `${number(value, 1)}% below`
  : `${number(Math.abs(value), 1)}% above`;

function IgnitionCard({ candidate, rank, market }: { candidate: MomentumIgnitionCandidate; rank: number; market: "IN" | "US" }) {
  const keyGates = candidate.gates.filter((item) => [
    "trend", "relative_strength", "compression", "dry_up", "live_volume", "liquidity", "volatility", "circuit",
  ].includes(item.key));
  const canTrack = candidate.status === "MOMENTUM_READY" && candidate.strongStatus === "EXECUTION_READY";
  const ledgerParams = new URLSearchParams({
    assetId: candidate.assetId,
    ticker: candidate.ticker,
    strategy: "MOMENTUM_IGNITION",
    current: String(candidate.currentPrice),
    entry: String(candidate.projectedEntry),
    target: String(candidate.projectedTarget),
    stop: String(candidate.projectedStop),
    trail: String(candidate.projectedTrail),
    days: String(candidate.projectedDays),
  });
  return (
    <article className="rounded-lg border border-white/10 bg-white/[0.025] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] text-white/30">#{rank}</span>
            <h3 className="text-lg font-black">{candidate.ticker}</h3>
            <span className="text-[10px] uppercase tracking-wider text-white/35">{candidate.exchange}</span>
            <span className="rounded-full border border-white/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white/45">
              {candidate.modelType === "NEW_LISTING" ? `New listing · ${candidate.tradingSessions} sessions` : "Established"}
            </span>
          </div>
          <p className="mt-1 truncate text-xs text-white/42">{candidate.name ?? candidate.baseVerdict}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-bold text-white/75">{candidate.score}/100</span>
          <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-wide ${STATUS_STYLE[candidate.status]}`}>
            {STATUS_LABEL[candidate.status]}
          </span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric
          label={candidate.status === "MOMENTUM_READY" ? "Live entry" : "Current"}
          value={number(candidate.status === "MOMENTUM_READY" ? candidate.projectedEntry : candidate.currentPrice)}
          detail={candidate.status === "MOMENTUM_READY" ? "Latest quote plan" : signed(candidate.quoteChangePct)}
        />
        <Metric label="Breakout trigger" value={number(candidate.entryTrigger)} detail={breakoutDistance(candidate.distanceToBreakoutPct)} />
        <Metric label="Model stop" value={number(candidate.projectedStop)} detail="Planning reference" />
        <Metric label="Model target" value={number(candidate.projectedTarget)} detail="Planning reference" />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[11px] sm:grid-cols-3">
        <Fact label="RS 20d" value={signed(candidate.relativeStrength20Pct)} />
        <Fact label="Ignition acceleration" value={signed(candidate.ignitionAccelerationPct)} />
        <Fact label="Projected volume" value={`${number(candidate.projectedVolumeRatio)}x`} />
        <Fact label="Compression" value={`${number(candidate.compressionRatio)}x`} />
        <Fact label="Dry-up" value={`${number(candidate.volumeDryUpRatio)}x`} />
        <Fact label="Accumulation" value={`${candidate.accumulationDays10} days`} />
        <Fact label="5-session move" value={signed(candidate.return5Pct)} />
        <Fact label="Resistance headroom" value={candidate.resistanceHeadroomPct === null ? "Clear" : signed(candidate.resistanceHeadroomPct)} />
        <Fact label="Projected holding" value={`~${candidate.projectedDays} sessions`} />
        <Fact label="Trailing reference" value={number(candidate.projectedTrail)} />
      </div>

      <details className="mt-3 border-t border-white/8 pt-3">
        <summary className="min-h-9 cursor-pointer text-xs font-semibold text-white/50 hover:text-white">Why it is here</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {keyGates.map((item) => (
            <div key={item.key} className="rounded-md bg-black/25 px-3 py-2 text-[11px]">
              <span className={item.passed ? "font-bold text-emerald-300" : "font-bold text-amber-300"}>{item.passed ? "PASS" : "WAIT"}</span>
              <span className="ml-2 font-semibold text-white/65">{item.label}</span>
              <p className="mt-1 text-white/38">{item.detail}</p>
            </div>
          ))}
        </div>
      </details>

      <div className="mt-3 rounded-md border border-white/8 bg-black/20 px-3 py-2 text-[11px] leading-relaxed text-white/48">
        {candidate.timingReasons.map((reason) => <p key={reason}>- {reason}</p>)}
      </div>

      <div className="mt-3 border-t border-white/8 pt-3">
        {canTrack ? <Link
          href={`/terminal/${market.toLowerCase()}/trade-ledger?${ledgerParams.toString()}`}
          className="inline-flex min-h-11 items-center rounded-lg border border-emerald-400/35 bg-emerald-400/10 px-4 text-sm font-bold text-emerald-200 hover:bg-emerald-400/15"
        >Buy &amp; Track</Link> : <p className="text-[11px] leading-relaxed text-white/38">
          {candidate.status === "MOMENTUM_READY"
            ? candidate.strongStatus
              ? `Buy blocked: Strong Swing is ${candidate.strongStatus.toLowerCase().replaceAll("_", " ")}.`
              : "Buy blocked: awaiting a current-session Strong Swing assessment."
            : "Buy & Track unlocks only at Momentum ready after early-timing checks and Strong Swing confirmation pass."}
        </p>}
      </div>
    </article>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="rounded-md bg-black/30 px-3 py-2.5">
    <div className="text-[10px] uppercase tracking-wide text-white/35">{label}</div>
    <div className="mt-1 font-mono text-sm font-bold text-white/85">{value}</div>
    <div className="mt-0.5 text-[10px] text-white/35">{detail}</div>
  </div>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-2 border-b border-white/5 pb-1">
    <span className="text-white/35">{label}</span><span className="font-mono text-white/65">{value}</span>
  </div>;
}

function CandidateGroup({
  title,
  candidates,
  color,
  market,
  defaultOpen = false,
}: {
  title: string;
  candidates: Array<{ candidate: MomentumIgnitionCandidate; rank: number }>;
  color: string;
  market: "IN" | "US";
  defaultOpen?: boolean;
}) {
  if (!candidates.length) return null;
  return <details open={defaultOpen} className="group rounded-lg border border-white/10 bg-white/[0.012]">
    <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
      <div className={`text-sm font-bold uppercase tracking-[0.18em] ${color}`}>
        {title} <span className="font-mono text-white/45">({candidates.length})</span>
      </div>
      <span className="shrink-0 text-xs font-semibold text-white/45 group-open:hidden">Expand</span>
      <span className="hidden shrink-0 text-xs font-semibold text-white/45 group-open:inline">Collapse</span>
    </summary>
    <div className="space-y-3 border-t border-white/8 p-3 sm:p-4">
      {candidates.map(({ candidate, rank }) => <IgnitionCard key={candidate.assetId} candidate={candidate} rank={rank} market={market} />)}
    </div>
  </details>;
}

export default function MomentumIgnitionCandidates({ result }: { result: MomentumIgnitionResult }) {
  const marketLabel = result.market === "IN" ? "NSE" : "US";
  const ranked = result.candidates.map((candidate, index) => ({ candidate, rank: index + 1 }));
  const executionReady = ranked.filter(({ candidate }) => candidate.status === "MOMENTUM_READY" && candidate.strongStatus === "EXECUTION_READY");
  const momentumReady = ranked.filter(({ candidate }) => candidate.status === "MOMENTUM_READY" && candidate.strongStatus !== "EXECUTION_READY");
  const firstThrust = ranked.filter(({ candidate }) => candidate.status === "FIRST_THRUST");
  const preIgnition = ranked.filter(({ candidate }) => candidate.status === "PRE_IGNITION");
  const retest = ranked.filter(({ candidate }) => candidate.status === "RETEST_SETUP");
  const late = ranked.filter(({ candidate }) => candidate.status === "LATE_PROFIT_BOOKING");
  const failed = ranked.filter(({ candidate }) => candidate.status === "FAILED_BREAKOUT");
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/10 pb-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-300">Separate discovery engine · not the base Swing ranking</div>
          <h2 className="mt-1 text-2xl font-black">Momentum Ignition V2</h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-white/45">
            Finds liquid {marketLabel} trend leaders, including recent listings, approaching expansion before the confirmed Strong Swing engine acts.
          </p>
        </div>
        <div className="text-right text-xs text-white/40">
          <div><span className="font-mono font-bold text-white/75">{result.universeScanned.toLocaleString("en-IN")}</span> active {marketLabel} stocks scanned</div>
          <div>{result.detailedAssessments.toLocaleString("en-IN")} near-breakout charts assessed</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {[
          ["Execution ready", executionReady.length, "text-emerald-200"],
          ["Momentum ready", momentumReady.length, "text-emerald-300"],
          ["First thrust", firstThrust.length, "text-cyan-200"],
          ["Pre-ignition", preIgnition.length, "text-amber-200"],
          ["Retest setup", retest.length, "text-sky-200"],
          ["Late risk", late.length, "text-orange-200"],
          ["Failed", failed.length, "text-rose-200"],
        ].map(([label, value, color]) => <div key={String(label)} className="border-b border-white/10 px-1 pb-2">
          <div className={`font-mono text-xl font-bold ${color}`}>{value}</div>
          <div className="text-[10px] uppercase tracking-wide text-white/35">{label}</div>
        </div>)}
      </div>

      <div className="rounded-lg border border-cyan-400/15 bg-cyan-400/[0.035] px-4 py-3 text-xs leading-relaxed text-cyan-100/65">
        V2 discovery targets the first thrust or first retest over the next 1–2 sessions. It penalizes repeated highs, nearby resistance, decelerating relative strength and intraday rejection. Strong Swing remains the execution authority.
      </div>

      {ranked.length === 0
        ? <div className="rounded-lg border border-white/10 px-4 py-8 text-center text-sm text-white/45">No {marketLabel} stock currently passes the Momentum Ignition discovery floor.</div>
        : <div className="space-y-3">
          <CandidateGroup title="Execution ready" candidates={executionReady} color="text-emerald-200" market={result.market} defaultOpen />
          <CandidateGroup title="Momentum ready" candidates={momentumReady} color="text-emerald-300" market={result.market} />
          <CandidateGroup title="First thrust" candidates={firstThrust} color="text-cyan-200" market={result.market} />
          <CandidateGroup title="Pre-ignition" candidates={preIgnition} color="text-amber-200" market={result.market} />
          <CandidateGroup title="Retest setup" candidates={retest} color="text-sky-200" market={result.market} />
          <CandidateGroup title="Late / profit-booking risk" candidates={late} color="text-orange-200" market={result.market} />
          <CandidateGroup title="Failed breakout" candidates={failed} color="text-rose-200" market={result.market} />
        </div>}
    </section>
  );
}
