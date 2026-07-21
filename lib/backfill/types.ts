export type BackfillMarket = "IN" | "US";
export type BackfillStatus = "pending" | "in_progress" | "done" | "failed" | "skipped";

export interface BackfillCandidate {
  assetId: string;
  symbol: string;
  market: BackfillMarket;
  exchange?: string | null;
  latestVolume?: number | null;
  inNifty500?: boolean;
  inSp500?: boolean;
  inNasdaq100?: boolean;
  inPortfolio?: boolean;
  inWatchlist?: boolean;
  hasActiveSignal?: boolean;
  hasOpenForwardTest?: boolean;
}

export interface BackfillQueueItem {
  id: number;
  assetId: string;
  symbol: string;
  market: BackfillMarket;
  exchange?: string | null;
  tier: number;
  attempts: number;
}

export interface PopulateBackfillSummary {
  inserted: number;
  tierCounts: Record<number, number>;
}

export interface BackfillRunSummary {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  barsLoaded: number;
  durationMs: number;
  alreadyRunning: boolean;
  message?: string;
}

export interface BackfillStartSummary {
  started: boolean;
  alreadyRunning: boolean;
  message: string;
}

export interface QueueStatusRow {
  tier: number;
  status: BackfillStatus;
  count: number;
}

export interface BackfillStatusSummary {
  rows: QueueStatusRow[];
  total: number;
  pending: number;
  inProgress: number;
  done: number;
  failed: number;
  skipped: number;
  active: Array<{
    symbol: string;
    market: BackfillMarket;
    tier: number;
    startedAt: string | null;
  }>;
  percentDone: number;
  lowestPendingTier: number | null;
  running: boolean;
  estimatedMinutesRemaining: number | null;
  lastRun: {
    createdAt: string;
    durationMs: number | null;
    status: string;
    detail: Record<string, unknown>;
    error: string | null;
  } | null;
}
