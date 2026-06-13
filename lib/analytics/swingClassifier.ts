// =============================================================================
// Derivative-Aided Swing Setup Classifier
// -----------------------------------------------------------------------------
// Flags genuine swing candidates by requiring that a *structural* trigger
// (Donchian breakout OR Bollinger-bandwidth volatility compression) is strictly
// validated by a *concurrent* Long Build-up in Open Interest — i.e. price rising
// while OI rises — over a configurable short window (e.g. 2-5 days) measured
// against a slower base window (e.g. 2-6 weeks). Volume expansion is used as a
// secondary corroborating filter.
//
// Pure, dependency-free, and deterministic so it is identically runnable in the
// browser, in a Next.js route handler, or in a worker.
// =============================================================================

import type { OHLCV } from "@/lib/types";

export interface SwingConfig {
  /** Bollinger Band lookback period (bars). */
  bbPeriod: number;
  /** Bollinger Band standard-deviation multiple. */
  bbStdDev: number;
  /** Donchian channel lookback for breakout detection (bars). */
  donchianPeriod: number;
  /** Short confirmation window in bars (e.g. 2-5 days). */
  shortWindow: number;
  /** Slower base window in bars (e.g. 10-30 days ≈ 2-6 weeks). */
  baseWindow: number;
  /** A "squeeze" requires bandwidth in the lowest `squeezePercentile` of its
   *  recent history (0..1, e.g. 0.25 = lowest quartile). */
  squeezePercentile: number;
  /** Minimum OI rate-of-change over the short window to count as a build-up. */
  minOiBuildupPct: number;
  /** Minimum volume expansion vs base-window average (e.g. 1.5 = +50%). */
  minVolumeExpansion: number;
}

export const DEFAULT_SWING_CONFIG: SwingConfig = {
  bbPeriod: 20,
  bbStdDev: 2,
  donchianPeriod: 20,
  shortWindow: 5,
  baseWindow: 20,
  squeezePercentile: 0.25,
  minOiBuildupPct: 0.05, // +5% OI over the short window
  minVolumeExpansion: 1.5,
};

export type SwingVerdict =
  | "LONG_BREAKOUT" // breakout + long build-up
  | "COILED_SPRING" // squeeze + long build-up (pre-breakout accumulation)
  | "BREAKOUT_UNCONFIRMED" // breakout but OI does not confirm
  | "NO_SETUP";

export interface SwingSignal {
  verdict: SwingVerdict;
  /** Composite 0..1 conviction score. */
  score: number;
  asOf: string;
  close: number;
  bollinger: { upper: number; lower: number; middle: number; bandwidth: number };
  isSqueeze: boolean;
  isBreakout: boolean;
  donchianHigh: number;
  priceChangePct: number; // over short window
  oiChangePct: number; // over short window
  isLongBuildup: boolean;
  volumeExpansion: number; // current vs base-window average
  reasons: string[];
}

// ---- numerical helpers ------------------------------------------------------

