import { MATCH_LABELS, type MatchStatus } from "@/lib/status";

const TONE: Record<MatchStatus, string> = {
  matched: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
  pending: "border-amber-500/25 bg-amber-500/10 text-amber-300",
  ambiguous: "border-sky-500/25 bg-sky-500/10 text-sky-300",
  no_snapshot: "border-white/10 bg-white/5 text-white/45",
  rejected: "border-rose-500/25 bg-rose-500/10 text-rose-300",
};

export default function MatchStatusBadge({
  status,
  label,
}: {
  status: MatchStatus;
  label?: string | null;
}) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${TONE[status]}`}>
      {label ?? MATCH_LABELS[status]}
    </span>
  );
}
