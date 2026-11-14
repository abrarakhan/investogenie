export interface SwingRankable {
  ticker: string;
  verdict: string;
  score: number;
  /** Normalized breakout quality (0..1) used only to order equal scores. */
  rankScore?: number | null;
  strategyLevels: Record<string, { score: number }>;
}

export interface SwingTieBreakInput {
  isBreakout: boolean;
  close: number;
  donchianHigh: number;
  upperBand: number;
  atr: number;
  /** Latest volume vs the base-window average. */
  volumeExpansion: number;
  /** Market/asset-class relative-strength rating, 1..99 (null when unrated). */
  rsRating: number | null;
}

const clamp01 = (value: number): number => (Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0);

/**
 * Tie-break for the base Swing score, which takes only a few discrete values.
 * Equal-weighted mean of three normalized components, each in 0..1:
 * - breakout clearance: ATRs the close cleared the level it broke (Donchian
 *   high, else the upper band), saturating at 2 ATR;
 * - volume expansion: latest volume vs its base average, saturating at 3x;
 * - relative strength: the 1..99 rating scaled to 0..1.
 * It orders candidates with the same score; it never changes a score or verdict.
 */
export function swingTieBreakScore(input: SwingTieBreakInput): { rankScore: number; breakoutClearanceAtr: number } {
  const level = input.close > input.donchianHigh ? input.donchianHigh : input.upperBand;
  const breakoutClearanceAtr = input.isBreakout && input.atr > 0 ? Math.max(0, (input.close - level) / input.atr) : 0;
  const clearance = clamp01(breakoutClearanceAtr / 2);
  const volume = clamp01(input.volumeExpansion / 3);
  const strength = input.rsRating === null ? 0 : clamp01((input.rsRating - 1) / 98);
  return { rankScore: Math.round(((clearance + volume + strength) / 3) * 10000) / 10000, breakoutClearanceAtr };
}

const rankScoreOf = (candidate: { rankScore?: number | null }): number => candidate.rankScore ?? Number.NEGATIVE_INFINITY;

export function swingDisplayScore(candidate: SwingRankable, strategyKey: string | null): number {
  return strategyKey ? (candidate.strategyLevels[strategyKey]?.score ?? Number.NEGATIVE_INFINITY) : candidate.score;
}

/** Display-only ordering; signal calculations and eligibility stay unchanged. */
export function rankSwingCandidates<T extends SwingRankable>(
  candidates: readonly T[],
  strategyKey: string | null = null,
): T[] {
  return [...candidates].sort((a, b) => {
    // A strategy view ranks on that strategy's own score; the default
    // classifier's "no setup" verdict says nothing about the strategy.
    const aNoSetup = !strategyKey && a.verdict === "NO_SETUP" ? 1 : 0;
    const bNoSetup = !strategyKey && b.verdict === "NO_SETUP" ? 1 : 0;
    return aNoSetup - bNoSetup
      || swingDisplayScore(b, strategyKey) - swingDisplayScore(a, strategyKey)
      || b.score - a.score
      || rankScoreOf(b) - rankScoreOf(a)
      || a.ticker.localeCompare(b.ticker);
  });
}

export interface StrongSwingRankable {
  ticker: string;
  status: "EXECUTION_READY" | "WAIT_FOR_ENTRY" | "WATCHLIST" | "UNVERIFIED" | "RISK_OFF" | "INVALIDATED";
  strengthScore: number;
  score: number;
  rankScore?: number | null;
}

export function rankStrongSwingCandidates<T extends StrongSwingRankable>(candidates: readonly T[]): T[] {
  const statusRank = {
    EXECUTION_READY: 0,
    WAIT_FOR_ENTRY: 1,
    WATCHLIST: 2,
    // Unverifiable ranks above a real risk-off: nothing is known to be wrong with the stock.
    UNVERIFIED: 3,
    RISK_OFF: 4,
    INVALIDATED: 5,
  } as const;
  return [...candidates].sort((a, b) =>
    statusRank[a.status] - statusRank[b.status]
      || b.strengthScore - a.strengthScore
      || b.score - a.score
      || rankScoreOf(b) - rankScoreOf(a)
      || a.ticker.localeCompare(b.ticker),
  );
}
