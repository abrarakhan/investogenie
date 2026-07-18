export interface ProbabilityConfig {
  horizonDays: number;
  minBars: number;
  maxRows: number;
  ewmaLambda: number;
  studentTdf: number;
  drawdownThresholdPct: number;
}

export interface ProbabilityForecast {
  assetId: string;
  ticker: string;
  name: string;
  exchange: string;
  currency: string;
  lastPrice: number;
  bars: number;
  asOf: string;
  probabilityUpPct: number;
  expectedReturnPct: number;
  sigma21Pct: number;
  drawdownRiskPct: number;
  percentiles: { p5: number; p25: number; p50: number; p75: number; p95: number };
  priceRange: { p5: number; p25: number; p50: number; p75: number; p95: number };
  contributions: { label: string; value: number; tone: "positive" | "negative" | "neutral" }[];
  calibration: { hitRatePct: number | null; brierScore: number | null; warning: string };
}

export interface ProbabilitySummary {
  market: "US" | "IN";
  horizonDays: number;
  generatedAt: string;
  rows: ProbabilityForecast[];
  coverage: { eligible: number; forecasted: number; skippedInsufficientHistory: number };
}
