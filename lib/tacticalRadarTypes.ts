import type { MarketId } from "@/lib/types";

export type TacticalBucketKey = "NEAR_TRIGGER" | "MID_TREND_PULLBACK" | "OVERSOLD_SNAPBACK";
export type TacticalRiskTier = "MODERATE" | "HIGHER_MEAN_REVERSION";
export type TacticalMarketRegime = "TREND_BREAKOUT" | "CHOPPY_ROTATION" | "SNAPBACK_REVERSAL" | "DEFENSIVE";

export interface TacticalMarketContext {
  regime: TacticalMarketRegime;
  regimeLabel: string;
  summary: string;
  favoredBucket: TacticalBucketKey;
  benchmarkTicker: string;
  benchmarkPrice: number | null;
  benchmarkChangePct: number | null;
  benchmarkAboveSma50: boolean | null;
  advancers: number;
  decliners: number;
  breadthPct: number | null;
  asOfDate: string | null;
}

export interface TacticalCandidate {
  assetId: string;
  ticker: string;
  name: string;
  exchange: string;
  sector: string | null;
  bucket: TacticalBucketKey;
  riskTier: TacticalRiskTier;
  score: number;
  price: number;
  changePct: number | null;
  referenceEntry: number;
  invalidationStop: number;
  targetZone: number;
  riskPct: number;
  rsi14: number | null;
  atrPct: number | null;
  volumeRatio: number | null;
  return5d: number | null;
  return20d: number | null;
  distanceSma20Pct: number | null;
  distanceSma200Pct: number | null;
  engines: string[];
  confluenceCount: number;
  reason: string;
  newsNote: string | null;
  asOfDate: string | null;
}

export interface TacticalRadarResult {
  market: MarketId;
  generatedAt: string;
  context: TacticalMarketContext;
  buckets: Record<TacticalBucketKey, TacticalCandidate[]>;
  excludedCounts: {
    adverseNews: number;
    resultsBlackout: number;
  };
}

export const TACTICAL_BUCKET_META: Record<
  TacticalBucketKey,
  {
    label: string;
    shortLabel: string;
    riskLabel: string;
    riskTier: TacticalRiskTier;
    description: string;
  }
> = {
  NEAR_TRIGGER: {
    label: "Near-Trigger Breakouts",
    shortLabel: "Near-Trigger",
    riskLabel: "Moderate Risk",
    riskTier: "MODERATE",
    description:
      "Strong Swing setups 1-2 timing gates away, Momentum Ignition early-watch/pre-ignition names, Trend Continuation watches, and Swing breakouts ranked by multi-engine confluence.",
  },
  MID_TREND_PULLBACK: {
    label: "Mid-Trend Pullbacks",
    shortLabel: "Pullbacks",
    riskLabel: "Moderate Risk",
    riskTier: "MODERATE",
    description:
      "Stocks trading above SMA20, SMA50, and SMA200 with constructive 20-day momentum pausing without over-extension.",
  },
  OVERSOLD_SNAPBACK: {
    label: "Oversold Snapbacks",
    shortLabel: "Snapbacks",
    riskLabel: "Higher Risk · Mean Reversion",
    riskTier: "HIGHER_MEAN_REVERSION",
    description:
      "Beaten-down stocks (RSI <= 42) holding near structural 200-day support with early stabilization. Separate from trend breakouts and sized with tighter invalidation levels.",
  },
};
