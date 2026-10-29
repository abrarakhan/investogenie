// =============================================================================
// Legendary Trader Strategy Module
// -----------------------------------------------------------------------------
// Pure, deterministic, dependency-free detectors that encode the published
// trading rules of five well-known operators, evaluated against the most recent
// bar of a chronologically-ascending OHLCV series:
//
//   QULLAMAGGIE — Kristjan Qullamaggie's breakout setup (momentum continuation)
//   MINERVINI   — Mark Minervini's Trend Template + VCP contraction analysis
//   DARVAS      — Nicolas Darvas's box breakout
//   PTJ         — Paul Tudor Jones's 200-day moving-average trend rule
//   SIMONS      — Jim Simons-style statistical mean reversion (rolling z-score)
//
// Every detector degrades gracefully: when the series is too short or contains
// gaps it simply returns `matched: false` (never throws), so the host scan can
// fall back to the default swing classifier. Each match emits its author's own
// trade plan: an entry trigger, a structural stop, a trailing line and (for mean
// reversion) a target. `strategyTradeLevels()` turns that plan into levels at
// read time; the user's R:R only sets the first profit target of the trend
// strategies, whose real exit is the trailing line.
//
// Isomorphic by design (imports only types) — identical in a route handler,
// a worker, or the browser.
// =============================================================================

import type { OHLCV } from "@/lib/types";
import { deriveLevels, type RiskConfig, type SwingSetup, type TradeDirection, type TradeLevels } from "@/lib/analytics/swingClassifier";

export type StrategyKey =
  | "QULLAMAGGIE"
  | "MINERVINI"
  | "DARVAS"
  | "PTJ"
  | "SIMONS";

export interface StrategyMeta {
  key: StrategyKey;
  label: string;
  trader: string;
  blurb: string;
}

/** Display metadata — safe to import into client components (pure data). */
export const STRATEGY_META: StrategyMeta[] = [
  {
    key: "QULLAMAGGIE",
    label: "Qullamaggie Momentum",
    trader: "Kristjan Qullamaggie",
    blurb: "Breakout setup on a top-2% momentum leader with a 4%+ daily range — a 30%+ move inside three months, then a 3–40 day orderly consolidation on drying volume, surfing the 10/20 EMAs. Stop one ATR under entry; trail on the 10-day EMA.",
  },
  {
    key: "MINERVINI",
    label: "Minervini VCP",
    trader: "Mark Minervini",
    blurb: "8-point Trend Template with successively narrowing contractions on drying volume, bought within 5% of the last contraction's pivot. Stop under the final contraction low, at most 8%; trail on the 50-day.",
  },
  {
    key: "DARVAS",
    label: "Darvas Box",
    trader: "Nicolas Darvas",
    blurb: "Box breakout — a confirmed box topped by a new 52-week high; entry one tick above the box top, stop one tick under the box bottom.",
  },
  {
    key: "PTJ",
    label: "PTJ 200-Day Trend",
    trader: "Paul Tudor Jones",
    blurb: "The 200-day moving-average rule — trade only with a rising/falling 200-day trend; exit on a close through the 200-day.",
  },
  {
    key: "SIMONS",
    label: "Simons Quant Reversion",
    trader: "Jim Simons",
    blurb: "Statistical mean reversion — rolling 20-day z-score at ≥ 2.5σ extremes; target the 20-day mean, stop one σ beyond entry.",
  },
];

export const STRATEGY_KEYS: StrategyKey[] = STRATEGY_META.map((m) => m.key);

/** Per-strategy verdict on the latest bar. */
export interface StrategyResult {
  key: StrategyKey;
  matched: boolean;
  /** 0..1 conviction (1 = every sub-condition satisfied). */
  score: number;
  direction: TradeDirection;
  /** Strategy-specific entry line; null when the strategy has no custom trigger. */
  entryTrigger: number | null;
  /** The author's exit plan for a match; null when unmatched. */
  exit: StrategyExit | null;
  /** Short human-readable explanation of the decision. */
  note: string;
}

/** A strategy's own exit rules, as price levels on the latest bar. */
export interface StrategyExit {
  /** Structural stop: below a LONG entry, above a SHORT one. */
  stop: number;
  /** Fixed profit target, or null when the strategy exits on its trailing line. */
  target: number | null;
  /** The line the stop trails along once the trade moves. */
  trail: number;
}

