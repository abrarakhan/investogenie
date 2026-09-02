import type { NewsSwingScore } from "./newsSwing";

export type TradeRiskState = "NORMAL" | "CAUTION" | "RISK_OFF";

export interface TradeRiskInput {
  tradeState: "ON_TRACK" | "TARGET_REACHED" | "STOP_BREACHED" | "TRAIL_BREACHED" | "WINDOW_EXPIRED" | "NO_QUOTE" | "CLOSED";
  pnlPct: number | null;
  distanceToStopPct: number | null;
  marketMove1dPct: number | null;
  marketMove2dPct: number | null;
  newsScore: NewsSwingScore;
  newsFresh: boolean;
}

export interface TradeRiskAssessment {
  state: TradeRiskState;
  reasons: string[];
  coverageWarning: string | null;
}

/**
 * Risk overlay for an already-open trade. This never changes the frozen
 * strategy projection; it only raises evidence-backed warnings around it.
 */
export function assessTradeRisk(input: TradeRiskInput): TradeRiskAssessment {
  const reasons: string[] = [];
  let state: TradeRiskState = "NORMAL";

  if (input.tradeState === "STOP_BREACHED" || input.tradeState === "TRAIL_BREACHED") {
    state = "RISK_OFF";
    reasons.push(input.tradeState === "STOP_BREACHED"
      ? "The current quote has breached the frozen stop-loss plan."
      : "The current quote has breached the effective trailing stop.");
  }
  if (input.newsScore.state === "RISK_OFF") {
    state = "RISK_OFF";
    reasons.push("A recent severe, high-confidence negative event triggered the News & AI risk-off veto.");
  } else if (input.newsScore.state === "CAUTION" && state !== "RISK_OFF") {
    state = "CAUTION";
    reasons.push(`Recent news reduced the trade score by ${Math.abs(input.newsScore.newsAdjustment).toFixed(1)} points.`);
  }

  if (input.marketMove1dPct !== null && input.marketMove1dPct <= -2.5) {
    state = "RISK_OFF";
    reasons.push(`The market benchmark is down ${Math.abs(input.marketMove1dPct).toFixed(2)}% in the current session.`);
  } else if (input.marketMove1dPct !== null && input.marketMove1dPct <= -1.5 && state === "NORMAL") {
    state = "CAUTION";
    reasons.push(`The market benchmark is down ${Math.abs(input.marketMove1dPct).toFixed(2)}% in the current session.`);
  }

  if (input.marketMove2dPct !== null && input.marketMove2dPct <= -3.5) {
    state = "RISK_OFF";
    reasons.push(`The market benchmark has fallen ${Math.abs(input.marketMove2dPct).toFixed(2)}% over two sessions.`);
  } else if (input.marketMove2dPct !== null && input.marketMove2dPct <= -2 && state === "NORMAL") {
    state = "CAUTION";
    reasons.push(`The market benchmark has fallen ${Math.abs(input.marketMove2dPct).toFixed(2)}% over two sessions.`);
  }

  if (
    input.distanceToStopPct !== null
    && input.distanceToStopPct >= 0
    && input.distanceToStopPct <= 1.5
    && state === "NORMAL"
  ) {
    state = "CAUTION";
    reasons.push(`The quote is only ${input.distanceToStopPct.toFixed(2)}% above the frozen stop.`);
  }
  if (input.pnlPct !== null && input.pnlPct <= -2 && state === "NORMAL") {
    state = "CAUTION";
    reasons.push(`The open trade is down ${Math.abs(input.pnlPct).toFixed(2)}% from its recorded buy price.`);
  }

  return {
    state,
    reasons,
    coverageWarning: input.newsFresh
      ? null
      : "Current news coverage is unavailable or stale. Configure a deployment news API key for scheduled AI reassessment.",
  };
}
