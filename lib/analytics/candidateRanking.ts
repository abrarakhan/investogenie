export interface SwingRankable {
  ticker: string;
  verdict: string;
  score: number;
  strategyLevels: Record<string, { score: number }>;
}

export function swingDisplayScore(candidate: SwingRankable, strategyKey: string | null): number {
  return strategyKey ? (candidate.strategyLevels[strategyKey]?.score ?? Number.NEGATIVE_INFINITY) : candidate.score;
}

/** Display-only ordering; signal calculations and eligibility stay unchanged. */
export function rankSwingCandidates<T extends SwingRankable>(
  candidates: readonly T[],
  strategyKey: string | null = null,
): T[] {
  return [...candidates].sort((a, b) => {
    const aNoSetup = a.verdict === "NO_SETUP" ? 1 : 0;
    const bNoSetup = b.verdict === "NO_SETUP" ? 1 : 0;
    return aNoSetup - bNoSetup
      || swingDisplayScore(b, strategyKey) - swingDisplayScore(a, strategyKey)
      || b.score - a.score
      || a.ticker.localeCompare(b.ticker);
  });
}

export interface StrongSwingRankable {
  ticker: string;
  status: "CONFIRMED" | "WATCHLIST" | "INVALIDATED";
  strengthScore: number;
  score: number;
}

export function rankStrongSwingCandidates<T extends StrongSwingRankable>(candidates: readonly T[]): T[] {
  const statusRank = { CONFIRMED: 0, WATCHLIST: 1, INVALIDATED: 2 } as const;
  return [...candidates].sort((a, b) =>
    statusRank[a.status] - statusRank[b.status]
      || b.strengthScore - a.strengthScore
      || b.score - a.score
      || a.ticker.localeCompare(b.ticker),
  );
}
