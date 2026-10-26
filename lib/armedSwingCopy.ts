import type { ArmedSwingStatus } from "@/lib/analytics/armedSwing";

/** Status wording shared by the web Armed Swing page and the mobile screen. */
export const ARMED_STATUS_LABEL: Record<ArmedSwingStatus, string> = {
  BUY_ZONE: "Buy zone",
  TRIGGERED_UNCONFIRMED: "Triggered · volume unconfirmed",
  ARMED: "Armed",
  UNVERIFIED: "Execution data unverified",
  FORMING: "Base forming",
  EXTENDED: "Extended",
  RISK_OFF: "Risk off",
  INVALIDATED: "Invalidated",
};

export const ARMED_WHEN_TO_ENTER: Record<ArmedSwingStatus, string> = {
  BUY_ZONE: "Price has crossed the trigger with confirming volume pace and is still inside the limit. Enter now at or below the limit.",
  TRIGGERED_UNCONFIRMED: "Price is through the trigger but intraday volume is not yet 1.5x pace. A resting buy-stop may already have filled; hold only if volume confirms by the close.",
  ARMED: "Place a buy-stop limit order: it triggers at the trigger price and must not fill above the limit. It fills only if the breakout happens. Record it here as a pending order; it becomes a trade only when you confirm the fill.",
  UNVERIFIED: "The setup qualifies, but a fresh live quote, bid/ask depth, circuit bands or the results calendar is missing or stale. No entry until they are verified in a live session.",
  FORMING: "Not actionable yet. Watch for the failing base or leadership conditions to pass.",
  EXTENDED: "Missed: price is above the limit. Do not chase; wait for a new base.",
  RISK_OFF: "Do not enter: a hard risk or execution check failed.",
  INVALIDATED: "The base has failed: price is below the structure stop.",
};
