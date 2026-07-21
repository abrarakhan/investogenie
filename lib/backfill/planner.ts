import { classifyBackfillTier } from "./classifier";
import type { BackfillCandidate, BackfillStatus } from "./types";

export interface PlannedQueueRow {
  assetId: string;
  symbol: string;
  market: "IN" | "US";
  tier: number;
}

export function planQueueRows(candidates: BackfillCandidate[]): PlannedQueueRow[] {
  return candidates.map((candidate) => ({
    assetId: candidate.assetId,
    symbol: candidate.symbol,
    market: candidate.market,
    tier: classifyBackfillTier(candidate),
  }));
}

export function filterNewQueueRows(rows: PlannedQueueRow[], existingAssetIds: Set<string>): PlannedQueueRow[] {
  const seen = new Set(existingAssetIds);
  const out: PlannedQueueRow[] = [];
  for (const row of rows) {
    if (seen.has(row.assetId)) continue;
    seen.add(row.assetId);
    out.push(row);
  }
  return out;
}

export function statusAfterFailure(currentAttempts: number, maxAttempts: number): BackfillStatus {
  return currentAttempts + 1 >= maxAttempts ? "failed" : "pending";
}

export function shouldContinueBatch(processed: number, batchSize: number): boolean {
  return processed < Math.max(0, batchSize);
}
