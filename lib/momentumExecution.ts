import type { MomentumIgnitionStatus } from "@/lib/analytics/momentumIgnition";
import type { MomentumIgnitionV2Status } from "@/lib/analytics/momentumIgnitionV2";

export const isMomentumExecutionReady = (status: string): boolean =>
  status === "ENTRY_READY" || status === "MOMENTUM_READY";

export interface MomentumExecutionConsensus {
  status: MomentumIgnitionStatus;
  vetoReason: string | null;
}

/**
 * Legacy Momentum is the broad discovery model. V2 is the stricter timing
 * model. A legacy candidate may authorize execution only when both models
 * agree that the move is still early enough to enter.
 */
export function reconcileMomentumExecutionStatus(
  legacyStatus: MomentumIgnitionStatus,
  timingStatus: MomentumIgnitionV2Status,
): MomentumExecutionConsensus {
  if (legacyStatus !== "ENTRY_READY" || timingStatus === "MOMENTUM_READY") {
    return { status: legacyStatus, vetoReason: null };
  }

  if (timingStatus === "LATE_PROFIT_BOOKING") {
    return {
      status: "WAIT_FOR_PULLBACK",
      vetoReason: "Momentum V2 classifies this move as late or profit-booking risk. Do not chase the current price.",
    };
  }

  if (timingStatus === "FAILED_BREAKOUT") {
    return {
      status: "WAIT_FOR_PULLBACK",
      vetoReason: "Momentum V2 detects a failed breakout. A new setup must form before entry.",
    };
  }

  return {
    status: "BREAKOUT_TRIGGERED",
    vetoReason: "The broad Momentum setup triggered, but Momentum V2 has not confirmed safe entry timing.",
  };
}
