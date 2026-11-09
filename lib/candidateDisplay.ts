// Trim server-produced candidate lists to the cards a page actually renders.
// Ranking, statuses, gates and plans are unchanged: the page still computes and
// records everything server-side; only the browser payload shrinks. Counts are
// carried separately so group totals stay exact.
import { rankStrongSwingCandidates, type StrongSwingRankable } from "@/lib/analytics/candidateRanking";
import type { StrongSwingStatus } from "@/lib/analytics/strongSwing";
import type { ArmedSwingStatus } from "@/lib/analytics/armedSwing";

/** Mirrors the groups StrongSwingCandidates renders; ready and pullback groups are shown in full. */
export const STRONG_SWING_DISPLAY_LIMITS: Partial<Record<StrongSwingStatus, number>> = {
  WATCHLIST: 30,
  RISK_OFF: 30,
  INVALIDATED: 20,
};

export type StatusCounts<S extends string> = Partial<Record<S, number>>;

export function trimStrongSwingForDisplay<T extends StrongSwingRankable & { status: StrongSwingStatus }>(candidates: readonly T[]) {
  const ranked = rankStrongSwingCandidates(candidates);
  const counts: StatusCounts<StrongSwingStatus> = {};
  const shown: T[] = [];
  for (const candidate of ranked) {
    const seen = counts[candidate.status] ?? 0;
    counts[candidate.status] = seen + 1;
    const limit = STRONG_SWING_DISPLAY_LIMITS[candidate.status];
    if (limit === undefined || seen < limit) shown.push(candidate);
  }
  return { candidates: shown, counts };
}

/** ArmedSwingCandidates shows the strongest 30 of each status group, in result order. */
export const ARMED_SWING_DISPLAY_LIMIT = 30;

export function trimArmedSwingForDisplay<T extends { status: ArmedSwingStatus }>(candidates: readonly T[]) {
  const counts: StatusCounts<ArmedSwingStatus> = {};
  const shown: T[] = [];
  for (const candidate of candidates) {
    const seen = counts[candidate.status] ?? 0;
    counts[candidate.status] = seen + 1;
    if (seen < ARMED_SWING_DISPLAY_LIMIT) shown.push(candidate);
  }
  return { candidates: shown, counts, assessedCount: candidates.length };
}
