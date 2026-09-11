import type { MomentumIgnitionCandidate, MomentumIgnitionResult } from "@/lib/momentumIgnition";
import type { MomentumIgnitionStatus } from "@/lib/analytics/momentumIgnition";

const STATUS_STYLE: Record<MomentumIgnitionStatus, string> = {
  ENTRY_READY: "border-emerald-400/35 bg-emerald-400/10 text-emerald-200",
  BREAKOUT_TRIGGERED: "border-cyan-400/35 bg-cyan-400/10 text-cyan-200",
  EARLY_WATCH: "border-amber-400/35 bg-amber-400/10 text-amber-200",
  WAIT_FOR_PULLBACK: "border-orange-400/35 bg-orange-400/10 text-orange-200",
  NOT_QUALIFIED: "border-white/15 bg-white/5 text-white/45",
};

const STATUS_LABEL: Record<MomentumIgnitionStatus, string> = {
  ENTRY_READY: "Entry ready",
  BREAKOUT_TRIGGERED: "Breakout triggered",
  EARLY_WATCH: "Early watch",
  WAIT_FOR_PULLBACK: "Wait for pullback",
  NOT_QUALIFIED: "Not qualified",
};

const number = (value: number, digits = 2) => Number.isFinite(value) ? value.toFixed(digits) : "-";
const signed = (value: number | null, digits = 1) => value === null || !Number.isFinite(value)
  ? "-"
  : `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;

const breakoutDistance = (value: number) => value >= 0
  ? `${number(value, 1)}% below`
  : `${number(Math.abs(value), 1)}% above`;

function IgnitionCard({ candidate, rank }: { candidate: MomentumIgnitionCandidate; rank: number }) {
  const keyGates = candidate.gates.filter((item) => [
    "trend", "relative_strength", "compression", "dry_up", "live_volume", "liquidity", "volatility", "circuit",
  ].includes(item.key));
  return (
    <article className="rounded-lg border border-white/10 bg-white/[0.025] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] text-white/30">#{rank}</span>
            <h3 className="text-lg font-black">{candidate.ticker}</h3>
            <span className="text-[10px] uppercase tracking-wider text-white/35">NSE</span>
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
        <Metric label="Current" value={number(candidate.currentPrice)} detail={signed(candidate.quoteChangePct)} />
        <Metric label="Breakout trigger" value={number(candidate.entryTrigger)} detail={breakoutDistance(candidate.distanceToBreakoutPct)} />
        <Metric label="Model stop" value={number(candidate.projectedStop)} detail="Planning reference" />
        <Metric label="Model target" value={number(candidate.projectedTarget)} detail="Planning reference" />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[11px] sm:grid-cols-3">
        <Fact label="RS 20d" value={signed(candidate.relativeStrength20Pct)} />
        <Fact label="RS acceleration" value={signed(candidate.relativeStrengthAcceleration)} />
        <Fact label="Projected volume" value={`${number(candidate.projectedVolumeRatio)}x`} />
        <Fact label="Compression" value={`${number(candidate.compressionRatio)}x`} />
        <Fact label="Dry-up" value={`${number(candidate.volumeDryUpRatio)}x`} />
        <Fact label="Accumulation" value={`${candidate.accumulationDays10} days`} />
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

export default function MomentumIgnitionCandidates({ result }: { result: MomentumIgnitionResult }) {
  const entryReady = result.candidates.filter((item) => item.status === "ENTRY_READY").length;
  const triggered = result.candidates.filter((item) => item.status === "BREAKOUT_TRIGGERED").length;
  const early = result.candidates.filter((item) => item.status === "EARLY_WATCH").length;
  const pullback = result.candidates.filter((item) => item.status === "WAIT_FOR_PULLBACK").length;
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/10 pb-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-300">Full-universe discovery</div>
          <h2 className="mt-1 text-2xl font-black">Momentum Ignition</h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-white/45">
            Finds liquid NSE trend leaders approaching expansion before the confirmed Strong Swing engine acts.
          </p>
        </div>
        <div className="text-right text-xs text-white/40">
          <div><span className="font-mono font-bold text-white/75">{result.universeScanned.toLocaleString("en-IN")}</span> active NSE stocks scanned</div>
          <div>{result.detailedAssessments.toLocaleString("en-IN")} near-breakout charts assessed</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Entry ready", entryReady, "text-emerald-300"],
          ["Triggered", triggered, "text-cyan-200"],
          ["Early watch", early, "text-amber-200"],
          ["Wait for pullback", pullback, "text-orange-200"],
        ].map(([label, value, color]) => <div key={String(label)} className="border-b border-white/10 px-1 pb-2">
          <div className={`font-mono text-xl font-bold ${color}`}>{value}</div>
          <div className="text-[10px] uppercase tracking-wide text-white/35">{label}</div>
        </div>)}
      </div>

      <div className="rounded-lg border border-cyan-400/15 bg-cyan-400/[0.035] px-4 py-3 text-xs leading-relaxed text-cyan-100/65">
        Discovery only. A fast move is not automatically a trade. Extended names remain Wait for Pullback, and the confirmed Strong Swing engine below remains the execution authority.
      </div>

      {result.candidates.length === 0
        ? <div className="rounded-lg border border-white/10 px-4 py-8 text-center text-sm text-white/45">No NSE stock currently passes the Momentum Ignition discovery floor.</div>
        : <div className="space-y-3">{result.candidates.map((candidate, index) => (
          <IgnitionCard key={candidate.assetId} candidate={candidate} rank={index + 1} />
        ))}</div>}
    </section>
  );
}
