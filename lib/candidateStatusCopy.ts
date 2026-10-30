import type { StrongSwingStatus } from "@/lib/analytics/strongSwing";
import type { MomentumIgnitionStatus } from "@/lib/analytics/momentumIgnition";
import type { MomentumIgnitionCandidateStatus } from "@/lib/momentumIgnition";
import type { TrendContinuationStatus } from "@/lib/trendContinuation";

// Status wording shared by the web candidate cards and the mobile screens, so both name a
// server status the same way.

export const STRONG_SWING_STATUS_LABEL: Record<StrongSwingStatus, string> = {
  EXECUTION_READY: "Execution ready",
  WAIT_FOR_ENTRY: "Wait for entry",
  WATCHLIST: "Awaiting confirmation",
  RISK_OFF: "Risk off",
  INVALIDATED: "Invalidated",
};

export const STRONG_SWING_BLOCKED_BUY_LABEL: Record<Exclude<StrongSwingStatus, "EXECUTION_READY">, string> = {
  WAIT_FOR_ENTRY: "Buy after confirmation",
  WATCHLIST: "Buy unavailable",
  RISK_OFF: "Buy blocked: risk off",
  INVALIDATED: "Buy blocked: invalidated",
};

export const MOMENTUM_IGNITION_STATUS_LABEL: Record<MomentumIgnitionCandidateStatus, string> = {
  MOMENTUM_READY: "Momentum ready",
  EXECUTION_BLOCKED: "Execution blocked",
  FIRST_THRUST: "First thrust",
  RETEST_SETUP: "Retest setup",
  PRE_IGNITION: "Pre-ignition",
  LATE_PROFIT_BOOKING: "Late / profit-booking risk",
  FAILED_BREAKOUT: "Failed breakout",
  NOT_QUALIFIED: "Not qualified",
};

export const MOMENTUM_IGNITION_LEGACY_STATUS_LABEL: Record<MomentumIgnitionStatus, string> = {
  ENTRY_READY: "Momentum ready",
  BREAKOUT_TRIGGERED: "Breakout triggered",
  EARLY_WATCH: "Early watch",
  WAIT_FOR_PULLBACK: "Wait for pullback",
  NOT_QUALIFIED: "Not qualified",
};

export const TREND_CONTINUATION_STATUS_LABEL: Record<TrendContinuationStatus, string> = {
  IMPULSE_DETECTED: "Impulse detected",
  CONTINUATION_WATCH: "Continuation watch",
  TREND_CONTINUATION_READY: "Continuation ready",
  EXTENDED_RISK: "Extended — do not chase",
};
