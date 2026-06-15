// =============================================================================
// Legendary Trader Strategy Module
// -----------------------------------------------------------------------------
// Pure, deterministic, dependency-free detectors that encode the published
// trading rules of five well-known operators, evaluated against the most recent
// bar of a chronologically-ascending OHLCV series:
//
//   QULLAMAGGIE — Kristjan Qullamaggie's High Tight Flag (momentum continuation)
//   MINERVINI   — Mark Minervini's Trend Template + VCP contraction analysis
//   DARVAS      — Nicolas Darvas's box breakout
//   PTJ         — Paul Tudor Jones's 200-day moving-average trend rule
//   SIMONS      — Jim Simons-style statistical mean reversion (rolling z-score)
//
// Every detector degrades gracefully: when the series is too short or contains
// gaps it simply returns `matched: false` (never throws), so the host scan can
// fall back to the default swing classifier. Each match emits a custom entry
// "trigger" price that downstream code can feed into `deriveLevels()` so the
// per-user read-time risk parameters (stop ×ATR, R:R, trail ×ATR) apply on top
// of the strategy's own entry line.
//
// Isomorphic by design (imports only types) — identical in a route handler,
// a worker, or the browser.
// =============================================================================

import type { OHLCV } from "@/lib/types";
import type { TradeDirection } from "@/lib/analytics/swingClassifier";

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
    blurb: "High Tight Flag — volume thrust then a tight 3–15 day compression above the 10/20/50 EMAs.",
  },
  {
    key: "MINERVINI",
    label: "Minervini VCP",
    trader: "Mark Minervini",
    blurb: "8-point Trend Template with successively narrowing volatility contractions.",
  },
  {
    key: "DARVAS",
    label: "Darvas Box",
    trader: "Nicolas Darvas",
    blurb: "Box breakout — entry one tick above a confirmed box top.",
  },
  {
    key: "PTJ",
    label: "PTJ 200-Day Trend",
    trader: "Paul Tudor Jones",
    blurb: "The 200-day moving-average rule — trade only with a rising/falling 200-day trend.",
  },
  {
    key: "SIMONS",
    label: "Simons Quant Reversion",
    trader: "Jim Simons",
    blurb: "Statistical mean reversion — rolling 20-day z-score at ≥ 2.5σ extremes.",
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
  /** Short human-readable explanation of the decision. */
  note: string;
}