/** Compact, serialisable score record stored as JSONB per matched strategy. */
export interface StrategyScore {
  score: number;
  dir: TradeDirection;
  entry: number | null;
  /** Exit plan; absent on records written before strategies carried their own exits. */
  stop?: number | null;
  target?: number | null;
  trail?: number | null;
}

export interface LegendaryEvaluation {
  /** Keys of every strategy that matched the latest bar. */
  tags: StrategyKey[];
  /** key -> {score, dir, entry} for matched strategies (JSONB-friendly). */
  scores: Record<string, StrategyScore>;
  /** Full per-strategy results (matched and unmatched) for debugging/UI. */
  results: StrategyResult[];
}

// ---- numeric helpers --------------------------------------------------------

const round2 = (n: number) => Math.round(n * 100) / 100;

function mean(xs: number[]): number {
  if (xs.length === 0) return NaN;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdDev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

/** Exponential moving average series (same length as input). */
function emaSeries(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    out.push(values[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

/** Simple moving average ending at (and including) index `endIdx`. */
function smaAt(values: number[], period: number, endIdx: number): number {
  const start = endIdx - period + 1;
  if (start < 0) return NaN;
  let sum = 0;
  for (let i = start; i <= endIdx; i++) sum += values[i];
  return sum / period;
}

const smaLast = (values: number[], period: number): number =>
  smaAt(values, period, values.length - 1);

const allFinite = (...xs: number[]): boolean => xs.every(Number.isFinite);

function noResult(key: StrategyKey, note: string): StrategyResult {
  return { key, matched: false, score: 0, direction: "LONG", entryTrigger: null, exit: null, note };
}

// =============================================================================
// 1. Qullamaggie — breakout setup (big prior move, then an orderly consolidation)
// =============================================================================
//
// Kristjan Qullamaggie's breakout rules: the stock has already made a large move
// (roughly 30%+ within the past one to three months), then consolidates for a few
// days to a couple of months in an orderly, shallow range while "surfing" its
// rising 10- and 20-day moving averages and volume dries up. He only trades the
// market's strongest, most volatile names — the top ~2% by 1-, 3- or 6-month
// performance, with an average daily range of roughly 4–5% or more. The entry is
// the break of the consolidation high; the stop is the low of the breakout day,
// no wider than about one daily range; the remainder is trailed on the 10-day.

const QULLA_MIN_BARS = 70;
const QULLA_POLE_BARS = 63; // the prior move must happen within ~3 months
const QULLA_MIN_MOVE = 0.3; // ≥30% from the pole low to the consolidation high
const QULLA_MIN_FLAG = 3; // consolidation length, sessions
const QULLA_MAX_FLAG = 40;
const QULLA_MAX_DEPTH = 0.2; // orderly: pullback ≤20% off the consolidation high
const QULLA_MIN_ADR = 0.04; // average daily range (high/low − 1) over 20 sessions
export const QULLA_MIN_MOMENTUM_PERCENTILE = 98; // top 2% on 1-, 3- or 6-month return

/** Average daily range: mean of high/low − 1 over the last `period` sessions. */
function averageDailyRange(bars: OHLCV[], period: number): number {
  const recent = bars.slice(-period).filter((b) => b.low > 0);
  return recent.length ? mean(recent.map((b) => b.high / b.low - 1)) : 0;
}

/** Simple mean of the last `period` true ranges. */
function atrLast(bars: OHLCV[], period: number): number {
  const ranges: number[] = [];
  for (let i = Math.max(1, bars.length - period); i < bars.length; i++) {
    const pc = bars[i - 1].close;
    ranges.push(Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - pc), Math.abs(bars[i].low - pc)));
  }
  return ranges.length ? mean(ranges) : 0;
}

/**
 * `momentumPercentile` is the stock's best 0–100 percentile on 1-, 3- and 6-month
 * return within its market (see `momentumLeaderPercentiles`); without one the
 * leadership check is skipped and the prior-move test stands alone.
 */
export function detectQullamaggie(bars: OHLCV[], momentumPercentile: number | null = null): StrategyResult {
  const KEY: StrategyKey = "QULLAMAGGIE";
  if (bars.length < QULLA_MIN_BARS) return noResult(KEY, "Insufficient history (need ~70 bars).");

  const closes = bars.map((b) => b.close);
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const vols = bars.map((b) => b.volume);
  const lastIdx = bars.length - 1;
  const close = closes[lastIdx];

  // Consolidation high: the highest high of the last QULLA_MAX_FLAG sessions. The
  // sessions after it form the consolidation.
  let highIdx = lastIdx - QULLA_MAX_FLAG;
  for (let i = highIdx; i <= lastIdx; i++) if (highs[i] > highs[highIdx]) highIdx = i;
  const flagHigh = highs[highIdx];
  const flagLen = lastIdx - highIdx;
  const consolidating = flagLen >= QULLA_MIN_FLAG;

  // Prior move: from the lowest low of the ~3 months before the high up to the high.
  const poleLow = Math.min(...lows.slice(Math.max(0, highIdx - QULLA_POLE_BARS), highIdx + 1));
  const move = poleLow > 0 ? flagHigh / poleLow - 1 : 0;
  const bigMove = move >= QULLA_MIN_MOVE;

  // Orderly, shallow consolidation.
  const flagLow = consolidating ? Math.min(...lows.slice(highIdx + 1)) : NaN;
  const depth = consolidating && flagHigh > 0 ? (flagHigh - flagLow) / flagHigh : 1;
  const orderly = depth <= QULLA_MAX_DEPTH;

  // Surfing the rising 10/20-day EMAs.
  const ema10 = emaSeries(closes, 10);
  const ema20 = emaSeries(closes, 20);
  const surfing = close > ema10[lastIdx] && close > ema20[lastIdx]
    && ema10[lastIdx] > ema20[lastIdx] && ema20[lastIdx] > ema20[lastIdx - 5];

  // Volume dries up in the consolidation versus the move into the high.
  const moveVol = mean(vols.slice(Math.max(0, highIdx - 19), highIdx + 1));
  const flagVol = consolidating ? mean(vols.slice(highIdx + 1)) : NaN;
  const volumeDryUp = Number.isFinite(flagVol) && moveVol > 0 && flagVol < moveVol;

  // Only the most volatile momentum leaders.
  const adr = averageDailyRange(bars, 20);
  const volatile = adr >= QULLA_MIN_ADR;
  const leader = momentumPercentile === null || momentumPercentile >= QULLA_MIN_MOMENTUM_PERCENTILE;

  const conditions = [bigMove, consolidating, orderly, surfing, volumeDryUp, volatile, leader];
  const score = conditions.filter(Boolean).length / conditions.length;
  const matched = conditions.every(Boolean);

  // The breakout day's low is unknown until it trades; one ATR under the entry is
  // the widest he allows, and the consolidation low is the structural floor.
  const atr = atrLast(bars, 14);
  const stop = Math.max(flagLow, flagHigh - atr);

  return {
    key: KEY,
    matched,
    score: round2(score),
    direction: "LONG",
    entryTrigger: matched ? round2(flagHigh) : null,
    exit: matched ? { stop: round2(stop), target: null, trail: round2(Math.max(stop, ema10[lastIdx])) } : null,
    note: matched
      ? `${Math.round(move * 100)}% prior move, ${flagLen}-day orderly consolidation (${Math.round(depth * 100)}% deep) on lighter volume, above the rising 10/20 EMAs, ${(adr * 100).toFixed(1)}% daily range. Entry on break of ${round2(flagHigh)}, stop ${round2(stop)}, trail the 10-day EMA.`
      : !volatile && bigMove && consolidating
        ? `Daily range ${(adr * 100).toFixed(1)}% is below the ${QULLA_MIN_ADR * 100}% Qullamaggie trades.`
        : !leader && bigMove && consolidating
          ? `Not a top-${100 - QULLA_MIN_MOMENTUM_PERCENTILE}% momentum leader (best ${Math.round(momentumPercentile ?? 0)}th percentile).`
          : "No Qullamaggie breakout setup on the latest bar.",
  };
}

// =============================================================================
// 2. Minervini — Trend Template (8 criteria) + VCP contractions
// =============================================================================

const MINERVINI_MIN_BARS = 222; // 200-SMA plus the same average one month (22 sessions) earlier
const MINERVINI_MIN_RS = 70;
const MINERVINI_MAX_FINAL_DEPTH = 0.15; // the last contraction is genuinely tight
const MINERVINI_PIVOT_BAND = 0.05; // buy within 5% of the pivot, never chase further
const MINERVINI_MAX_RISK = 0.08; // never risk more than 8% from entry

interface Contractions {
  /** Peak→trough depths, oldest first; the last may still be forming. */
  depths: number[];
  /** Index of the peak that opened the latest contraction — its high is the pivot. */
  pivotIdx: number | null;
}

/** Detect successive peak→trough contraction depths over the recent window. */
function contractions(bars: OHLCV[], window: number): Contractions {
  const n = bars.length;
  const start = Math.max(1, n - window);
  const k = 3; // swing-pivot half-width
  const depths: number[] = [];
  let openPeak: number | null = null; // index of a peak not yet answered by a trough
  let pivotIdx: number | null = null;
  for (let i = start + k; i < n - k; i++) {
    const isPeak = bars
      .slice(i - k, i + k + 1)
      .every((b) => bars[i].high >= b.high);
    const isTrough = bars
      .slice(i - k, i + k + 1)
      .every((b) => bars[i].low <= b.low);
    if (isPeak) {
      openPeak = i;
      pivotIdx = i;
    } else if (isTrough && openPeak !== null && bars[openPeak].high > 0) {
      depths.push((bars[openPeak].high - bars[i].low) / bars[openPeak].high);
      openPeak = null;
    }
  }
  // A swing point needs k sessions either side, so the contraction now in progress
  // has no confirmed trough yet. Measure it from its peak to the lowest low since.
  if (openPeak !== null && openPeak < n - 1 && bars[openPeak].high > 0) {
    const low = Math.min(...bars.slice(openPeak + 1).map((b) => b.low));
    depths.push((bars[openPeak].high - low) / bars[openPeak].high);
  }
  return { depths, pivotIdx };
}

/**
 * Minervini's eighth Trend Template criterion is a relative-strength ranking of at
 * least 70: the stock outperforms 70% of its market. `rsRating` is that 1–99
 * percentile (see `relativeStrengthRatings`); without one, a 10%+ six-month
 * return stands in.
 */
export function detectMinervini(bars: OHLCV[], rsRating: number | null = null): StrategyResult {
  const KEY: StrategyKey = "MINERVINI";
  if (bars.length < MINERVINI_MIN_BARS)
    return noResult(KEY, "Insufficient history (Trend Template needs ~222 bars).");

  const closes = bars.map((b) => b.close);
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const lastIdx = bars.length - 1;
  const close = closes[lastIdx];

  const sma50 = smaLast(closes, 50);
  const sma150 = smaLast(closes, 150);
  const sma200 = smaLast(closes, 200);
  const sma200Prior = smaAt(closes, 200, lastIdx - 22); // ~1 month ago
  if (!allFinite(sma50, sma150, sma200, sma200Prior))
    return noResult(KEY, "Moving-average stack unavailable.");

  const lookback = Math.min(252, bars.length);
  const hi52 = Math.max(...highs.slice(-lookback));
  const lo52 = Math.min(...lows.slice(-lookback));

  // Minervini's 8-point Trend Template.
  const c1 = close > sma150 && close > sma200;
  const c2 = sma150 > sma200;
  const c3 = sma200 > sma200Prior; // 200-SMA trending up ≥ 1 month
  const c4 = sma50 > sma150 && sma150 > sma200;
  const c5 = close > sma50;
  const c6 = lo52 > 0 && close >= lo52 * 1.3; // ≥30% above 52-wk low
  const c7 = hi52 > 0 && close >= hi52 * 0.75; // within 25% of 52-wk high
  const sixMoAgo = closes[Math.max(0, lastIdx - 126)];
  const c8 = rsRating !== null
    ? rsRating >= MINERVINI_MIN_RS
    : sixMoAgo > 0 && close / sixMoAgo - 1 >= 0.1;

  const template = [c1, c2, c3, c4, c5, c6, c7, c8];
  const passed = template.filter(Boolean).length;

  // VCP: the *most recent* pullbacks tighten into the pivot. We look at the last
  // few contractions (not every swing in the base) and require them to step down
  // in depth, ending in a tight final contraction — Minervini's "footprint".
  const { depths: allDepths, pivotIdx } = contractions(bars, 120);
  const recent = allDepths.slice(-4);
  let narrowing = recent.length >= 2;
  for (let i = 1; i < recent.length && narrowing; i++) {
    if (recent[i] >= recent[i - 1]) narrowing = false; // each tighter than the last
  }
  if (narrowing && recent[recent.length - 1] > MINERVINI_MAX_FINAL_DEPTH) narrowing = false;

  // The pivot is the high that opened the final contraction; the buy point is its
  // break, and a stock more than 5% either side of it is not actionable.
  const pivot = pivotIdx !== null ? highs[pivotIdx] : Math.max(...highs.slice(-10));
  const nearPivot = close >= pivot * (1 - MINERVINI_PIVOT_BAND) && close <= pivot * (1 + MINERVINI_PIVOT_BAND);

  // Supply dries up in the final contraction: volume below its 50-day average.
  const vols = bars.map((b) => b.volume);
  const finalStart = pivotIdx !== null && lastIdx - pivotIdx >= 3 ? pivotIdx + 1 : lastIdx - 4;
  const volumeDryUp = mean(vols.slice(finalStart)) < mean(vols.slice(-50));

  const templateOk = passed === 8;
  const vcp = [narrowing, nearPivot, volumeDryUp];
  const matched = templateOk && vcp.every(Boolean);
  // Score blends template completeness with the VCP confirmation.
  const score = round2((passed / 8) * 0.7 + vcp.filter(Boolean).length * 0.1);

  // Stop under the final contraction's low, but never more than 8% below the pivot.
  const finalLow = pivotIdx !== null && pivotIdx < lastIdx ? Math.min(...lows.slice(pivotIdx + 1)) : NaN;
  const stop = Number.isFinite(finalLow) && finalLow < pivot
    ? Math.max(finalLow, pivot * (1 - MINERVINI_MAX_RISK))
    : pivot * (1 - MINERVINI_MAX_RISK);

  return {
    key: KEY,
    matched,
    score,
    direction: "LONG",
    entryTrigger: matched ? round2(pivot) : null,
    exit: matched ? { stop: round2(stop), target: null, trail: round2(Math.max(stop, sma50)) } : null,
    note: matched
      ? `Trend Template 8/8 with ${recent.length} narrowing contractions on drying volume (VCP). Pivot entry ${round2(pivot)}, stop ${round2(stop)}, trail the 50-day.`
      : `Trend Template ${passed}/8${recent.length >= 2 ? `, ${recent.length} contractions` : ""}${templateOk && narrowing && !nearPivot ? `, ${Math.round((close / pivot - 1) * 100)}% from the ${round2(pivot)} pivot` : ""}${templateOk && narrowing && nearPivot && !volumeDryUp ? ", volume not drying up" : ""} — not a full VCP.`,
  };
}

// =============================================================================
// 3. Darvas Box
// =============================================================================

const DARVAS_MIN_BARS = 25;
const TICK = 0.01; // one cent / one paisa above the box top

export function detectDarvas(bars: OHLCV[]): StrategyResult {
  const KEY: StrategyKey = "DARVAS";
  if (bars.length < DARVAS_MIN_BARS) return noResult(KEY, "Insufficient history (need ~25 bars).");

  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const lastIdx = bars.length - 1;

  const window = Math.min(60, bars.length);
  const wStart = bars.length - window;

  // Box top: the highest high in the window, confirmed by ≥3 later sessions that
  // fail to exceed it (every later high is lower because it is the window high).
  let topIdx = wStart;
  for (let i = wStart; i <= lastIdx; i++) if (highs[i] > highs[topIdx]) topIdx = i;
  const boxTop = highs[topIdx];
  const topConfirmed = lastIdx - topIdx >= 3;

  // Darvas only built boxes on stocks making new highs: the box top must be the
  // 52-week high (or the high of all available history when shorter).
  const yearHigh = Math.max(...highs.slice(-Math.min(252, bars.length)));
  const newHigh = boxTop >= yearHigh;

  // Box bottom: the first low after the top that the next three sessions hold above.
  // Once set it is fixed — a later low beneath it breaks the box (Darvas's sell
  // signal), and a fresh box needs a fresh high.
  let boxBottom = NaN;
  let bottomConfirmed = false;
  let boxIntact = false;
  if (topConfirmed) {
    let runningLow = Number.POSITIVE_INFINITY;
    for (let i = topIdx + 1; i + 3 <= lastIdx; i++) {
      if (lows[i] >= runningLow) continue;
      runningLow = lows[i];
      if (lows[i + 1] >= lows[i] && lows[i + 2] >= lows[i] && lows[i + 3] >= lows[i]) {
        boxBottom = lows[i];
        bottomConfirmed = true;
        boxIntact = lows.slice(i + 4).every((low) => low >= boxBottom);
        break;
      }
    }
  }

  // No later high exceeds the top (it is the window high), so an intact box holds price.
  const conditions = [newHigh, topConfirmed, bottomConfirmed, boxIntact];
  const score = conditions.filter(Boolean).length / conditions.length;
  const matched = conditions.every(Boolean) && boxTop > boxBottom;
  const entry = round2(boxTop + TICK);

  return {
    key: KEY,
    matched,
    score: round2(score),
    direction: "LONG",
    entryTrigger: matched ? entry : null,
    // Darvas's stop sat just under the box bottom and was raised to the bottom of
    // each new box as the stock climbed.
    exit: matched ? { stop: round2(boxBottom - TICK), target: null, trail: round2(boxBottom - TICK) } : null,
    note: matched
      ? `Darvas box ${round2(boxBottom)}–${round2(boxTop)} confirmed under a new 52-week high. Buy-stop ${entry} (one tick above the box top), stop ${round2(boxBottom - TICK)} under the box bottom.`
      : newHigh && bottomConfirmed && !boxIntact
        ? `Price broke below the ${round2(boxBottom)} box bottom — the box is void until a new high.`
        : newHigh
        ? "No confirmed Darvas box on the latest bar."
        : "Box top is below the 52-week high — Darvas only trades boxes at new highs.",
  };
}

// =============================================================================
// 4. Paul Tudor Jones — 200-day moving-average trend rule
// =============================================================================

const PTJ_MIN_BARS = 205;

/** Conviction once price and the 200-day trend agree: half for the alignment itself,
 * a quarter for sitting close to the average (PTJ buys the dip, not the stretch,
 * 0 at the 15% limit), a quarter for the slope's strength (full at 2% a month). */
function ptjScore(proximity: number, slopePct: number): number {
  return 0.5 + 0.25 * Math.max(0, 1 - proximity / 0.15) + 0.25 * Math.min(1, slopePct * 50);
}

export function detectPTJ(bars: OHLCV[]): StrategyResult {
  const KEY: StrategyKey = "PTJ";
  if (bars.length < PTJ_MIN_BARS)
    return noResult(KEY, "Insufficient history (200-day rule needs ~205 bars).");

  const closes = bars.map((b) => b.close);
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const lastIdx = bars.length - 1;
  const close = closes[lastIdx];

  const sma200 = smaLast(closes, 200);
  const sma200Prior = smaAt(closes, 200, lastIdx - 22);
  if (!allFinite(sma200, sma200Prior)) return noResult(KEY, "200-day average unavailable.");

  const rising = sma200 > sma200Prior;
  const above = close > sma200;
  const below = close < sma200;
  const slopePct = sma200Prior > 0 ? Math.abs(sma200 - sma200Prior) / sma200Prior : 0;

  // Trade only in the direction of the 200-day trend. Pull-back proximity to the
  // average (PTJ's "buy the dip in an uptrend") sharpens the entry.
  let direction: TradeDirection = "LONG";
  let matched = false;
  let entry = NaN;
  let score = 0;

  if (above && rising) {
    direction = "LONG";
    const proximity = (close - sma200) / sma200; // how stretched above the mean
    const nearMean = proximity <= 0.15; // not over-extended
    matched = nearMean;
    entry = Math.max(...highs.slice(-10)); // breakout of the recent swing high
    score = ptjScore(proximity, slopePct);
  } else if (below && !rising) {
    direction = "SHORT";
    const proximity = (sma200 - close) / sma200;
    const nearMean = proximity <= 0.15;
    matched = nearMean;
    entry = Math.min(...lows.slice(-10)); // breakdown of the recent swing low
    score = ptjScore(proximity, slopePct);
  } else {
    return noResult(KEY, `Mixed regime — price ${above ? "above" : "below"} a ${rising ? "rising" : "falling"} 200-day. PTJ stands aside.`);
  }

  // "Get out of anything that falls below the 200-day": the average is the stop and,
  // as it moves, the trailing line.
  return {
    key: KEY,
    matched,
    score: round2(score),
    direction,
    entryTrigger: matched ? round2(entry) : null,
    exit: matched ? { stop: round2(sma200), target: null, trail: round2(sma200) } : null,
    note: matched
      ? `${direction} with a ${rising ? "rising" : "falling"} 200-day MA; price near the mean. Entry ${round2(entry)}, exit on a close through the 200-day (${round2(sma200)}).`
      : `Trend aligned (${direction}) but price is over-extended from the 200-day MA.`,
  };
}

// =============================================================================
// 5. Jim Simons — statistical mean reversion (rolling 20-day z-score)
// =============================================================================

const SIMONS_PERIOD = 20;
const SIMONS_Z = 2.5;

export function detectSimons(bars: OHLCV[]): StrategyResult {
  const KEY: StrategyKey = "SIMONS";
  if (bars.length < SIMONS_PERIOD + 1)
    return noResult(KEY, "Insufficient history (need ~21 bars).");

  const closes = bars.map((b) => b.close);
  const close = closes[closes.length - 1];
  const window = closes.slice(-SIMONS_PERIOD);
  const m = mean(window);
  const sd = stdDev(window);
  if (!Number.isFinite(sd) || sd === 0) return noResult(KEY, "Zero-variance window.");

  const z = (close - m) / sd;
  // Oversold (z ≤ -2.5) → revert long; overbought (z ≥ +2.5) → revert short.
  let matched = false;
  let direction: TradeDirection = "LONG";
  if (z <= -SIMONS_Z) {
    matched = true;
    direction = "LONG";
  } else if (z >= SIMONS_Z) {
    matched = true;
    direction = "SHORT";
  }

  // Conviction scales with how far past the ±2.5σ threshold the close sits.
  const score = round2(Math.min(1, Math.abs(z) / 3.5));

  // Reversion trades target the mean itself; one further σ against the entry means
  // the extreme is extending rather than reverting.
  const stop = direction === "LONG" ? close - sd : close + sd;

  return {
    key: KEY,
    matched,
    score,
    direction,
    entryTrigger: matched ? round2(close) : null,
    exit: matched ? { stop: round2(stop), target: round2(m), trail: round2(stop) } : null,
    note: matched
      ? `${SIMONS_PERIOD}-day z-score ${z.toFixed(2)}σ — statistical ${direction === "LONG" ? "oversold, revert up to" : "overbought, revert down to"} mean ${round2(m)}.`
      : `z-score ${z.toFixed(2)}σ — inside the ±${SIMONS_Z}σ band.`,
  };
}

// =============================================================================
// Relative strength rating (cross-sectional)
// =============================================================================

/** Closes 0, 63, 126, 189 and 252 sessions back (today, ~3, 6, 9, 12 months). */
export interface RsCloses {
  c0: number;
  c63: number | null;
  c126: number | null;
  c189: number | null;
  c252: number | null;
}

/**
 * IBD-style relative strength: a weighted 12-month performance (the latest quarter
 * counts double) percentile-ranked across the given universe into a 1–99 rating.
 * Assets with under three months of history get no rating; shorter histories use
 * the quarters they have, reweighted.
 */
export function relativeStrengthRatings(closes: ReadonlyMap<string, RsCloses>): Map<string, number> {
  const performance: Array<[string, number]> = [];
  for (const [id, c] of closes) {
    if (!(c.c0 > 0)) continue;
    const parts: Array<[number, number | null]> = [[0.4, c.c63], [0.2, c.c126], [0.2, c.c189], [0.2, c.c252]];
    let weighted = 0;
    let weight = 0;
    for (const [w, past] of parts) {
      if (past === null || !(past > 0)) break; // each quarter needs the shorter ones
      weighted += w * (c.c0 / past);
      weight += w;
    }
    if (weight > 0) performance.push([id, weighted / weight]);
  }
  performance.sort((a, b) => a[1] - b[1]);
  const ratings = new Map<string, number>();
  const n = performance.length;
  performance.forEach(([id], i) => {
    ratings.set(id, n === 1 ? 99 : Math.max(1, Math.round(1 + (98 * i) / (n - 1))));
  });
  return ratings;
}

/** Closes 0, 21, 63 and 126 sessions back (today, ~1, 3, 6 months). */
export interface MomentumCloses {
  c0: number;
  c21: number | null;
  c63: number | null;
  c126: number | null;
}

/**
 * Qullamaggie's leadership scan: each asset's best 0–100 percentile across its
 * 1-, 3- and 6-month returns within the given universe. A stock that is top-2% on
 * any one of the three periods scores 98 or more.
 */
export function momentumLeaderPercentiles(closes: ReadonlyMap<string, MomentumCloses>): Map<string, number> {
  const best = new Map<string, number>();
  for (const period of ["c21", "c63", "c126"] as const) {
    const returns: Array<[string, number]> = [];
    for (const [id, c] of closes) {
      const past = c[period];
      if (c.c0 > 0 && past !== null && past > 0) returns.push([id, c.c0 / past - 1]);
    }
    returns.sort((a, b) => a[1] - b[1]);
    const n = returns.length;
    returns.forEach(([id], i) => {
      const pct = n === 1 ? 100 : (100 * i) / (n - 1);
      best.set(id, Math.max(best.get(id) ?? 0, pct));
    });
  }
  return best;
}

// =============================================================================
// Trade levels
// =============================================================================

/**
 * Trade levels for one matched strategy. The entry is the strategy's trigger,
 * rebased to the live price once it has traded (as `deriveLevels` does). The stop
 * and trailing line are the strategy's own; the target is its own when it has one
 * (mean reversion), otherwise the user's R multiple of the structural risk — a
 * first scale-out level, with the trailing line carrying the rest of the trade.
 * Records without an exit plan, or whose stop the live price has already crossed,
 * fall back to the user's ATR plan.
 */
export function strategyTradeLevels(
  setup: SwingSetup,
  score: StrategyScore,
  risk: RiskConfig,
): TradeLevels {
  const dir: TradeDirection = score.dir === "SHORT" ? "SHORT" : "LONG";
  const trigger = score.entry ?? (dir === "SHORT" ? setup.shortTrigger : setup.longTrigger);
  const atrPlan = deriveLevels(
    dir === "SHORT" ? { ...setup, shortTrigger: trigger } : { ...setup, longTrigger: trigger },
    dir,
    risk,
  );
  const stop = score.stop;
  if (stop === null || stop === undefined || !Number.isFinite(stop)) return atrPlan;
  const sign = dir === "LONG" ? 1 : -1;
  const entry = atrPlan.entry;
  const r = sign * (entry - stop);
  if (!(r > 0)) return atrPlan;
  const ownTarget = score.target ?? null;
  const target = ownTarget !== null && sign * (ownTarget - entry) > 0
    ? ownTarget
    : Math.max(0, entry + sign * risk.targetRR * r);
  const trailLine = score.trail ?? stop;
  // The trail never sits looser than the stop nor beyond the entry.
  const trailingStop = dir === "LONG"
    ? Math.min(entry, Math.max(stop, trailLine))
    : Math.max(entry, Math.min(stop, trailLine));
  const distance = Math.abs(target - entry);
  const expectedDays = setup.dailyVelocity > 0
    ? Math.min(60, Math.max(1, Math.round(distance / setup.dailyVelocity)))
    : 0;
  return {
    direction: dir,
    currentPrice: atrPlan.currentPrice,
    entry,
    target: round2(target),
    stopLoss: round2(stop),
    trailingStop: round2(trailingStop),
    atr: atrPlan.atr,
    riskRewardRatio: round2(distance / r),
    expectedDays,
  };
}

// =============================================================================
// Aggregate
// =============================================================================

/**
 * Run every legendary-strategy detector against one instrument's bars and
 * collect the matches. Never throws — short or gappy series simply produce
 * fewer (or no) tags, letting the caller fall back to default indicators.
 */
export function evaluateLegendary(
  bars: OHLCV[],
  context: { rsRating?: number | null; momentumPercentile?: number | null } = {},
): LegendaryEvaluation {
  const results: StrategyResult[] = [
    detectQullamaggie(bars, context.momentumPercentile ?? null),
    detectMinervini(bars, context.rsRating ?? null),
    detectDarvas(bars),
    detectPTJ(bars),
    detectSimons(bars),
  ];

  const tags: StrategyKey[] = [];
  const scores: Record<string, StrategyScore> = {};
  for (const r of results) {
    // A plan whose stop is not beyond its entry (flat, untraded or sub-tick bars) has no
    // measurable risk and cannot be traded as written.
    const sign = r.direction === "LONG" ? 1 : -1;
    const riskless = r.exit !== null && r.entryTrigger !== null && sign * (r.entryTrigger - r.exit.stop) <= 0;
    if (r.matched && !riskless) {
      tags.push(r.key);
      scores[r.key] = {
        score: r.score, dir: r.direction, entry: r.entryTrigger,
        stop: r.exit?.stop ?? null, target: r.exit?.target ?? null, trail: r.exit?.trail ?? null,
      };
    }
  }
  return { tags, scores, results };
}
