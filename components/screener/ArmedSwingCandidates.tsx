import Link from "next/link";
import type { ArmedSwingCandidate, ArmedSwingResult } from "@/lib/armedSwing";
import type { ArmedSwingStatus } from "@/lib/analytics/armedSwing";
import { ARMED_STATUS_LABEL as STATUS_LABEL, ARMED_WHEN_TO_ENTER as WHEN_TO_ENTER } from "@/lib/armedSwingCopy";
import { createPendingBuyStop } from "@/app/terminal/[market]/trade-ledger/pendingOrderActions";

const STATUS_STYLE: Record<ArmedSwingStatus, string> = {
  BUY_ZONE: "border-emerald-400/35 bg-emerald-400/10 text-emerald-300",
  TRIGGERED_UNCONFIRMED: "border-lime-400/35 bg-lime-400/10 text-lime-200",
  ARMED: "border-cyan-400/35 bg-cyan-400/10 text-cyan-200",
  UNVERIFIED: "border-slate-300/30 bg-slate-300/10 text-slate-200",
  FORMING: "border-amber-400/35 bg-amber-400/10 text-amber-200",
  EXTENDED: "border-violet-400/35 bg-violet-400/10 text-violet-200",
  RISK_OFF: "border-orange-400/35 bg-orange-400/10 text-orange-200",
  INVALIDATED: "border-rose-400/35 bg-rose-400/10 text-rose-300",
};

// Only a live, volume-confirmed breakout inside the limit is an immediate purchase. ARMED is an
// order to place, recorded as pending — never as a filled trade.
const BUY_ENABLED: ReadonlySet<ArmedSwingStatus> = new Set(["BUY_ZONE"]);

const fmt = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined || !Number.isFinite(value) ? "-" : value.toFixed(digits);

