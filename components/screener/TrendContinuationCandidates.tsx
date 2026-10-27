import type { TrendContinuationCandidate, TrendContinuationStatus } from "@/lib/trendContinuation";

const label: Record<TrendContinuationStatus, string> = {
  IMPULSE_DETECTED: "Impulse detected", CONTINUATION_WATCH: "Continuation watch",
  TREND_CONTINUATION_READY: "Continuation ready", EXTENDED_RISK: "Extended — do not chase",
};
const style: Record<TrendContinuationStatus, string> = {
  IMPULSE_DETECTED: "text-cyan-200 border-cyan-400/30", CONTINUATION_WATCH: "text-amber-200 border-amber-400/30",
  TREND_CONTINUATION_READY: "text-emerald-200 border-emerald-400/30", EXTENDED_RISK: "text-rose-200 border-rose-400/30",
};
const value = (number: unknown, suffix = "") => typeof number === "number" && Number.isFinite(number) ? `${number.toFixed(2)}${suffix}` : "-";

export default function TrendContinuationCandidates({ candidates }: { candidates: TrendContinuationCandidate[] }) {
  return <section className="space-y-4">
    <div className="border-b border-white/10 pb-4">
      <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-violet-300">Python signal engine · observation mode</div>
      <h2 className="mt-1 text-2xl font-black">Trend Continuation</h2>
      <p className="mt-1 max-w-3xl text-sm leading-relaxed text-white/45">Captures persistent 3–5 session moves that Momentum Ignition may no longer classify as early. It does not create a trade plan, unlock Buy &amp; Track, or feed auto-buy.</p>
    </div>
    {!candidates.length ? <div className="rounded-lg border border-white/10 p-5 text-sm text-white/45">No recent multi-session impulse passes the Python continuation floor.</div> :
      <div className="grid gap-3 lg:grid-cols-2">{candidates.map((candidate) => <article key={candidate.assetId} className="rounded-lg border border-white/10 bg-white/[0.025] p-4">
        <div className="flex items-start justify-between gap-3"><div><h3 className="text-lg font-black">{candidate.ticker}</h3><p className="text-xs text-white/40">{candidate.name}</p></div>
          <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase ${style[candidate.status]}`}>{label[candidate.status]}</span></div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs"><Metric label="3-session move" text={value(candidate.metrics.move3_atr, " ATR")} /><Metric label="Efficiency" text={value(typeof candidate.metrics.efficiency3 === "number" ? candidate.metrics.efficiency3 * 100 : null, "%")} /><Metric label="Score" text={`${candidate.score}/100`} /></div>
        {candidate.entry !== null && <div className="mt-2 grid grid-cols-3 gap-2 text-xs"><Metric label="Reference entry" text={value(candidate.entry)} /><Metric label="Protective stop" text={value(candidate.stop)} /><Metric label="2R target" text={value(candidate.target)} /></div>}
        <div className="mt-3 space-y-1 text-[11px] leading-relaxed text-white/48">{candidate.reasons.map((reason) => <p key={reason}>• {reason}</p>)}</div>
        <div className="mt-3 border-t border-white/8 pt-3 text-[11px] font-semibold text-violet-200/70">Observation only — no buying action is enabled.</div>
      </article>)}</div>}
  </section>;
}
function Metric({ label, text }: { label: string; text: string }) { return <div className="rounded-md bg-black/30 px-3 py-2"><div className="text-[9px] uppercase text-white/35">{label}</div><div className="mt-1 font-mono font-bold text-white/80">{text}</div></div>; }
