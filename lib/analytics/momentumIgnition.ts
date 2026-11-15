import type { OHLCV } from "@/lib/types";

/**
 * Momentum Ignition contracts only.
 *
 * The authoritative calculations live in
 * pipelines/strategy_math/momentum.py and are invoked through the Python
 * strategy-math batch boundary. Do not add formulas to this module.
 */
export type MomentumIgnitionStatus =
  | "EARLY_WATCH"
  | "BREAKOUT_TRIGGERED"
  | "ENTRY_READY"
  | "WAIT_FOR_PULLBACK"
  | "NOT_QUALIFIED";

export interface MomentumIgnitionGate {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface MomentumIgnitionInput {
  currentPrice: number;
  bars: OHLCV[];
  benchmarkBars: OHLCV[];
  sessionProgressFraction?: number;
  currentSessionVolume?: boolean;
  benchmarkLabel?: string;
  liquidityFloor?: number;
  liquidityRequirementLabel?: string;
  priceFloor?: number;
}

export interface MomentumIgnitionAssessment {
  modelType: "ESTABLISHED" | "NEW_LISTING";
  tradingSessions: number;
  status: MomentumIgnitionStatus;
  qualifies: boolean;
  score: number;
  gates: MomentumIgnitionGate[];
  breakoutLevel: number;
  entryTrigger: number;
  atr14: number;
  entryExtensionAtr: number;
  distanceToBreakoutPct: number;
  relativeStrength20Pct: number | null;
  relativeStrength5Pct: number | null;
  relativeStrengthAcceleration: number | null;
  compressionRatio: number;
  volumeDryUpRatio: number;
  projectedVolumeRatio: number;
  accumulationDays10: number;
  averageTradedValue20: number;
  closeLocation: number;
  marketRegimePositive: boolean;
  circuitLikeSessions20: number;
}