function CandidateCard({ candidate, planId }: { candidate: ArmedSwingCandidate; planId: string | null }) {
  const { plan } = candidate;
  const blocking = candidate.gates.filter((gate) => gate.blocking);
  // Only the server-held plan id travels to the ledger; the levels are read back from the
  // database there. `current` merely pre-fills the price box.
  const ledgerParams = new URLSearchParams({
    assetId: candidate.assetId,
    ticker: candidate.ticker,
    strategy: "ARMED_SWING",
    planId: planId ?? "",
    current: String(candidate.currentPrice),
  });
  const buyEnabled = BUY_ENABLED.has(candidate.status) && planId !== null;
  return (
    <article className="rounded-lg border border-white/10 bg-white/[0.025] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold">{candidate.ticker}</h2>
            <span className="text-[10px] uppercase tracking-wider text-white/35">{candidate.exchange} · #{candidate.rank}</span>
          </div>
          <div className="mt-1 text-sm text-white/48">{candidate.name ?? ""}{candidate.name ? " · " : ""}Base through {candidate.latestDate}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-white/60">{candidate.strengthScore}/100</span>
          <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-wide ${STATUS_STYLE[candidate.status]}`}>
            {STATUS_LABEL[candidate.status]}
          </span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        {[
          ["Buy-stop trigger", fmt(plan.trigger), "text-white"],
          ["Limit (max fill)", fmt(plan.limit), "text-white/80"],
          ["Target", fmt(plan.target), "text-emerald-300"],
          ["Stop", fmt(plan.stop), "text-rose-300"],
          ["Trail", fmt(plan.trail), "text-amber-200"],
          ["Current", fmt(candidate.currentPrice), "text-white"],
          ["To trigger", candidate.distanceToTriggerPct > 0 ? `${fmt(candidate.distanceToTriggerPct, 1)}%` : "Triggered", "text-cyan-200"],
          ["Horizon", `~${plan.expectedDays}d`, "text-cyan-200"],
        ].map(([label, value, color]) => (
          <div key={label} className="rounded-md bg-black/30 px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wide text-white/35">{label}</div>
            <div className={`mt-1 font-mono text-sm ${color}`}>{value}</div>
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-md border border-white/8 bg-black/20 px-3 py-3 text-xs leading-relaxed text-white/55">
        <span className="font-semibold text-white/75">When to enter: </span>{WHEN_TO_ENTER[candidate.status]}
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-white/45">
          <span>Pivot {fmt(plan.pivot)}</span>
          <span>Risk {fmt(plan.riskPerSharePct, 1)}% per share</span>
          <span>Reward:risk {fmt(plan.rewardRiskRatio, 1)}</span>
          <span>Suggested exposure {candidate.suggestedExposurePct}%</span>
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
        <span>{blocking.filter((gate) => gate.passed).length}/{blocking.length} required gates passed</span>
        <span>RS {candidate.rsPercentile === null ? "-" : `${candidate.rsPercentile.toFixed(0)}th pct`}</span>
        <span>Base depth {fmt(candidate.baseDepthPct, 1)}%</span>
        <span>Contraction {(candidate.contractionRatio * 100).toFixed(0)}%</span>
        <span>Volume dry-up {(candidate.volumeDryUp * 100).toFixed(0)}%</span>
        {candidate.volumePace !== null && <span>Live volume pace {candidate.volumePace.toFixed(2)}x</span>}
        <span>ATR {fmt(candidate.atrPct, 1)}%</span>
      </div>

      <div className="mt-4 border-t border-white/8 pt-4">
        {buyEnabled ? (
          <>
            <Link
              href={`/terminal/${candidate.country.toLowerCase()}/trade-ledger?${ledgerParams.toString()}`}
              className="inline-flex min-h-11 items-center rounded-lg border border-emerald-400/35 bg-emerald-400/10 px-4 text-sm font-bold text-emerald-200 hover:bg-emerald-400/15"
            >
              Buy &amp; Track
            </Link>
            <p className="mt-2 text-[11px] leading-relaxed text-white/38">
              Records your actual purchase (at or above the trigger) against this frozen plan. Broker order placement is not connected; buy in ICICI Direct first.
            </p>
          </>
        ) : candidate.status === "ARMED" && planId ? (
          <form action={createPendingBuyStop} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="market" value={candidate.country} />
            <input type="hidden" name="assetId" value={candidate.assetId} />
            <input type="hidden" name="planId" value={planId ?? ""} />
            <label className="grid gap-1 text-[10px] uppercase tracking-wide text-white/40">
              Order quantity
              <input name="quantity" type="number" required min={candidate.country === "IN" ? 1 : 0.000001} step={candidate.country === "IN" ? 1 : "any"} className="field h-11 w-32" />
            </label>
            <button className="inline-flex min-h-11 items-center rounded-lg border border-cyan-400/35 bg-cyan-400/10 px-4 text-sm font-bold text-cyan-100 hover:bg-cyan-400/15">
              Record pending buy-stop
            </button>
            <p className="w-full text-[11px] leading-relaxed text-white/38">
              Place the buy-stop limit in ICICI Direct, then record it here. It stays a pending order (no position, capital or P&amp;L) until you confirm a fill between the trigger and the limit on the Trade Ledger. Expires after 7 days.
            </p>
          </form>
        ) : (
          <button type="button" disabled className="inline-flex min-h-11 cursor-not-allowed items-center rounded-lg border border-white/10 bg-white/[0.025] px-4 text-sm font-bold text-white/30">
            {(candidate.status === "ARMED" || candidate.status === "BUY_ZONE") && !planId ? "Plan not recorded — reload"
              : candidate.status === "TRIGGERED_UNCONFIRMED" ? "Buy after volume confirms"
              : candidate.status === "UNVERIFIED" ? "Blocked: execution data unverified" : "Buy unavailable"}
          </button>
        )}
      </div>
    </article>
  );
}

function Group({ title, candidates, planIds, color, defaultOpen = false, limit = 30 }: {
  title: string; candidates: ArmedSwingCandidate[]; planIds: Record<string, string>; color: string; defaultOpen?: boolean; limit?: number;
}) {
  if (!candidates.length) return null;
  const visible = candidates.slice(0, limit);
  return (
    <details open={defaultOpen} className="group rounded-lg border border-white/10 bg-white/[0.012]">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          <div className={`text-sm font-bold uppercase tracking-[0.18em] ${color}`}>
            {title} <span className="font-mono text-white/45">({candidates.length})</span>
          </div>
          {candidates.length > visible.length && <div className="mt-1 text-[11px] normal-case tracking-normal text-white/35">Showing the strongest {visible.length}</div>}
        </div>
        <span className="shrink-0 text-xs font-semibold text-white/45 group-open:hidden">Expand</span>
        <span className="hidden shrink-0 text-xs font-semibold text-white/45 group-open:inline">Collapse</span>
      </summary>
      <div className="space-y-3 border-t border-white/8 p-3 sm:p-4">
        {visible.map((candidate) => <CandidateCard key={candidate.assetId} candidate={candidate} planId={planIds[candidate.assetId] ?? null} />)}
      </div>
    </details>
  );
}

export default function ArmedSwingCandidates({ result, planIds }: { result: ArmedSwingResult; planIds: Record<string, string> }) {
  const by = (status: ArmedSwingStatus) => result.candidates.filter((candidate) => candidate.status === status);
  const groups: Array<[string, ArmedSwingStatus, string, boolean]> = [
    ["Buy zone", "BUY_ZONE", "text-emerald-300", true],
    ["Triggered · volume unconfirmed", "TRIGGERED_UNCONFIRMED", "text-lime-200", true],
    ["Armed · place buy-stop", "ARMED", "text-cyan-200", true],
    ["Execution data unverified", "UNVERIFIED", "text-slate-200", false],
    ["Base forming", "FORMING", "text-amber-200", false],
    ["Extended · missed", "EXTENDED", "text-violet-200", false],
    ["Risk off", "RISK_OFF", "text-orange-200", false],
    ["Invalidated", "INVALIDATED", "text-rose-300", false],
  ];
  const actionable = by("BUY_ZONE").length + by("ARMED").length;
  return (
    <div className="space-y-8">
      <div className="rounded-lg border border-cyan-400/15 bg-cyan-400/[0.035] px-4 py-3 text-xs leading-relaxed text-cyan-50/65">
        Scanned {result.universeCount.toLocaleString("en-IN")} active stocks; {result.scannedCount} completed-session bases within 10% of their pivot were assessed.
        Bases use completed sessions only{result.marketOpen ? "; today's session is used only for the live trigger and volume-pace check" : ""}.
        Relative strength is ranked across the whole market on weighted 3/6/9/12-month return.
      </div>
      {result.candidates.length > 0 && (
        <div className={`rounded-lg border px-4 py-3 text-xs leading-relaxed ${result.resultsVerifiedCount / result.candidates.length >= 0.9 ? "border-white/10 text-white/50" : "border-amber-400/25 bg-amber-400/[0.04] text-amber-100/75"}`}>
          Results calendar verified for {result.resultsVerifiedCount} of {result.candidates.length} assessed bases.
          Unverified names stay blocked until the calendar sync confirms their next results date.
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8 sm:gap-3">
        {groups.map(([label, status, color]) => (
          <div key={status} className="border-b border-white/10 px-1 pb-3">
            <div className={`font-mono text-2xl font-bold ${color}`}>{by(status).length}</div>
            <div className="mt-1 text-[10px] uppercase tracking-wider text-white/38">{label}</div>
          </div>
        ))}
      </div>
      {actionable === 0 && (
        <div className="rounded-lg border border-amber-400/20 bg-amber-400/[0.04] px-4 py-5 text-sm text-amber-100/75">
          No base currently qualifies for a buy-stop. Armed setups need a stage-2 trend, top-quintile relative strength, a tight contracting base and a price within 1.5 ATR of the pivot.
        </div>
      )}
      {groups.map(([label, status, color, open]) => (
        <Group key={status} title={label} candidates={by(status)} planIds={planIds} color={color} defaultOpen={open} />
      ))}
    </div>
  );
}
