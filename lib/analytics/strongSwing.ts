/** Strong Swing contract. All decision mathematics lives in Python. */
import type { OHLCV } from "@/lib/types";

export const STRONG_SWING_MODEL_VERSION = "strong-swing-v7-entry-band";
/**
 * The actionable band above the confirmed entry, in ATR, mirrored from the Python engine's
 * ENTRY_BAND_MIN_ATR / ENTRY_BAND_MAX_ATR. These are not a second opinion about the
 * strategy: purchase validation has to admit exactly what the entry_zone gate admitted, or
 * the screen offers a plan the ledger then refuses. Changing them means changing the engine
 * and re-running pipelines/strong_swing_replay.py, not editing this line.
 */
export const STRONG_SWING_ENTRY_BAND_MIN_ATR = 0.25;
export const STRONG_SWING_ENTRY_BAND_MAX_ATR = 0.75;
export const STRONG_SWING_TRAILING_POLICY_VERSION = "strong-swing-ledger-trailing-v2-post-entry-next-bar";
export type StrongSwingStatus = "EXECUTION_READY" | "UNVERIFIED" | "WAIT_FOR_ENTRY" | "WATCHLIST" | "RISK_OFF" | "INVALIDATED";
export interface StrongSwingGate { key: string; label: string; passed: boolean; detail: string; category: "technical" | "execution"; blocking: boolean }
export interface StrongSwingInput {
  market: "IN" | "US"; verdict: string; bars: OHLCV[]; benchmarkBars: OHLCV[];
  isBreakout?: boolean; trigger?: number; atr?: number; trailingStop?: number | null; currentPrice?: number | null;
  stopAtrMult?: number; targetRR?: number; trailAtrMult?: number; ticker?: string; baseScore?: number; rankScore?: number | null;
  microstructure?: { bestBid: number | null; bestAsk: number | null; lowerCircuit: number | null; quoteFresh: boolean };
  requireLiveExecutionData?: boolean; breakoutBar?: "latest" | "previous" | null;
  /**
   * Today's session, when it is beyond the newest completed bar. The gates are built from
   * completed bars; this is how the open session's direction reaches them, rather than only
   * its last price.
   */
  session?: { date: string; high: number; low: number } | null;
  results?: { verified: boolean; sessionsToNext: number | null; nextDate: string | null; detail: string; source?: string | null; sourceAsOf?: string | null; coverageFrom?: string | null; coverageThrough?: string | null } | null;
}
export interface StrongSwingAssessment {
  status: StrongSwingStatus; strengthScore: number; resultsCheck: StrongSwingInput["results"]; gates: StrongSwingGate[];
  confirmationEntry: number; latestClose: number; latestDate: string; sma20: number | null; sma50: number | null; sma200: number | null;
  relativeStrength20Pct: number | null; averageTradedValue20: number; volumeRatio: number; closeLocation: number;
  triggerClearanceAtr: number; oiChange5Pct: number | null; marketRegimePositive: boolean; confirmationMode: "OI" | "CASH";
  fiveDayReturnPct: number | null; tenDayReturnPct: number | null; distanceAboveSma20Pct: number | null; atrPct: number;
  stopRiskPct: number; entryExtensionAtr: number; circuitLikeSessions20: number; suggestedExposurePct: number;
}
export interface CompletedBarStrongSwingAssessment extends StrongSwingAssessment {
  modelVersion: string; atr: number; isBreakout: boolean; breakoutBar: "latest" | "previous" | null; trailingStop: number;
  effectiveTrailingStop: number; strongEntry: number; strongStop: number; strongTarget: number; strongTrail: number;
  strongExpectedDays: number; pythonRank?: number;
}
