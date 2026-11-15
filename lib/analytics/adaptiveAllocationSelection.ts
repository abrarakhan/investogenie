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
