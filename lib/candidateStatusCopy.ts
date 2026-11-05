import type { StrongSwingStatus } from "@/lib/analytics/strongSwing";
import type { MomentumIgnitionStatus } from "@/lib/analytics/momentumIgnition";
import type { MomentumIgnitionCandidateStatus } from "@/lib/momentumIgnition";
import type { TrendContinuationStatus } from "@/lib/trendContinuation";

// Status wording shared by the web candidate cards and the mobile screens, so both name a
// server status the same way.

/**
 * Base Swing verdicts are discovery and ranking signals, not execution authority:
 * a cash "build-up" is five-session volume participation, not breakout-day volume
 * confirmation. Labels therefore describe the evidence and never say "buy" or
 * "confirmed"; execution readiness belongs to Strong Swing and the other engines.
 */
export const SWING_VERDICT_LABEL: Record<string, string> = {
  LONG_BREAKOUT: "Breakout + build-up",
  COILED_SPRING: "Squeeze + build-up",
  BREAKOUT_UNCONFIRMED: "Breakout, no build-up",
  SHORT_BREAKDOWN: "Breakdown + build-up",
  SHORT_COILED_SPRING: "Squeeze + distribution",
  BREAKDOWN_UNCONFIRMED: "Breakdown, no build-up",
  NO_SETUP: "No setup",
};

export const swingVerdictLabel = (verdict: string): string =>
  SWING_VERDICT_LABEL[verdict] ?? verdict.replaceAll("_", " ").toLowerCase();

/** "OI long build-up" for derivatives; five-session volume participation for cash. */
export const swingBuildupLabel = (source: "OI" | "VOLUME" | null | undefined): string =>
  source === "VOLUME" ? "Volume participation build-up" : "OI long build-up";

export const STRONG_SWING_STATUS_LABEL: Record<StrongSwingStatus, string> = {
  EXECUTION_READY: "Execution ready",
  WAIT_FOR_ENTRY: "Pullback candidate",
  WATCHLIST: "Awaiting confirmation",
  RISK_OFF: "Risk off",
  INVALIDATED: "Invalidated",
};

export const STRONG_SWING_BLOCKED_BUY_LABEL: Record<Exclude<StrongSwingStatus, "EXECUTION_READY">, string> = {
  WAIT_FOR_ENTRY: "Buy blocked: extended, do not chase",
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
