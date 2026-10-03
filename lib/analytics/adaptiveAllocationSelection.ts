export interface AdaptiveSelectionCandidate {
  id: string;
  ticker: string;
  name: string | null;
  exchange: string | null;
  sector: string | null;
  liquidityRank: number;
  prices: Array<{ date: string; close: number }>;
}

export interface AdaptivePairSelection {
  assetA: AdaptiveSelectionCandidate;
  assetB: AdaptiveSelectionCandidate;
  correlation: number;
  returnA12mPct: number;
  returnB12mPct: number;
  commonSessions: number;
  score: number;
}

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

function correlation(left: number[], right: number[]): number {
  const leftMean = mean(left);
  const rightMean = mean(right);
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < left.length; index++) {
    const leftDelta = left[index] - leftMean;
    const rightDelta = right[index] - rightMean;
    covariance += leftDelta * rightDelta;
    leftVariance += leftDelta * leftDelta;
    rightVariance += rightDelta * rightDelta;
  }
  const denominator = Math.sqrt(leftVariance * rightVariance);
  return denominator > 0 ? covariance / denominator : 1;
}

function pairStatistics(
  assetA: AdaptiveSelectionCandidate,
  assetB: AdaptiveSelectionCandidate,
): Omit<AdaptivePairSelection, "assetA" | "assetB" | "score"> | null {
  const rightByDate = new Map(assetB.prices.map((point) => [point.date, point.close]));
  const common = assetA.prices
    .map((point) => ({ date: point.date, prices: [point.close, rightByDate.get(point.date)] as const }))
    .filter((point): point is { date: string; prices: readonly [number, number] } => point.prices[1] !== undefined)
    .slice(-253);
  if (common.length < 126) return null;

  const returnsA: number[] = [];
  const returnsB: number[] = [];
  for (let index = 1; index < common.length; index++) {
    const relativeA = common[index].prices[0] / common[index - 1].prices[0];
    const relativeB = common[index].prices[1] / common[index - 1].prices[1];
    if (![relativeA, relativeB].every((value) => Number.isFinite(value) && value >= 0.6 && value <= 1.6)) return null;
    returnsA.push(Math.log(relativeA));
    returnsB.push(Math.log(relativeB));
  }
  const first = common[0].prices;
  const last = common.at(-1)!.prices;
  return {
    correlation: correlation(returnsA, returnsB),
    returnA12mPct: (last[0] / first[0] - 1) * 100,
    returnB12mPct: (last[1] / first[1] - 1) * 100,
    commonSessions: common.length,
  };
}

/**
 * Chooses a liquid, diversified pair without optimizing against the Universal
 * Portfolio backtest outcome. Lower return correlation leads; sector, trend,
 * and liquidity are bounded tie-breaks so the choice remains explainable.
 */
export function selectAdaptiveAllocationPair(
  candidates: AdaptiveSelectionCandidate[],
): AdaptivePairSelection {
  const selections: AdaptivePairSelection[] = [];
  for (let left = 0; left < candidates.length; left++) {
    for (let right = left + 1; right < candidates.length; right++) {
      const assetA = candidates[left];
      const assetB = candidates[right];
      const stats = pairStatistics(assetA, assetB);
      if (!stats) continue;
      const sameKnownSector = Boolean(assetA.sector && assetB.sector && assetA.sector === assetB.sector);
      const negativeTrendCount = Number(stats.returnA12mPct <= 0) + Number(stats.returnB12mPct <= 0);
      const liquidityPenalty = (assetA.liquidityRank + assetB.liquidityRank) / Math.max(1, candidates.length * 2);
      const score = stats.correlation
        + (sameKnownSector ? 0.3 : 0)
        + negativeTrendCount * 0.2
        + liquidityPenalty * 0.05;
      selections.push({ assetA, assetB, ...stats, score });
    }
  }
  if (!selections.length) {
    throw new Error("No eligible stock pair has at least 126 clean common sessions. Refresh market history and try again.");
  }
  return selections.sort((left, right) => left.score - right.score
    || left.assetA.ticker.localeCompare(right.assetA.ticker)
    || left.assetB.ticker.localeCompare(right.assetB.ticker))[0];
}
