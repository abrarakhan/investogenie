// =============================================================================
// Cross-Asset Macro Correlator Matrix
// -----------------------------------------------------------------------------
// Computes lead/lag correlation between macro indicators (e.g. US_10Y_YIELD,
// USD_INR, BRENT_CRUDE) and sector equity groups over rolling 30/90-day windows.
// Returns, for each (indicator × sector) pair, the contemporaneous correlation,
// the best lead/lag and its coefficient, and an accumulation-zone signal when a
// macro driver *leads* a sector with strong, stable correlation.
//
// All computations are on log-returns to remove level/scale and trend bias.
// =============================================================================

export interface DatedValue {
  date: string; // ISO yyyy-mm-dd
  value: number;
}

export interface SeriesInput {
  key: string; // indicator code or sector name
  points: DatedValue[];
}

export interface MacroCorrelatorConfig {
  /** Rolling windows in trading days to evaluate (typically [30, 90]). */
  windows: number[];
  /** Maximum lead/lag in days to scan in each direction. */
  maxLag: number;
  /** |coef| at/above which a relationship is considered "strong". */
  strongThreshold: number;
}

export const DEFAULT_MACRO_CONFIG: MacroCorrelatorConfig = {
  windows: [30, 90],
  maxLag: 10,
  strongThreshold: 0.5,
};

export type MacroSignal =
  | "ACCUMULATION_ZONE" // macro leads sector positively & strongly
  | "DISTRIBUTION_ZONE" // macro leads sector negatively & strongly
  | "COINCIDENT" // strong but no meaningful lead
  | "WEAK";

export interface PairCorrelation {
  indicator: string;
  sector: string;
  /** Contemporaneous correlation per window, e.g. { "30": .., "90": .. }. */
  windowCoef: Record<string, number>;
  /** Lag (days) of peak |correlation|. Positive ⇒ indicator leads sector. */
  bestLag: number;
  bestCoef: number;
  leadDays: number; // max(bestLag, 0): how many days the macro front-runs price
  signal: MacroSignal;
  observations: number;
}

export interface MacroMatrix {
  generatedFor: { indicators: string[]; sectors: string[] };
  pairs: PairCorrelation[];
  accumulationZones: PairCorrelation[];
}

// ---- numerical core ---------------------------------------------------------

function logReturns(values: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1];
    const cur = values[i];
    out.push(prev > 0 && cur > 0 ? Math.log(cur / prev) : 0);
  }
  return out;
}

export function pearson(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += x[i];
    sy += y[i];
    sxx += x[i] * x[i];
    syy += y[i] * y[i];
    sxy += x[i] * y[i];
  }
  const cov = n * sxy - sx * sy;
  const denom = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  return denom === 0 ? 0 : cov / denom;
}

/**
 * Correlation of `a` against `b` shifted by `lag`.
 * lag > 0 ⇒ a leads b (a[t] vs b[t+lag]); lag < 0 ⇒ a lags b.
 */
function laggedCorr(a: number[], b: number[], lag: number): number {
  const x: number[] = [];
  const y: number[] = [];
  for (let t = 0; t < a.length; t++) {
    const j = t + lag;
    if (j >= 0 && j < b.length) {
      x.push(a[t]);
      y.push(b[j]);
    }
  }
  return pearson(x, y);
}

/** Align two dated series on their common dates, preserving order. */
function alignOnDates(
  a: DatedValue[],
  b: DatedValue[],
): { values: [number[], number[]]; dates: string[] } {
  const bByDate = new Map(b.map((d) => [d.date, d.value]));
  const av: number[] = [];
  const bv: number[] = [];
  const dates: string[] = [];
  for (const point of a) {
    const match = bByDate.get(point.date);
    if (match !== undefined) {
      av.push(point.value);
      bv.push(match);
      dates.push(point.date);
    }
  }
  return { values: [av, bv], dates };
}

function correlatePair(
  indicator: SeriesInput,
  sector: SeriesInput,
  config: MacroCorrelatorConfig,
): PairCorrelation {
  const { values } = alignOnDates(
    [...indicator.points].sort((p, q) => p.date.localeCompare(q.date)),
    [...sector.points].sort((p, q) => p.date.localeCompare(q.date)),
  );
  const indRet = logReturns(values[0]);
  const secRet = logReturns(values[1]);
  const observations = Math.min(indRet.length, secRet.length);

  // Contemporaneous correlation across each rolling window (most-recent slice).
  const windowCoef: Record<string, number> = {};
  for (const w of config.windows) {
    const a = indRet.slice(-w);
    const b = secRet.slice(-w);
    windowCoef[String(w)] = Number(pearson(a, b).toFixed(4));
  }

  // Lead/lag scan over the longest window for stability.
  const longest = Math.max(...config.windows);
  const a = indRet.slice(-longest);
  const b = secRet.slice(-longest);
  let bestLag = 0;
  let bestCoef = 0;
  for (let lag = -config.maxLag; lag <= config.maxLag; lag++) {
    const c = laggedCorr(a, b, lag);
    if (Math.abs(c) > Math.abs(bestCoef)) {
      bestCoef = c;
      bestLag = lag;
    }
  }
  bestCoef = Number(bestCoef.toFixed(4));

  const leadDays = Math.max(bestLag, 0);
  let signal: MacroSignal = "WEAK";
  if (Math.abs(bestCoef) >= config.strongThreshold) {
    if (bestLag > 0) signal = bestCoef > 0 ? "ACCUMULATION_ZONE" : "DISTRIBUTION_ZONE";
    else signal = "COINCIDENT";
  }

  return {
    indicator: indicator.key,
    sector: sector.key,
    windowCoef,
    bestLag,
    bestCoef,
    leadDays,
    signal,
    observations,
  };
}

/**
 * Build the full indicator × sector correlation matrix.
 *
 * @param indicators macro series (e.g. yields, FX, crude)
 * @param sectors    sector equity index/return series
 */
export function buildMacroMatrix(
  indicators: SeriesInput[],
  sectors: SeriesInput[],
  config: MacroCorrelatorConfig = DEFAULT_MACRO_CONFIG,
): MacroMatrix {
  const pairs: PairCorrelation[] = [];
  for (const ind of indicators) {
    for (const sec of sectors) {
      pairs.push(correlatePair(ind, sec, config));
    }
  }
  pairs.sort((p, q) => Math.abs(q.bestCoef) - Math.abs(p.bestCoef));

  return {
    generatedFor: {
      indicators: indicators.map((i) => i.key),
      sectors: sectors.map((s) => s.key),
    },
    pairs,
    accumulationZones: pairs.filter((p) => p.signal === "ACCUMULATION_ZONE"),
  };
}
