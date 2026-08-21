import type { StrongSwingCandidate } from "@/lib/strongSwing";
import type { StrongSwingStatus } from "@/lib/analytics/strongSwing";

const STATUS_STYLE: Record<StrongSwingStatus, string> = {
  CONFIRMED: "border-emerald-400/35 bg-emerald-400/10 text-emerald-300",
  WATCHLIST: "border-amber-400/35 bg-amber-400/10 text-amber-200",
  INVALIDATED: "border-rose-400/35 bg-rose-400/10 text-rose-300",
};

const statusLabel: Record<StrongSwingStatus, string> = {
  CONFIRMED: "Confirmed buy",
  WATCHLIST: "Awaiting confirmation",
  INVALIDATED: "Invalidated",
};

const fmt = (value: number | null, digits = 2) =>
  value === null || !Number.isFinite(value) ? "-" : value.toFixed(digits);

function CandidateCard({ candidate }: { candidate: StrongSwingCandidate }) {
  const passed = candidate.gates.filter((gate) => gate.passed).length;
  return (
    <article className="rounded-lg border border-white/10 bg-white/[0.025] p-4 sm:p-5">
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
            {statusLabel[candidate.status]}
          </span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Current", candidate.lastQuote ?? candidate.latestClose, "text-white"],
          ["Confirmed entry", candidate.strongEntry, "text-white"],
          ["Target", candidate.strongTarget, "text-emerald-300"],
          ["Stop", candidate.strongStop, "text-rose-300"],
        ].map(([label, value, color]) => (
          <div key={String(label)} className="rounded-md bg-black/30 px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wide text-white/35">{label}</div>
            <div className={`mt-1 font-mono text-sm ${color}`}>{fmt(Number(value))}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {candidate.gates.map((gate) => (
          <div key={gate.key} className={`rounded-md border px-3 py-2 ${gate.passed ? "border-emerald-400/15 bg-emerald-400/[0.035]" : "border-rose-400/15 bg-rose-400/[0.035]"}`}>
            <div className="flex items-center gap-2 text-xs font-semibold">
              <span className={gate.passed ? "text-emerald-300" : "text-rose-300"}>{gate.passed ? "PASS" : "WAIT"}</span>
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
      </div>
    </article>
  );
}

export default function StrongSwingCandidates({ candidates }: { candidates: StrongSwingCandidate[] }) {
  const confirmed = candidates.filter((candidate) => candidate.status === "CONFIRMED");
  const watchlist = candidates.filter((candidate) => candidate.status === "WATCHLIST");
  const invalidated = candidates.filter((candidate) => candidate.status === "INVALIDATED");
  const visibleWatchlist = watchlist.slice(0, 30);
  const visibleInvalidated = invalidated.slice(0, 20);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {[
          ["Confirmed", confirmed.length, "text-emerald-300"],
          ["Watchlist", watchlist.length, "text-amber-200"],
          ["Invalidated", invalidated.length, "text-rose-300"],
        ].map(([label, value, color]) => (
          <div key={String(label)} className="border-b border-white/10 px-1 pb-3">
            <div className={`font-mono text-2xl font-bold ${color}`}>{value}</div>
            <div className="mt-1 text-[10px] uppercase tracking-wider text-white/38">{label}</div>
          </div>
        ))}
      </div>

      {confirmed.length === 0 && (
        <div className="rounded-lg border border-amber-400/20 bg-amber-400/[0.04] px-4 py-5 text-sm text-amber-100/75">
          No stock currently passes every confirmation gate. This is intentional: first-day breakouts stay on the watchlist until follow-through is proven.
        </div>
      )}

      {confirmed.length > 0 && <section className="space-y-3"><h2 className="text-sm font-bold uppercase tracking-[0.18em] text-emerald-300">Confirmed buys</h2>{confirmed.map((candidate) => <CandidateCard key={candidate.assetId} candidate={candidate} />)}</section>}
      {watchlist.length > 0 && <section className="space-y-3"><div className="flex flex-wrap items-end justify-between gap-2"><h2 className="text-sm font-bold uppercase tracking-[0.18em] text-amber-200">Awaiting confirmation</h2>{watchlist.length > visibleWatchlist.length && <span className="text-[11px] text-white/35">Showing the strongest {visibleWatchlist.length} of {watchlist.length}</span>}</div>{visibleWatchlist.map((candidate) => <CandidateCard key={candidate.assetId} candidate={candidate} />)}</section>}
      {invalidated.length > 0 && <details className="rounded-lg border border-white/10 px-4 py-3"><summary className="cursor-pointer text-sm text-white/55">Show invalidated setups ({invalidated.length})</summary><div className="mt-4 space-y-3">{visibleInvalidated.map((candidate) => <CandidateCard key={candidate.assetId} candidate={candidate} />)}{invalidated.length > visibleInvalidated.length && <p className="text-xs text-white/35">Showing the highest-ranked {visibleInvalidated.length} invalidated setups.</p>}</div></details>}
    </div>
  );
}
