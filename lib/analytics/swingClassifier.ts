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
  | "SHORT_BREAKDOWN" // breakdown + short build-up
  | "SHORT_COILED_SPRING" // squeeze + short build-up
  | "BREAKDOWN_UNCONFIRMED" // breakdown but OI does not confirm
  | "NO_SETUP";

export type TradeDirection = "LONG" | "SHORT";

/** Direction-agnostic raw inputs from which per-user levels are derived. */
export interface SwingSetup {
  currentPrice: number;
  atr: number;
  longTrigger: number; // max(Donchian high, upper band)
  shortTrigger: number; // min(Donchian low, lower band)
  hh22: number; // 22-bar highest high (long chandelier base)
  ll22: number; // 22-bar lowest low (short chandelier base)
  dailyVelocity: number; // avg |close-to-close| over the base window
}

/** User-tunable risk parameters (defaults applied when unset). */
export interface RiskConfig {
  stopAtrMult: number;
  targetRR: number;
  trailAtrMult: number;
}

export const DEFAULT_RISK: RiskConfig = {
  stopAtrMult: 1.5,
  targetRR: 2,
  trailAtrMult: 3,
};

export interface SwingSignal {
  verdict: SwingVerdict;
  bias: TradeDirection | "NONE";
  /** Composite 0..1 conviction score for the dominant side. */
  score: number;
  asOf: string;
  close: number;
  bollinger: { upper: number; lower: number; middle: number; bandwidth: number };
  isSqueeze: boolean;
  isBreakout: boolean;
  isBreakdown: boolean;
  donchianHigh: number;
  donchianLow: number;
  priceChangePct: number; // over short window
  oiChangePct: number; // over short window
  isLongBuildup: boolean;
  isShortBuildup: boolean;
  volumeExpansion: number; // current vs base-window average
  reasons: string[];
  setup: SwingSetup;
}

/** Actionable trade levels for a direction, derived from a setup + risk config. */
export interface TradeLevels {
  direction: TradeDirection;
  currentPrice: number;
  entry: number; // breakout/breakdown trigger
  target: number; // profit target
  stopLoss: number;
  trailingStop: number; // chandelier trailing stop
  atr: number;
  riskRewardRatio: number;
  expectedDays: number; // estimated bars-to-target at recent velocity
}

function estimateDays(distance: number, velocity: number): number {
  if (velocity <= 0) return 0;
  return Math.min(60, Math.max(1, Math.round(distance / velocity)));
}

/**
 * Derive concrete trade levels for a direction from a setup + risk parameters.
 * Pure & cheap — called at read time so per-user risk settings apply instantly
 * without re-running the (global) detection scan.
 */
