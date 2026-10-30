import type { TrendContinuationCandidate, TrendContinuationStatus } from "@/lib/trendContinuation";

const label: Record<TrendContinuationStatus, string> = {
  IMPULSE_DETECTED: "Impulse detected",
  CONTINUATION_WATCH: "Continuation watch",
  TREND_CONTINUATION_READY: "Continuation ready",
  EXTENDED_RISK: "Extended — do not chase",
};

const style: Record<TrendContinuationStatus, string> = {
  IMPULSE_DETECTED: "border-cyan-400/30 text-cyan-200",
  CONTINUATION_WATCH: "border-amber-400/30 text-amber-200",
  TREND_CONTINUATION_READY: "border-emerald-400/30 text-emerald-200",
  EXTENDED_RISK: "border-rose-400/30 text-rose-200",
};

const value = (number: unknown, suffix = "") => typeof number === "number" && Number.isFinite(number)
  ? `${number.toFixed(2)}${suffix}` : "—";

function CandidateCard({ candidate, rank }: { candidate: TrendContinuationCandidate; rank: number }) {
  const volumeRatios = Array.isArray(candidate.metrics.volume_ratios)
    ? candidate.metrics.volume_ratios.filter((item): item is number => typeof item === "number") : [];
  const averageVolume = volumeRatios.length
    ? volumeRatios.reduce((sum, item) => sum + item, 0) / volumeRatios.length : null;

  return <article className="rounded-lg border border-white/10 bg-white/[0.025] p-4 sm:p-5">
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
          {label[candidate.status]}
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
      <span className="font-semibold text-violet-200/75">Observation only — no Buy &amp; Track or auto-buy action.</span>
      <span className="text-white/30">Signal session {candidate.asOfMarketDate}</span>
    </div>
  </article>;
}

function CandidateGroup({ title, candidates, color, ranked, defaultOpen = false }: {
  title: string;
  candidates: TrendContinuationCandidate[];
  color: string;
  ranked: Map<string, number>;
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
      {candidates.map((candidate) => <CandidateCard key={candidate.assetId} candidate={candidate} rank={ranked.get(candidate.assetId) ?? 0} />)}
    </div>
  </details>;
}

export default function TrendContinuationCandidates({ candidates }: { candidates: TrendContinuationCandidate[] }) {
  const ranked = new Map(candidates.map((candidate, index) => [candidate.assetId, index + 1]));
  const ready = candidates.filter((candidate) => candidate.status === "TREND_CONTINUATION_READY");
  const watch = candidates.filter((candidate) => candidate.status === "CONTINUATION_WATCH");
  const impulse = candidates.filter((candidate) => candidate.status === "IMPULSE_DETECTED");
  const extended = candidates.filter((candidate) => candidate.status === "EXTENDED_RISK");

  return <div className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/10 pb-4">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-violet-300">Python signal engine · observation mode</div>
        <h2 className="mt-1 text-2xl font-black">Trend Continuation</h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-white/45">
          Catches a heavy-volume range breakout on day one and confirms it after the first hour of day two (10:15 IST); orderly pullbacks after an older impulse remain a second entry path.
        </p>
      </div>
      <div className="text-right text-xs text-white/40">
        <div><span className="font-mono font-bold text-white/75">{candidates.length}</span> ranked continuation signals</div>
        <div>Rescanned every 2 minutes in market hours</div>
      </div>
    </div>

    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {[
        ["Continuation ready", ready.length, "text-emerald-300"],
        ["Continuation watch", watch.length, "text-amber-200"],
        ["Impulse detected", impulse.length, "text-cyan-200"],
        ["Extended risk", extended.length, "text-rose-200"],
      ].map(([summaryLabel, count, color]) => <div key={String(summaryLabel)} className="border-b border-white/10 px-1 pb-2">
        <div className={`font-mono text-xl font-bold ${color}`}>{count}</div>
        <div className="text-[10px] uppercase tracking-wide text-white/35">{summaryLabel}</div>
      </div>)}
    </div>

    <div className="rounded-lg border border-violet-400/15 bg-violet-400/[0.035] px-4 py-3 text-xs leading-relaxed text-violet-100/65">
      Continuation ready means day two is holding a confirmed breakout (stop under the day-one low), or an orderly pullback passes the trend, persistence and entry-geometry checks. It remains observation-only: it does not create a frozen trade plan, unlock buying, or feed auto-buy.
    </div>

    {!candidates.length
      ? <div className="rounded-lg border border-white/10 px-4 py-8 text-center text-sm text-white/45">No recent multi-session impulse currently passes the Trend Continuation floor.</div>
      : <div className="space-y-3">
        <CandidateGroup title="Continuation ready · observation only" candidates={ready} ranked={ranked} color="text-emerald-300" defaultOpen />
        <CandidateGroup title="Continuation watch" candidates={watch} ranked={ranked} color="text-amber-200" />
        <CandidateGroup title="Impulse detected" candidates={impulse} ranked={ranked} color="text-cyan-200" />
        <CandidateGroup title="Extended · do not chase" candidates={extended} ranked={ranked} color="text-rose-200" />
      </div>}
  </div>;
}

function Metric({ label: metricLabel, text }: { label: string; text: string }) {
  return <div className="rounded-md bg-black/30 px-3 py-2">
    <div className="text-[9px] uppercase text-white/35">{metricLabel}</div>
    <div className="mt-1 font-mono font-bold text-white/80">{text}</div>
  </div>;
}
