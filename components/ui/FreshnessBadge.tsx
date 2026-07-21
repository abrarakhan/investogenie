import { FRESHNESS_LABELS, type FreshnessStatus } from "@/lib/status";

const TONE: Record<FreshnessStatus, string> = {
  fresh: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
  stale: "border-amber-500/25 bg-amber-500/10 text-amber-300",
  failed: "border-rose-500/25 bg-rose-500/10 text-rose-300",
  unknown: "border-white/10 bg-white/5 text-white/45",
  off_hours: "border-slate-400/20 bg-slate-400/10 text-slate-300",
};

export default function FreshnessBadge({
  status,
  label,
}: {
  status: FreshnessStatus;
  label?: string | null;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${TONE[status]}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label ?? FRESHNESS_LABELS[status]}
    </span>
  );
}