/** Compact, serialisable score record stored as JSONB per matched strategy. */
export interface StrategyScore {
  score: number;
  dir: TradeDirection;
  entry: number | null;
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

const emaLast = (values: number[], period: number): number => {
  const s = emaSeries(values, period);
  return s.length ? s[s.length - 1] : NaN;
};

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

/** True-range value for bar i (requires i >= 1). */
function trueRange(bars: OHLCV[], i: number): number {
  const h = bars[i].high;
  const l = bars[i].low;
  const pc = bars[i - 1].close;
  return Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
}

/** Rolling ATR series (index aligned to bars; entries before `period` are NaN). */
function atrSeries(bars: OHLCV[], period: number): number[] {
  const out: number[] = new Array(bars.length).fill(NaN);
  if (bars.length < period + 1) return out;
  const trs: number[] = [0];
  for (let i = 1; i < bars.length; i++) trs.push(trueRange(bars, i));
  for (let i = period; i < bars.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += trs[j];
    out[i] = sum / period;
  }
  return out;
}

const atrLast = (bars: OHLCV[], period: number): number => {
  const s = atrSeries(bars, period);
  return s.length ? s[s.length - 1] : NaN;
};

const allFinite = (...xs: number[]): boolean => xs.every(Number.isFinite);

function noResult(key: StrategyKey, note: string): StrategyResult {
  return { key, matched: false, score: 0, direction: "LONG", entryTrigger: null, note };
}

// =============================================================================
// 1. Qullamaggie — High Tight Flag
// =============================================================================

const QULLA_MIN_BARS = 55;

export function detectQullamaggie(bars: OHLCV[]): StrategyResult {
  const KEY: StrategyKey = "QULLAMAGGIE";
  if (bars.length < QULLA_MIN_BARS) return noResult(KEY, "Insufficient history (need ~55 bars).");

  const closes = bars.map((b) => b.close);
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const vols = bars.map((b) => b.volume);
  const lastIdx = bars.length - 1;
  const last = bars[lastIdx];

  const ema10 = emaLast(closes, 10);
  const ema20 = emaLast(closes, 20);
  const ema50 = emaLast(closes, 50);
  if (!allFinite(ema10, ema20, ema50)) return noResult(KEY, "EMA stack unavailable.");

  const aboveStack = last.close > ema10 && last.close > ema20 && last.close > ema50;

  // Volume thrust ("flagpole"): a bar 3..15 sessions back trading ≥3× its
  // trailing-50 average volume.
  let surgeIdx = -1;
  let surgeMult = 0;
  for (let i = lastIdx - 3; i >= lastIdx - 15 && i >= 50; i--) {
    const avg = mean(vols.slice(i - 50, i));
    if (avg > 0 && vols[i] / avg >= 3) {
      surgeIdx = i;
      surgeMult = vols[i] / avg;
      break;
    }
  }
  const hasThrust = surgeIdx > 0;

  // Flag = the consolidation since the thrust; length must be 3..15 sessions.
  const flagLen = hasThrust ? lastIdx - surgeIdx : 0;
  const flagInRange = flagLen >= 3 && flagLen <= 15;

  // Tight channel: flag high/low spread is shallow relative to price.
  let tight = false;
  let flagHigh = NaN;
  if (flagInRange) {
    const fh = highs.slice(surgeIdx + 1);
    const fl = lows.slice(surgeIdx + 1);
    flagHigh = Math.max(...fh);
    const flagLow = Math.min(...fl);
    const depth = flagHigh > 0 ? (flagHigh - flagLow) / flagHigh : 1;
    tight = depth <= 0.12; // ≤12% range while it bases
  }

  // ATR compression: current ATR sits at (or within 5% of) its 30-bar low.
  const atrS = atrSeries(bars, 14);
  const recentAtr = atrS.slice(-30).filter(Number.isFinite);
  const atrNow = atrS[lastIdx];
  const atr30Low = recentAtr.length ? Math.min(...recentAtr) : NaN;
  const compressed = Number.isFinite(atrNow) && Number.isFinite(atr30Low) && atrNow <= atr30Low * 1.05;

  const conditions = [aboveStack, hasThrust, flagInRange, tight, compressed];
  const score = conditions.filter(Boolean).length / conditions.length;
  const matched = aboveStack && hasThrust && flagInRange && tight && compressed;

  return {
    key: KEY,
    matched,
    score: round2(score),
    direction: "LONG",
    entryTrigger: matched ? round2(flagHigh) : null,
    note: matched
      ? `HTF: ${surgeMult.toFixed(1)}× volume thrust, ${flagLen}-day tight flag above EMA10/20/50, ATR at 30-day low. Entry on break of ${round2(flagHigh)}.`
      : "No high-tight-flag signature on the latest bar.",
  };
}

// =============================================================================
// 2. Minervini — Trend Template (8 criteria) + VCP contractions
// =============================================================================

const MINERVINI_MIN_BARS = 200; // needs 200-SMA + a month of slope

/** Detect successive peak→trough contraction depths over the recent window. */
function contractionDepths(bars: OHLCV[], window: number): number[] {
  const n = bars.length;
  const start = Math.max(1, n - window);
  const k = 3; // swing-pivot half-width
  const depths: number[] = [];
  let lastPeak: number | null = null;
  for (let i = start + k; i < n - k; i++) {
    const isPeak = bars
      .slice(i - k, i + k + 1)
      .every((b) => bars[i].high >= b.high);
    const isTrough = bars
      .slice(i - k, i + k + 1)
      .every((b) => bars[i].low <= b.low);
    if (isPeak) lastPeak = bars[i].high;
    else if (isTrough && lastPeak !== null && lastPeak > 0) {
      depths.push((lastPeak - bars[i].low) / lastPeak);
      lastPeak = null;
    }
  }
  return depths;
}

export function detectMinervini(bars: OHLCV[]): StrategyResult {
  const KEY: StrategyKey = "MINERVINI";
  if (bars.length < MINERVINI_MIN_BARS)
    return noResult(KEY, "Insufficient history (Trend Template needs ~200 bars).");

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
  // c8 is normally an RS-rank > 70 across the universe; absent a cross-sectional
  // RS feed we approximate with a strong 6-month absolute return as a proxy.
  const sixMoAgo = closes[Math.max(0, lastIdx - 126)];
  const c8 = sixMoAgo > 0 && close / sixMoAgo - 1 >= 0.1;

  const template = [c1, c2, c3, c4, c5, c6, c7, c8];
  const passed = template.filter(Boolean).length;

  // VCP: the *most recent* pullbacks tighten into the pivot. We look at the last
  // few contractions (not every swing in the base) and require them to step down
  // in depth, ending in a tight final contraction — Minervini's "footprint".
  const allDepths = contractionDepths(bars, 120);
  const recent = allDepths.slice(-4);
  let narrowing = recent.length >= 2;
  for (let i = 1; i < recent.length && narrowing; i++) {
    if (recent[i] >= recent[i - 1]) narrowing = false; // each tighter than the last
  }
  // Final contraction should be genuinely shallow (≤ ~15%).
  if (narrowing && recent[recent.length - 1] > 0.15) narrowing = false;

  const templateOk = passed === 8;
  const matched = templateOk && narrowing;
  // Score blends template completeness with the VCP confirmation.
  const score = round2((passed / 8) * 0.7 + (narrowing ? 0.3 : 0));

  // Pivot entry = high of the most recent (tightest) contraction.
  const pivot = Math.max(...highs.slice(-10));

  return {
    key: KEY,
    matched,
    score,
    direction: "LONG",
    entryTrigger: matched ? round2(pivot) : null,
    note: matched
      ? `Trend Template 8/8 with ${recent.length} narrowing contractions (VCP). Pivot entry ${round2(pivot)}.`
      : `Trend Template ${passed}/8${recent.length >= 2 ? `, ${recent.length} contractions` : ""} — not a full VCP.`,
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
  const close = bars[lastIdx].close;

  const window = Math.min(60, bars.length);
  const wStart = bars.length - window;

  // Box top: the highest high in the window, confirmed by ≥3 later sessions that
  // fail to exceed it.
  let topIdx = wStart;
  for (let i = wStart; i <= lastIdx; i++) if (highs[i] > highs[topIdx]) topIdx = i;
  const boxTop = highs[topIdx];
  const barsAfterTop = lastIdx - topIdx;
  const topConfirmed =
    barsAfterTop >= 3 && highs.slice(topIdx + 1).every((h) => h < boxTop);

  // Box bottom: lowest low after the top, confirmed by ≥3 sessions holding it.
  let boxBottom = NaN;
  let bottomConfirmed = false;
  if (topConfirmed) {
    const after = lows.slice(topIdx + 1);
    boxBottom = Math.min(...after);
    const bottomIdx = topIdx + 1 + after.indexOf(boxBottom);
    bottomConfirmed =
      lastIdx - bottomIdx >= 3 && lows.slice(bottomIdx + 1).every((l) => l >= boxBottom);
  }

  const boxFormed = topConfirmed && bottomConfirmed && boxTop > boxBottom;
  // Actionable when price is consolidating inside the box, coiled below the top.
  const insideBox = boxFormed && close <= boxTop && close >= boxBottom;

  const conditions = [topConfirmed, bottomConfirmed, insideBox];
  const score = conditions.filter(Boolean).length / conditions.length;
  const matched = boxFormed && insideBox;
  const entry = round2(boxTop + TICK);

  return {
    key: KEY,
    matched,
    score: round2(score),
    direction: "LONG",
    entryTrigger: matched ? entry : null,
    note: matched
      ? `Darvas box ${round2(boxBottom)}–${round2(boxTop)} confirmed. Buy-stop ${entry} (one tick above the box top).`
      : "No confirmed Darvas box on the latest bar.",
  };
}

// =============================================================================
// 4. Paul Tudor Jones — 200-day moving-average trend rule
// =============================================================================

const PTJ_MIN_BARS = 205;

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
    score = (1 + (rising ? 1 : 0) + (nearMean ? 1 : 0) + Math.min(1, slopePct * 50)) / 4;
  } else if (below && !rising) {
    direction = "SHORT";
    const proximity = (sma200 - close) / sma200;
    const nearMean = proximity <= 0.15;
    matched = nearMean;
    entry = Math.min(...lows.slice(-10)); // breakdown of the recent swing low
    score = (1 + 1 + (nearMean ? 1 : 0) + Math.min(1, slopePct * 50)) / 4;
  } else {
    return noResult(KEY, `Mixed regime — price ${above ? "above" : "below"} a ${rising ? "rising" : "falling"} 200-day. PTJ stands aside.`);
  }

