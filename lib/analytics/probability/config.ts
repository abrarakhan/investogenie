import type { ProbabilityConfig } from "./types";

export const DEFAULT_PROBABILITY_CONFIG: ProbabilityConfig = {
  horizonDays: 21,
  minBars: 280,
  maxRows: 80,
  ewmaLambda: 0.94,
  studentTdf: 5,
  drawdownThresholdPct: 10,
};