export function deriveLevels(
  setup: SwingSetup,
  direction: TradeDirection,
  risk: RiskConfig = DEFAULT_RISK,
): TradeLevels {
  const { atr, currentPrice, dailyVelocity } = setup;
  if (direction === "SHORT") {
    const entry = round2(setup.shortTrigger);
    const stopLoss = round2(entry + risk.stopAtrMult * atr);
    const r = stopLoss - entry;
    const target = round2(Math.max(0, entry - risk.targetRR * r));
    const trailingStop = round2(setup.ll22 + risk.trailAtrMult * atr);
    const rr = r > 0 ? round2((entry - target) / r) : 0;
    return {
      direction, currentPrice: round2(currentPrice), entry, target, stopLoss,
      trailingStop, atr: round2(atr), riskRewardRatio: rr,
      expectedDays: estimateDays(Math.abs(entry - target), dailyVelocity),
    };
  }
  const entry = round2(setup.longTrigger);
  const stopLoss = round2(Math.max(0, entry - risk.stopAtrMult * atr));
  const r = entry - stopLoss;
  const target = round2(entry + risk.targetRR * r);
  const trailingStop = round2(Math.max(0, setup.hh22 - risk.trailAtrMult * atr));
  const rr = r > 0 ? round2((target - entry) / r) : 0;
  return {
    direction, currentPrice: round2(currentPrice), entry, target, stopLoss,
    trailingStop, atr: round2(atr), riskRewardRatio: rr,
    expectedDays: estimateDays(Math.abs(target - entry), dailyVelocity),
  };
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

/** Average True Range over `period` bars (Wilder-style simple average of TR). */
function averageTrueRange(bars: OHLCV[], period: number): number {
  if (bars.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].high;
    const l = bars[i].low;
    const pc = bars[i - 1].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const slice = trs.slice(-period);
  return slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : 0;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

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
  const lows = bars.map((b) => b.low);
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

  // --- Donchian channel: prior-N highest high / lowest low ---
  const priorHighs = highs.slice(-config.donchianPeriod - 1, -1);
  const priorLows = lows.slice(-config.donchianPeriod - 1, -1);
  const donchianHigh = Math.max(...priorHighs);
  const donchianLow = Math.min(...priorLows);
  const isBreakout = last.close > donchianHigh || last.close > upper;
  const isBreakdown = last.close < donchianLow || last.close < lower;

  // --- Short-window momentum + OI build-up (both directions) ---
  const shortAgo = bars[bars.length - 1 - config.shortWindow];
  const priceChangePct = pctChange(shortAgo.close, last.close);
  const hasOi =
    typeof last.openInterest === "number" &&
    typeof shortAgo.openInterest === "number";
  const oiChangePct = hasOi
    ? pctChange(shortAgo.openInterest as number, last.openInterest as number)
    : 0;
  // Long build-up = price up + OI up; short build-up = price down + OI up.
  const isLongBuildup =
    hasOi && priceChangePct > 0 && oiChangePct >= config.minOiBuildupPct;
  const isShortBuildup =
    hasOi && priceChangePct < 0 && oiChangePct >= config.minOiBuildupPct;

  // --- Volume expansion vs base window ---
  const baseVol = mean(volumes.slice(-config.baseWindow - 1, -1));
  const volumeExpansion = baseVol === 0 ? 0 : last.volume / baseVol;
  const volumeConfirms = volumeExpansion >= config.minVolumeExpansion;

  const squeezeReason = `Bollinger bandwidth ${(bandwidth * 100).toFixed(2)}% sits in the lowest ${(config.squeezePercentile * 100).toFixed(0)}% of its history (volatility compression)`;
  const volReason = `Volume ${volumeExpansion.toFixed(2)}× the ${config.baseWindow}-bar average`;

  // --- Long-side score + verdict ---
  let longScore = 0;
  const longReasons: string[] = [];
  if (isBreakout) { longScore += 0.35; longReasons.push(`Price ${last.close.toFixed(2)} cleared Donchian high ${donchianHigh.toFixed(2)} / upper band ${upper.toFixed(2)}`); }
  if (isSqueeze) { longScore += 0.25; longReasons.push(squeezeReason); }
  if (isLongBuildup) { longScore += 0.3; longReasons.push(`Long build-up: price +${(priceChangePct * 100).toFixed(1)}% with OI +${(oiChangePct * 100).toFixed(1)}% over ${config.shortWindow} bars`); }
  if (volumeConfirms && (isBreakout || isSqueeze)) { longScore += 0.1; longReasons.push(volReason); }
  let longVerdict: SwingVerdict = "NO_SETUP";
  if (isBreakout && isLongBuildup) longVerdict = "LONG_BREAKOUT";
  else if (isSqueeze && isLongBuildup) longVerdict = "COILED_SPRING";
  else if (isBreakout) longVerdict = "BREAKOUT_UNCONFIRMED";

  // --- Short-side score + verdict ---
  let shortScore = 0;
  const shortReasons: string[] = [];
  if (isBreakdown) { shortScore += 0.35; shortReasons.push(`Price ${last.close.toFixed(2)} broke Donchian low ${donchianLow.toFixed(2)} / lower band ${lower.toFixed(2)}`); }
  if (isSqueeze) { shortScore += 0.25; shortReasons.push(squeezeReason); }
  if (isShortBuildup) { shortScore += 0.3; shortReasons.push(`Short build-up: price ${(priceChangePct * 100).toFixed(1)}% with OI +${(oiChangePct * 100).toFixed(1)}% over ${config.shortWindow} bars`); }
  if (volumeConfirms && (isBreakdown || isSqueeze)) { shortScore += 0.1; shortReasons.push(volReason); }
  let shortVerdict: SwingVerdict = "NO_SETUP";
  if (isBreakdown && isShortBuildup) shortVerdict = "SHORT_BREAKDOWN";
  else if (isSqueeze && isShortBuildup) shortVerdict = "SHORT_COILED_SPRING";
  else if (isBreakdown) shortVerdict = "BREAKDOWN_UNCONFIRMED";

  // --- Choose dominant side ---
  let bias: TradeDirection | "NONE";
  let verdict: SwingVerdict;
  let score: number;
  let reasons: string[];
  if (longVerdict === "NO_SETUP" && shortVerdict === "NO_SETUP") {
    bias = "NONE"; verdict = "NO_SETUP"; score = Math.max(longScore, shortScore);
    reasons = ["No structural trigger on the latest bar."];
  } else if (shortVerdict !== "NO_SETUP" && shortScore > longScore) {
    bias = "SHORT"; verdict = shortVerdict; score = Math.min(1, shortScore); reasons = shortReasons;
  } else {
    bias = "LONG"; verdict = longVerdict; score = Math.min(1, longScore); reasons = longReasons;
  }

  // --- Raw setup for per-user level derivation ---
  const recentCloses = closes.slice(-config.baseWindow - 1);
  let velSum = 0;
  for (let i = 1; i < recentCloses.length; i++) velSum += Math.abs(recentCloses[i] - recentCloses[i - 1]);
  const dailyVelocity = recentCloses.length > 1 ? velSum / (recentCloses.length - 1) : 0;
  const setup: SwingSetup = {
    currentPrice: last.close,
    atr: averageTrueRange(bars, 14),
    longTrigger: Math.max(donchianHigh, upper),
    shortTrigger: Math.min(donchianLow, lower),
    hh22: Math.max(...highs.slice(-22)),
    ll22: Math.min(...lows.slice(-22)),
    dailyVelocity,
  };

  return {
    verdict,
    bias,
    score,
    asOf: last.date,
    close: last.close,
    bollinger: { upper, lower, middle, bandwidth },
    isSqueeze,
    isBreakout,
    isBreakdown,
    donchianHigh,
    donchianLow,
    priceChangePct,
    oiChangePct,
    isLongBuildup,
    isShortBuildup,
    volumeExpansion,
    reasons,
    setup,
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