function mean(xs: number[]): number {
  if (xs.length === 0) return NaN;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdDev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

/** Fraction of values in `history` that are <= `value` (0..1). */
function percentRank(history: number[], value: number): number {
  if (history.length === 0) return 1;
  const below = history.filter((h) => h <= value).length;
  return below / history.length;
}

function pctChange(from: number, to: number): number {
  if (from === 0 || !Number.isFinite(from)) return 0;
  return (to - from) / Math.abs(from);
}

/** Rolling Bollinger bandwidth series: (upper - lower) / middle. */
function bandwidthSeries(closes: number[], period: number, k: number): number[] {
  const out: number[] = [];
  for (let i = period - 1; i < closes.length; i++) {
    const window = closes.slice(i - period + 1, i + 1);
    const m = mean(window);
    const sd = stdDev(window);
    const upper = m + k * sd;
    const lower = m - k * sd;
    out.push(m === 0 ? 0 : (upper - lower) / m);
  }
  return out;
}

/**
 * Classify the most recent bar of an instrument as a swing setup.
 *
 * @param bars   Chronologically ascending OHLCV bars (oldest first). For
 *               derivatives, `openInterest` must be populated to enable the
 *               Long Build-up validation; for cash equities lacking OI the
 *               classifier degrades to structure + volume only.
 * @param config Tunable thresholds; defaults target a 1-week swing horizon.
 */
export function classifySwingSetup(
  bars: OHLCV[],
  config: SwingConfig = DEFAULT_SWING_CONFIG,
): SwingSignal {
  const need = Math.max(
    config.bbPeriod,
    config.donchianPeriod,
    config.baseWindow,
  );
  if (bars.length < need + 1) {
    throw new Error(
      `classifySwingSetup needs at least ${need + 1} bars, received ${bars.length}`,
    );
  }

  const closes = bars.map((b) => b.close);
  const highs = bars.map((b) => b.high);
  const volumes = bars.map((b) => b.volume);
  const last = bars[bars.length - 1];

  // --- Bollinger Bands on the latest bar ---
  const bbWindow = closes.slice(-config.bbPeriod);
  const middle = mean(bbWindow);
  const sd = stdDev(bbWindow);
  const upper = middle + config.bbStdDev * sd;
  const lower = middle - config.bbStdDev * sd;
  const bandwidth = middle === 0 ? 0 : (upper - lower) / middle;

  // --- Squeeze: is current bandwidth historically compressed? ---
  const bwSeries = bandwidthSeries(closes, config.bbPeriod, config.bbStdDev);
  const bwHistory = bwSeries.slice(0, -1); // exclude current value from its own ranking
  const isSqueeze = percentRank(bwHistory, bandwidth) <= config.squeezePercentile;

  // --- Donchian breakout: close clears the prior-N highest high ---
  const priorHighs = highs.slice(-config.donchianPeriod - 1, -1);
  const donchianHigh = Math.max(...priorHighs);
  const isBreakout = last.close > donchianHigh || last.close > upper;

  // --- Short-window momentum + OI build-up ---
  const shortAgo = bars[bars.length - 1 - config.shortWindow];
  const priceChangePct = pctChange(shortAgo.close, last.close);

  const hasOi =
    typeof last.openInterest === "number" &&
    typeof shortAgo.openInterest === "number";
  const oiChangePct = hasOi
    ? pctChange(shortAgo.openInterest as number, last.openInterest as number)
    : 0;

  // Long Build-up = rising price AND rising OI beyond threshold (textbook
  // F&O interpretation: fresh longs being added, not short covering).
  const isLongBuildup =
    hasOi && priceChangePct > 0 && oiChangePct >= config.minOiBuildupPct;

  // --- Volume expansion vs base window ---
  const baseVol = mean(volumes.slice(-config.baseWindow - 1, -1));
  const volumeExpansion = baseVol === 0 ? 0 : last.volume / baseVol;
  const volumeConfirms = volumeExpansion >= config.minVolumeExpansion;

  // --- Scoring + verdict ---
  const reasons: string[] = [];
  let score = 0;

  if (isBreakout) {
    score += 0.35;
    reasons.push(
      `Price ${last.close.toFixed(2)} cleared Donchian high ${donchianHigh.toFixed(2)} / upper band ${upper.toFixed(2)}`,
    );
  }
  if (isSqueeze) {
    score += 0.25;
    reasons.push(
      `Bollinger bandwidth ${(bandwidth * 100).toFixed(2)}% sits in the lowest ${(config.squeezePercentile * 100).toFixed(0)}% of its history (volatility compression)`,
    );
  }
  if (isLongBuildup) {
    score += 0.3;
    reasons.push(
      `Long build-up: price +${(priceChangePct * 100).toFixed(1)}% with OI +${(oiChangePct * 100).toFixed(1)}% over ${config.shortWindow} bars`,
    );
  } else if (hasOi && priceChangePct > 0 && oiChangePct < 0) {
    reasons.push(
      `Caution: price up but OI ${(oiChangePct * 100).toFixed(1)}% — looks like short covering, not fresh longs`,
    );
  }
  if (volumeConfirms) {
    score += 0.1;
    reasons.push(
      `Volume ${volumeExpansion.toFixed(2)}× the ${config.baseWindow}-bar average`,
    );
  }
  score = Math.min(1, score);

  let verdict: SwingVerdict;
  if (isBreakout && isLongBuildup) verdict = "LONG_BREAKOUT";
  else if (isSqueeze && isLongBuildup) verdict = "COILED_SPRING";
  else if (isBreakout && !isLongBuildup) verdict = "BREAKOUT_UNCONFIRMED";
  else verdict = "NO_SETUP";

  if (reasons.length === 0) reasons.push("No structural trigger on the latest bar.");

  return {
    verdict,
    score,
    asOf: last.date,
    close: last.close,
    bollinger: { upper, lower, middle, bandwidth },
    isSqueeze,
    isBreakout,
    donchianHigh,
    priceChangePct,
    oiChangePct,
    isLongBuildup,
    volumeExpansion,
    reasons,
  };
}

/** Convenience: scan a universe and return only actionable setups, ranked. */
export function scanSwingUniverse(
  universe: { ticker: string; bars: OHLCV[] }[],
  config: SwingConfig = DEFAULT_SWING_CONFIG,
): { ticker: string; signal: SwingSignal }[] {
  return universe
    .map(({ ticker, bars }) => {
      try {
        return { ticker, signal: classifySwingSetup(bars, config) };
      } catch {
        return null;
      }
    })
    .filter((x): x is { ticker: string; signal: SwingSignal } => x !== null)
    .filter((x) => x.signal.verdict !== "NO_SETUP")
    .sort((a, b) => b.signal.score - a.signal.score);
}
