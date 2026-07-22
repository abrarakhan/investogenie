export const FRESHNESS_STATUSES = ["fresh", "stale", "failed", "unknown", "off_hours"] as const;
export type FreshnessStatus = (typeof FRESHNESS_STATUSES)[number];

export const MATCH_STATUSES = ["matched", "pending", "ambiguous", "no_snapshot", "rejected"] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

export const FRESHNESS_LABELS: Record<FreshnessStatus, string> = {
  fresh: "Fresh",
  stale: "Stale",
  failed: "Failed",
  unknown: "Unknown",
  off_hours: "Off-hours",
};

export const MATCH_LABELS: Record<MatchStatus, string> = {
  matched: "Matched",
  pending: "Pending",
  ambiguous: "Ambiguous",
  no_snapshot: "No Snapshot",
  rejected: "Rejected",
};
