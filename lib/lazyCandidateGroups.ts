// Collapsed candidate groups are sent to the browser only when opened.
// Which groups start collapsed mirrors each screen's component; only groups
// that can never offer Buy & Track are deferred, so every buyable card and its
// plan id still arrive with the page. Ranking, statuses and plans are unchanged.

export type LazyScreen = "strong" | "armed" | "momentum-legacy" | "momentum-v2" | "trend";

export const LAZY_STATUSES: Record<LazyScreen, ReadonlySet<string>> = {
  strong: new Set(["WAIT_FOR_ENTRY", "WATCHLIST", "RISK_OFF", "INVALIDATED"]),
  armed: new Set(["UNVERIFIED", "FORMING", "EXTENDED", "RISK_OFF", "INVALIDATED"]),
  "momentum-legacy": new Set(["BREAKOUT_TRIGGERED", "EARLY_WATCH", "WAIT_FOR_PULLBACK"]),
  "momentum-v2": new Set(["FIRST_THRUST", "PRE_IGNITION", "RETEST_SETUP", "LATE_PROFIT_BOOKING", "FAILED_BREAKOUT"]),
  trend: new Set(["CONTINUATION_WATCH", "IMPULSE_DETECTED", "EXTENDED_RISK"]),
};

export interface LazySplit<T> {
  /** Cards in groups that open by default. */
  shown: T[];
  /** Exact per-status totals across the whole list. */
  counts: Record<string, number>;
  /** 1-based position in the full list, for every shown card. */
  ranks: Record<string, number>;
}

export function splitForLazyDisplay<T extends { status: string; assetId: string }>(
  items: readonly T[],
  screen: LazyScreen,
  options: { lazy?: boolean } = {},
): LazySplit<T> {
  const lazy = options.lazy === false ? new Set<string>() : LAZY_STATUSES[screen];
  const counts: Record<string, number> = {};
  const ranks: Record<string, number> = {};
  const shown: T[] = [];
  items.forEach((item, index) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    if (!lazy.has(item.status)) {
      shown.push(item);
      ranks[item.assetId] = index + 1;
    }
  });
  return { shown, counts, ranks };
}

/** One collapsed group's cards, with their 1-based positions in the full list. */
export function pickLazyGroup<T extends { status: string; assetId: string }>(items: readonly T[], status: string) {
  const ranks: Record<string, number> = {};
  const picked: T[] = [];
  items.forEach((item, index) => {
    if (item.status !== status) return;
    picked.push(item);
    ranks[item.assetId] = index + 1;
  });
  return { items: picked, ranks };
}