  return {
    key: KEY,
    matched,
    score: round2(score),
    direction,
    entryTrigger: matched ? round2(entry) : null,
    note: matched
      ? `${direction} with a ${rising ? "rising" : "falling"} 200-day MA; price near the mean. Entry ${round2(entry)}.`
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

  return {
    key: KEY,
    matched,
    score,
    direction,
    entryTrigger: matched ? round2(close) : null,
    note: matched
      ? `${SIMONS_PERIOD}-day z-score ${z.toFixed(2)}σ — statistical ${direction === "LONG" ? "oversold, revert up to" : "overbought, revert down to"} mean ${round2(m)}.`
      : `z-score ${z.toFixed(2)}σ — inside the ±${SIMONS_Z}σ band.`,
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
export function evaluateLegendary(bars: OHLCV[]): LegendaryEvaluation {
  const results: StrategyResult[] = [
    detectQullamaggie(bars),
    detectMinervini(bars),
    detectDarvas(bars),
    detectPTJ(bars),
    detectSimons(bars),
  ];

  const tags: StrategyKey[] = [];
  const scores: Record<string, StrategyScore> = {};
  for (const r of results) {
    if (r.matched) {
      tags.push(r.key);
      scores[r.key] = { score: r.score, dir: r.direction, entry: r.entryTrigger };
    }
  }
  return { tags, scores, results };
}
