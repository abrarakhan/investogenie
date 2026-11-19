import type { MomentumIgnitionAssessment } from "@/lib/analytics/momentumIgnition";
import type { MomentumIgnitionV2Status } from "@/lib/analytics/momentumIgnitionV2";
import type { SwingSettings } from "@/lib/settings";
import { getMomentumBothCandidates } from "@/lib/momentumIgnitionBoth";

export interface MomentumIgnitionCandidate extends MomentumIgnitionAssessment {
  pythonRank?: number;
  assetId: string;
  ticker: string;
  name: string | null;
  exchange: string;
  currentPrice: number;
  quoteChangePct: number | null;
  quoteAsOf: string;
  quoteUpdatedAt: string;
  latestDate: string;
  baseScore: number;
  baseVerdict: string;
  strongStatus: string | null;
  strongCapturedAt: string | null;
  projectedEntry: number;
  projectedStop: number;
  projectedTarget: number;
  projectedTrail: number;
  projectedDays: number;
  timingStatus: MomentumIgnitionV2Status;
  executionVetoReason: string | null;
}

export interface MomentumIgnitionResult {
  market: "IN" | "US";
  universeScanned: number;
  detailedAssessments: number;
  candidates: MomentumIgnitionCandidate[];
}

/**
 * Scan the complete active market stock catalog in SQL, then send a bounded
 * near-breakout shortlist to the Python model for predictable AWS memory and
 * response time.
 */
export async function getMomentumIgnitionCandidates(
  market: "IN" | "US",
  settings: SwingSettings,
): Promise<MomentumIgnitionResult> {
  return (await getMomentumBothCandidates(market, settings)).legacy;
}
