import {
  type MomentumIgnitionV2Assessment,
  type MomentumIgnitionV2Status,
} from "@/lib/analytics/momentumIgnitionV2";
import type { SwingSettings } from "@/lib/settings";
import { getMomentumBothCandidates } from "@/lib/momentumIgnitionBoth";

export type MomentumIgnitionCandidateStatus = MomentumIgnitionV2Status | "EXECUTION_BLOCKED";

export interface MomentumIgnitionCandidate extends Omit<MomentumIgnitionV2Assessment, "status"> {
  pythonRank?: number;
  status: MomentumIgnitionCandidateStatus;
  modelStatus: MomentumIgnitionV2Status;
  executionBlockReason: string | null;
  liveDataVerified: boolean;
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
}

export function momentumExecutionBlockReason(input: {
  entry: number;
  target: number;
  stop: number;
  trail: number;
}): string | null {
  if (![input.entry, input.target, input.stop, input.trail].every(Number.isFinite) || input.entry <= 0) {
    return "Execution levels are incomplete or invalid.";
  }
  if (input.stop >= input.entry) {
    return `Model stop ${input.stop.toFixed(2)} is not below live entry ${input.entry.toFixed(2)}.`;
  }
  if (input.trail >= input.entry) {
    return `Trailing reference ${input.trail.toFixed(2)} is not below live entry ${input.entry.toFixed(2)}.`;
  }
  if (input.target <= input.entry) {
    return `Model target ${input.target.toFixed(2)} is not above live entry ${input.entry.toFixed(2)}.`;
  }
  return null;
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
  return (await getMomentumBothCandidates(market, settings)).v2;
}
