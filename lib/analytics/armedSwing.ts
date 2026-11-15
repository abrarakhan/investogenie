/** Armed Strong Swing contract. All decision mathematics lives in Python. */
import type { OHLCV } from "@/lib/types";

export const ARMED_SWING_POLICY_VERSION = "armed-v4-2026-11-14";
export type ArmedSwingStatus = "BUY_ZONE" | "TRIGGERED_UNCONFIRMED" | "ARMED" | "FORMING" | "UNVERIFIED" | "EXTENDED" | "RISK_OFF" | "INVALIDATED";
export interface ArmedSwingGate { key: string; label: string; passed: boolean; detail: string; category: "technical" | "execution"; blocking: boolean }
export interface SessionVolumeCurve { market: "IN" | "US"; version: string; sampleSessions: number; points: ReadonlyArray<readonly [number, number]> }
export interface ArmedSwingInput {
  market: "IN" | "US"; bars: OHLCV[]; benchmarkBars: OHLCV[]; currentPrice: number; rsPercentile: number | null;
  liveSession?: { volume: number; progress: number } | null; volumeCurve?: SessionVolumeCurve | null; expectedSessionLag?: number | null;
  execution?: { quoteFresh: boolean; quoteAgeMinutes: number | null; bestBid: number | null; bestAsk: number | null; lowerCircuit: number | null; upperCircuit: number | null } | null;
  results?: { verified: boolean; sessionsToNext: number | null; nextDate: string | null; detail: string } | null;
  resultsEvidence?: { today: string; lastSuccessAt: string | null; nextDate: string | null; lastPastDate: string | null; authoritativeSource: string | null; authoritativeAsOf: string | null; authoritativeCoverageFrom: string | null; authoritativeCoverageThrough: string | null; requiredCoverageFrom: string | null; requiredCoverageThrough: string | null; blackoutSessionDates: string[] } | null;
  risk: { targetRR: number; trailAtrMult: number };
}
export interface ArmedSwingPlan { pivot: number; trigger: number; limit: number; stop: number; target: number; trail: number; expectedDays: number; riskPerSharePct: number; rewardRiskRatio: number }
export interface ArmedSwingAssessment {
  policyVersion: string; status: ArmedSwingStatus; strengthScore: number; gates: ArmedSwingGate[]; plan: ArmedSwingPlan;
  latestClose: number; latestDate: string; atr: number; atrPct: number; distanceToTriggerPct: number; distanceToTriggerAtr: number;
  baseDepthPct: number; contractionRatio: number; pivotAgeSessions: number; bandwidthPercentile: number; volumeDryUp: number;
  volumePace: number | null; rsPercentile: number | null; rsLineNearHigh: boolean; averageTradedValue20: number;
  sma50: number | null; sma150: number | null; sma200: number | null; high52: number; low52: number;
  marketRegimePositive: boolean; suggestedExposurePct: number; circuitLikeSessions20: number; resultsCalendarVerified?: boolean;
}

/** Only input preparation uses these; Python remains the sole decision engine. */
export const ARMED_SWING_INPUT_POLICY = { maxQuoteAgeMinutes: 5, resultsBlackoutSessions: 3 } as const;
