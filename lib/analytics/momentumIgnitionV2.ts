import type { MomentumIgnitionAssessment } from "@/lib/analytics/momentumIgnition";

/**
 * Momentum Ignition V2 contracts only.
 *
 * The authoritative calculations live in
 * pipelines/strategy_math/momentum.py and are invoked through the Python
 * strategy-math batch boundary. Do not add formulas to this module.
 */
export type MomentumIgnitionV2Status =
  | "PRE_IGNITION"
  | "FIRST_THRUST"
  | "RETEST_SETUP"
  | "MOMENTUM_READY"
  | "LATE_PROFIT_BOOKING"
  | "FAILED_BREAKOUT"
  | "NOT_QUALIFIED";

export interface MomentumIgnitionV2Assessment extends Omit<MomentumIgnitionAssessment, "status" | "score" | "qualifies"> {
  legacyStatus: MomentumIgnitionAssessment["status"];
  status: MomentumIgnitionV2Status;
  qualifies: boolean;
  score: number;
  breakoutAgeSessions: number | null;
  episodeGainAtr: number | null;
  distanceEma10Atr: number;
  breakoutTests10: number;
  return5Pct: number;
  retreatFromHighPct: number;
  resistancePrice: number | null;
  resistanceHeadroomPct: number | null;
  ignitionAccelerationPct: number | null;
  shortHorizonTargetPct: number;
  shortHorizonDays: 1 | 2;
  timingReasons: string[];
}
