import type { NewsSwingCandidate } from "@/lib/newsSwing";

const STATE_STYLE = {
  FAVORED: "border-emerald-400/35 bg-emerald-400/10 text-emerald-300",
  NEUTRAL: "border-white/15 bg-white/[0.04] text-white/60",
  CAUTION: "border-amber-400/35 bg-amber-400/10 text-amber-200",
  RISK_OFF: "border-rose-400/40 bg-rose-400/10 text-rose-300",
} as const;

const STATE_LABEL = {
  FAVORED: "News favored",
  NEUTRAL: "No material shift",
  CAUTION: "News caution",
  RISK_OFF: "Risk-off",
} as const;

const fmt = (value: number | null, digits = 2) => value === null ? "-" : value.toFixed(digits);
const fmtTime = (value: string) => new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata",
}).format(new Date(value));

function CandidateCard({ candidate, rank }: { candidate: NewsSwingCandidate; rank: number }) {
  const evidence = candidate.news.slice(0, 4);
  const price = candidate.lastQuote ?? candidate.close;
  return (
    <article className="rounded-lg border border-white/10 bg-white/[0.025] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-bold text-[var(--ig-accent)]">#{rank}</span>
            <h2 className="text-lg font-bold">{candidate.ticker}</h2>
            <span className="text-[10px] uppercase tracking-wider text-white/35">{candidate.exchange} · {candidate.verdict.replaceAll("_", " ")}</span>
          </div>
          <p className="mt-1 text-sm text-white/45">Current {fmt(price)} · technical signal {candidate.asOf.slice(0, 10)}</p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-wide ${STATE_STYLE[candidate.state]}`}>
          {STATE_LABEL[candidate.state]}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          ["Technical", candidate.technicalScore.toFixed(1), "text-white"],
          ["News overlay", `${candidate.newsAdjustment >= 0 ? "+" : ""}${candidate.newsAdjustment.toFixed(1)}`, candidate.newsAdjustment >= 0 ? "text-emerald-300" : "text-rose-300"],
          ["Combined", candidate.combinedScore.toFixed(1), "text-[var(--ig-accent)]"],
          ["Entry", fmt(candidate.entry), "text-white"],
          ["Stop", fmt(candidate.stopLoss), "text-rose-300"],
        ].map(([label, value, color]) => (
          <div key={label} className="rounded-md bg-black/30 px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wide text-white/35">{label}</div>
            <div className={`mt-1 font-mono text-sm ${color}`}>{value}</div>
          </div>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2 border-y border-white/8 py-3 text-[11px] sm:grid-cols-4 lg:grid-cols-8">
        <span><span className="text-white/32">Target </span><span className="font-mono text-emerald-300">{fmt(candidate.target)}</span></span>
        <span><span className="text-white/32">Trail </span><span className="font-mono text-amber-200">{fmt(candidate.trailingStop)}</span></span>
        <span><span className="text-white/32">R:R </span><span className="font-mono text-white/65">{fmt(candidate.riskReward, 1)}x</span></span>
        <span><span className="text-white/32">Horizon </span><span className="text-white/65">{candidate.expectedDays === null ? "-" : `~${candidate.expectedDays}d`}</span></span>
        <span><span className="text-white/32">P/E </span><span className="font-mono text-white/65">{fmt(candidate.peRatio, 1)}</span></span>
        <span><span className="text-white/32">ROCE </span><span className="font-mono text-white/65">{candidate.roce === null ? "-" : `${candidate.roce.toFixed(1)}%`}</span></span>
        <span><span className="text-white/32">Profit YoY </span><span className={candidate.profitVarYoY !== null && candidate.profitVarYoY < 0 ? "text-rose-300" : "text-emerald-300"}>{candidate.profitVarYoY === null ? "-" : `${candidate.profitVarYoY >= 0 ? "+" : ""}${candidate.profitVarYoY.toFixed(1)}%`}</span></span>
        <span><span className="text-white/32">Sales YoY </span><span className={candidate.salesVarYoY !== null && candidate.salesVarYoY < 0 ? "text-rose-300" : "text-emerald-300"}>{candidate.salesVarYoY === null ? "-" : `${candidate.salesVarYoY >= 0 ? "+" : ""}${candidate.salesVarYoY.toFixed(1)}%`}</span></span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-[10px] uppercase tracking-wide text-white/40">
        <span className="rounded border border-white/10 px-2 py-1">{candidate.isBreakout ? "Breakout" : candidate.isSqueeze ? "Squeeze" : "Structural setup"}</span>
        <span className="rounded border border-white/10 px-2 py-1">{candidate.isLongBuildup ? "OI long build-up" : "OI unconfirmed"}</span>
        {candidate.strategyTags.map((strategy) => <span key={strategy} className="rounded border border-white/10 px-2 py-1">{strategy.replaceAll("_", " ")}</span>)}
      </div>

      {candidate.state === "RISK_OFF" && (
        <div className="mt-4 rounded-md border border-rose-400/25 bg-rose-400/[0.06] px-3 py-2 text-xs text-rose-200">
          Severe recent negative evidence vetoes actionability. The technical setup remains visible for audit, not as a buy instruction.
        </div>
      )}

      <div className="mt-4 border-t border-white/8 pt-4">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-white/35">
          Evidence ({candidate.news.length})
        </div>
        {evidence.length ? (
          <div className="space-y-2">
            {evidence.map((item) => (
              <div key={`${item.articleId}:${item.scope}`} className="grid gap-1 rounded-md bg-black/20 px-3 py-2 sm:grid-cols-[1fr_auto] sm:gap-4">
                <div className="min-w-0">
                  <a href={item.url} target="_blank" rel="noreferrer" className="line-clamp-2 text-sm font-medium text-white/78 hover:text-[var(--ig-accent)]">
                    {item.title}
                  </a>
                  <p className="mt-1 text-[11px] leading-relaxed text-white/42">{item.rationale}</p>
                </div>
                <div className="text-[10px] text-white/35 sm:text-right">
                  <div className={item.direction === "POSITIVE" ? "text-emerald-300" : item.direction === "NEGATIVE" ? "text-rose-300" : "text-white/45"}>
                    {item.direction} · {(item.confidence * 100).toFixed(0)}% confidence
                  </div>
                  <div className="mt-1">{item.sourceName ?? "Unknown source"}</div>
                  <div>{fmtTime(item.publishedAt)}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-white/38">No material article is currently linked to this candidate. Its combined score therefore equals its technical score.</p>
        )}
      </div>
    </article>
  );
}

export default function NewsSwingCandidates({ candidates }: { candidates: NewsSwingCandidate[] }) {
  const riskOff = candidates.filter((candidate) => candidate.state === "RISK_OFF").length;
  const favored = candidates.filter((candidate) => candidate.state === "FAVORED").length;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-2 border-y border-white/10 py-4">
        {[["Candidates", candidates.length], ["News favored", favored], ["Risk-off", riskOff]].map(([label, value]) => (
          <div key={label} className="px-2">
            <div className="font-mono text-xl font-bold">{value}</div>
            <div className="mt-1 text-[10px] uppercase tracking-wider text-white/38">{label}</div>
          </div>
        ))}
      </div>
      {candidates.length > 0 && <p className="text-xs text-white/40">Ranked from highest to lowest combined technical and news conviction. Risk-off setups are shown last.</p>}
      {candidates.map((candidate, index) => <CandidateCard key={candidate.assetId} candidate={candidate} rank={index + 1} />)}
      {!candidates.length && <div className="rounded-lg border border-white/10 p-8 text-center text-sm text-white/45">No technical buy candidates are available to enrich with news.</div>}
    </div>
  );
}
