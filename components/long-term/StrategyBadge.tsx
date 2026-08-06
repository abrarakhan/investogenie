import { LONG_TERM_STRATEGY_BY_KEY, type LongTermStrategyKey } from "@/lib/analytics/longTermStrategies";

// One tone per strategy — purely cosmetic, matches this app's pill-badge
// convention (see components/ui/MatchStatusBadge.tsx / FreshnessBadge.tsx).
const TONE: Record<LongTermStrategyKey, string> = {
  LYNCH_GARP: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
  BUFFETT_MOAT: "border-amber-500/25 bg-amber-500/10 text-amber-300",
  GRAHAM_DEFENSIVE: "border-white/15 bg-white/5 text-white/70",
  FISHER_GROWTH: "border-violet-500/25 bg-violet-500/10 text-violet-300",
  TEMPLETON_CONTRARIAN: "border-sky-500/25 bg-sky-500/10 text-sky-300",
  GREENBLATT_MAGIC: "border-rose-500/25 bg-rose-500/10 text-rose-300",
};

export default function StrategyBadge({
  strategyKey,
  score,
  className,
}: {
  strategyKey: LongTermStrategyKey;
  /** 0–100 match score, shown alongside the label when provided. */
  score?: number;
  className?: string;
}) {
  const meta = LONG_TERM_STRATEGY_BY_KEY[strategyKey];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] ${TONE[strategyKey]} ${className ?? ""}`}
    >
      {meta.label}
      {score !== undefined && <span className="opacity-70">{score}%</span>}
    </span>
  );
}
