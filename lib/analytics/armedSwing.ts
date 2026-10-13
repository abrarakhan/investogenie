// =============================================================================
// Armed Strong Swing — pre-breakout entries
// -----------------------------------------------------------------------------
// Strong Swing buys only after a breakout has printed two confirming closes, so its earliest
// entry is roughly a session and 0.25-0.75 ATR above the pivot. Armed Swing works one stage
// earlier: it finds stage-2 leaders sitting in a tight base just under their pivot and
// publishes a buy-stop plan (trigger, limit, structure stop, target, trail, horizon) so the
// entry fills on the breakout itself. Breakout-day volume is judged by intraday pace rather
// than by waiting for the close.
//
// Pure and deterministic. Bars must be COMPLETED sessions in ascending order; the in-progress
// session is passed separately as `liveSession`. This module is independent of Strong Swing
// and does not change its gates, ranking or outputs.
// =============================================================================

import type { OHLCV } from "@/lib/types";

export type ArmedSwingStatus =
  | "BUY_ZONE" // crossed the trigger intraday with confirming volume pace, inside the limit
  | "TRIGGERED_UNCONFIRMED" // crossed the trigger, volume pace not yet confirming
  | "ARMED" // qualified base just under the pivot: place the buy-stop
  | "FORMING" // base or leadership conditions not yet met
  | "UNVERIFIED" // setup qualifies, but live execution or results-calendar data is missing/stale
  | "EXTENDED" // already above the buy-stop limit: missed, do not chase
  | "RISK_OFF" // a hard execution or risk check failed
  | "INVALIDATED"; // price broke below the base's structure stop

export interface ArmedSwingGate {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
  category: "technical" | "execution";
  blocking: boolean;
}

export interface ArmedSwingInput {
  market: "IN" | "US";
  bars: OHLCV[];
  benchmarkBars: OHLCV[];
  /** Latest price: live quote during the session, else the last close. */
  currentPrice: number;
  /** Cross-sectional relative-strength percentile (0-100) across the market universe. */
  rsPercentile: number | null;
  /** Today's partial session while the market is open. */
  liveSession?: { volume: number; progress: number } | null;
  /** Completed sessions between the latest bar and the latest session the calendar expects. */
  expectedSessionLag?: number | null;
  /**
   * Live execution data. Actionable states fail closed without it: the quote must be fresh
   * during an open session, and bid/ask depth plus both circuit bands must be present.
   */
  execution?: {
    quoteFresh: boolean;
    quoteAgeMinutes: number | null;
    bestBid: number | null;
    bestAsk: number | null;
    lowerCircuit: number | null;
    upperCircuit: number | null;
  } | null;
  /** Results calendar. `verified` is false when the asset lacks a recent, usable check. */
  results?: { verified: boolean; sessionsToNext: number | null; nextDate: string | null; detail: string } | null;
  risk: { targetRR: number; trailAtrMult: number };
}

/**
 * Decide whether the results calendar can be trusted for one asset. A recent successful check
 * is required, and it must have produced either an upcoming date or a results date within the
 * last 70 days (so the next quarterly release cannot fall inside the blackout unseen).
 */
export function resultsCalendarCoverage(input: {
  today: string;
  lastSuccessAt: string | null;
  nextDate: string | null;
  lastPastDate: string | null;
}): { verified: boolean; detail: string } {
  const day = 86_400_000;
  const todayMs = Date.parse(`${input.today}T00:00:00Z`);
  if (!input.lastSuccessAt || todayMs - Date.parse(input.lastSuccessAt) > 7 * day) {
    return { verified: false, detail: "Results calendar not checked in the last 7 days." };
  }
  if (input.nextDate) return { verified: true, detail: `Next results ${input.nextDate}.` };
  if (input.lastPastDate && todayMs - Date.parse(`${input.lastPastDate}T00:00:00Z`) <= 70 * day) {
    return { verified: true, detail: `Last results ${input.lastPastDate}; next is not due within the blackout.` };
  }
  return { verified: false, detail: "No upcoming or recent results date on file; the next release is unknown." };
}

export interface ArmedSwingPlan {
  pivot: number;
  trigger: number;
  limit: number;
  stop: number;
  target: number;
  trail: number;
  expectedDays: number;
  riskPerSharePct: number;
  rewardRiskRatio: number;
}

export interface ArmedSwingAssessment {
  status: ArmedSwingStatus;
  strengthScore: number;
  gates: ArmedSwingGate[];
  plan: ArmedSwingPlan;
  latestClose: number;
  latestDate: string;
  atr: number;
  atrPct: number;
  distanceToTriggerPct: number;
  distanceToTriggerAtr: number;
  baseDepthPct: number;
  contractionRatio: number;
  bandwidthPercentile: number;
  volumeDryUp: number;
  volumePace: number | null;
  rsPercentile: number | null;
  rsLineNearHigh: boolean;
  averageTradedValue20: number;
  sma50: number | null;
  sma150: number | null;
  sma200: number | null;
  high52: number;
  low52: number;
  marketRegimePositive: boolean;
  suggestedExposurePct: number;
  circuitLikeSessions20: number;
}

export const ARMED_SWING_RULES = {
  baseLength: 20,
  contractionHalf: 10,
  maxBaseDepthPct: 18,
  maxContractionRatio: 0.75,
  squeezePercentile: 0.25,
  triggerBufferAtr: 0.1,
  limitBufferAtr: 0.25,
  maxLimitAbovePivotPct: 3,
  stopBufferAtr: 0.1,
  /** The final, tightest contraction: the structure stop sits under its low. */
  pivotLowSessions: 5,
  /** Never closer than this to the trigger, so ordinary noise does not stop the trade out. */
  minStopDistanceAtr: 1,
  maxDistanceAtr: 1.5,
  maxDistancePct: 6,
  minRsPercentile: 80,
  maxDryUp: 0.85,
  minBreakoutPace: 1.5,
  maxAtrPct: 5,
  maxStopRiskPct: 8,
  minSessionProgress: 0.15,
  maxQuoteAgeMinutes: 5,
  maxSpreadPct: 0.75,
  minLowerCircuitRoomPct: 3,
  resultsBlackoutSessions: 3,
} as const;

const mean = (values: number[]): number =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const sma = (values: number[], period: number, end = values.length): number | null =>
  end < period ? null : mean(values.slice(end - period, end));

const pctChange = (from: number, to: number): number | null =>
  from > 0 && Number.isFinite(from) && Number.isFinite(to) ? ((to - from) / from) * 100 : null;

const tickSize = (market: "IN" | "US") => (market === "IN" ? 0.05 : 0.01);
const roundUpTick = (value: number, tick: number) => Math.ceil(value / tick - 1e-9) * tick;
const roundDownTick = (value: number, tick: number) => Math.floor(value / tick + 1e-9) * tick;
const round2 = (value: number) => Math.round(value * 100) / 100;

/** Simple mean of the last `period` true ranges, matching the swing classifier's ATR. */
export function averageTrueRange(bars: OHLCV[], period = 14): number {
  const ranges: number[] = [];
  for (let index = Math.max(1, bars.length - period); index < bars.length; index++) {
    const { high, low } = bars[index];
    const previousClose = bars[index - 1].close;
    ranges.push(Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose)));
  }
  return mean(ranges);
}

/** Percentile (0..1) of the latest Bollinger bandwidth against its own prior history. */
export function bandwidthPercentile(closes: number[], period = 20, k = 2): number {
  const widths: number[] = [];
  for (let end = period; end <= closes.length; end++) {
    const window = closes.slice(end - period, end);
    const m = mean(window);
    const sd = Math.sqrt(window.reduce((sum, value) => sum + (value - m) ** 2, 0) / Math.max(1, period - 1));
    widths.push(m > 0 ? (2 * k * sd) / m : 0);
  }
  if (widths.length < 2) return 1;
  const current = widths[widths.length - 1];
  const history = widths.slice(0, -1);
  return history.filter((value) => value <= current).length / history.length;
}

const KNOWN_CIRCUIT_BANDS = [5, 10, 20];
function isCircuitLikeSession(previous: OHLCV, current: OHLCV): boolean {
  const change = pctChange(previous.close, current.close);
  if (change === null || !KNOWN_CIRCUIT_BANDS.some((band) => Math.abs(Math.abs(change) - band) <= 0.25)) return false;
  const range = current.high - current.low;
  if (range <= 0) return true;
  const location = (current.close - current.low) / range;
  return change > 0 ? location >= 0.98 : location <= 0.02;
}

function sessionsBetween(from: string, to: string, dates: string[]): number {
  const [first, last] = from <= to ? [from, to] : [to, from];
  return new Set(dates.filter((date) => date > first && date <= last)).size;
}

function gate(
  key: string, label: string, passed: boolean, detail: string,
  category: ArmedSwingGate["category"] = "technical", blocking = true,
): ArmedSwingGate {
  return { key, label, passed, detail, category, blocking };
}

export function assessArmedSwing(input: ArmedSwingInput): ArmedSwingAssessment {
  const R = ARMED_SWING_RULES;
  const { bars, benchmarkBars, market } = input;
  if (bars.length < 60) throw new Error("Armed Swing requires at least 60 completed sessions.");

  const tick = tickSize(market);
  const latest = bars[bars.length - 1];
  const closes = bars.map((bar) => bar.close);
  const currentPrice = input.currentPrice > 0 ? input.currentPrice : latest.close;
  const atr = Math.max(averageTrueRange(bars, 14), tick);
  const atrPct = latest.close > 0 ? (atr / latest.close) * 100 : Number.POSITIVE_INFINITY;

  // --- Base structure ---------------------------------------------------------------------
  const base = bars.slice(-R.baseLength);
  const pivot = Math.max(...base.map((bar) => bar.high));
  const baseLow = Math.min(...base.map((bar) => bar.low));
  const baseDepthPct = pivot > 0 ? ((pivot - baseLow) / pivot) * 100 : 100;
  const firstHalf = base.slice(0, R.contractionHalf);
  const secondHalf = base.slice(-R.contractionHalf);
  const rangeOf = (slice: OHLCV[]) => Math.max(...slice.map((bar) => bar.high)) - Math.min(...slice.map((bar) => bar.low));
  const contractionRatio = rangeOf(firstHalf) > 0 ? rangeOf(secondHalf) / rangeOf(firstHalf) : 1;
  const bwPercentile = bandwidthPercentile(closes);
  const contracting = contractionRatio <= R.maxContractionRatio || bwPercentile <= R.squeezePercentile;
  const lastContractionLow = Math.min(...base.slice(-R.pivotLowSessions).map((bar) => bar.low));

  // --- Buy-stop plan ----------------------------------------------------------------------
  const trigger = roundUpTick(pivot + R.triggerBufferAtr * atr, tick);
  const limit = roundUpTick(Math.min(trigger + R.limitBufferAtr * atr, pivot * (1 + R.maxLimitAbovePivotPct / 100)), tick);
  const stop = roundDownTick(Math.max(0, Math.min(
    lastContractionLow - R.stopBufferAtr * atr,
    trigger - R.minStopDistanceAtr * atr,
  )), tick);
  const risk = Math.max(tick, trigger - stop);
  const target = roundUpTick(trigger + input.risk.targetRR * risk, tick);
  const trail = roundDownTick(Math.max(stop, trigger - input.risk.trailAtrMult * atr), tick);
  const recent = closes.slice(-(R.baseLength + 1));
  const velocity = mean(recent.slice(1).map((close, index) => Math.abs(close - recent[index])));
  const expectedDays = velocity > 0 ? Math.min(60, Math.max(1, Math.round((target - trigger) / velocity))) : 20;
  const plan: ArmedSwingPlan = {
    pivot: round2(pivot), trigger: round2(trigger), limit: round2(limit), stop: round2(stop),
    target: round2(target), trail: round2(trail), expectedDays,
    riskPerSharePct: (risk / trigger) * 100,
    rewardRiskRatio: (target - trigger) / risk,
  };
  const distanceToTriggerPct = ((trigger - currentPrice) / trigger) * 100;
  const distanceToTriggerAtr = (trigger - currentPrice) / atr;

  // --- Trend template (stage 2) -----------------------------------------------------------
  const sma50 = sma(closes, 50);
  const sma150 = sma(closes, 150);
  const sma200 = sma(closes, 200);
  const sma200Prior = sma(closes, 200, closes.length - 20);
  const year = bars.slice(-252);
  const high52 = Math.max(...year.map((bar) => bar.high));
  const low52 = Math.min(...year.map((bar) => bar.low));
  const hasTrendHistory = sma150 !== null && sma200 !== null && sma200Prior !== null && sma50 !== null;
  const trendAligned = Boolean(hasTrendHistory
    && latest.close > (sma150 as number) && latest.close > (sma200 as number)
    && (sma50 as number) > (sma200 as number)
    && (sma200 as number) > (sma200Prior as number)
    && latest.close >= high52 * 0.75 && latest.close >= low52 * 1.3);

  // --- Leadership -------------------------------------------------------------------------
  const benchmarkByDate = new Map(benchmarkBars.map((bar) => [bar.date.slice(0, 10), bar.close]));
  const ratio = bars.slice(-126)
    .map((bar) => {
      const reference = benchmarkByDate.get(bar.date.slice(0, 10));
      return reference && reference > 0 ? bar.close / reference : null;
    })
    .filter((value): value is number => value !== null);
  const rsLineNearHigh = ratio.length >= 20 && ratio[ratio.length - 1] >= 0.98 * Math.max(...ratio);

  // --- Volume -----------------------------------------------------------------------------
  const average50 = mean(bars.slice(-50).map((bar) => bar.volume));
  const average20 = mean(bars.slice(-20).map((bar) => bar.volume));
  const volumeDryUp = average50 > 0 ? mean(bars.slice(-5).map((bar) => bar.volume)) / average50 : 1;
  const averageTradedValue20 = mean(bars.slice(-20).map((bar) => bar.close * bar.volume));
  const live = input.liveSession;
  const volumePace = live && average20 > 0
    ? live.volume / (average20 * Math.max(R.minSessionProgress, Math.min(1, live.progress)))
    : null;

  // --- Market and execution context -------------------------------------------------------
  const benchmarkCloses = benchmarkBars.map((bar) => bar.close);
  const benchmarkSma50 = sma(benchmarkCloses, 50);
  const benchmarkSma50Prior = sma(benchmarkCloses, 50, benchmarkCloses.length - 20);
  const benchmarkLatest = benchmarkBars.at(-1);
  const marketRegimePositive = Boolean(benchmarkLatest && benchmarkSma50 !== null && benchmarkSma50Prior !== null
    && benchmarkLatest.close > benchmarkSma50 && benchmarkSma50 > benchmarkSma50Prior);
  const benchmarkTwoDay = benchmarkBars.length >= 3 ? pctChange(benchmarkBars.at(-3)!.close, benchmarkBars.at(-1)!.close) : null;
  const marketShock = (benchmarkTwoDay ?? 0) <= -4;
  const suggestedExposurePct = marketShock ? 0 : marketRegimePositive ? 100 : 50;
  const dataFresh = benchmarkBars.length > 0
    && sessionsBetween(latest.date.slice(0, 10), (benchmarkLatest?.date ?? latest.date).slice(0, 10),
      [...bars, ...benchmarkBars].map((bar) => bar.date.slice(0, 10))) <= 1
    && (input.expectedSessionLag == null || input.expectedSessionLag <= 1);
  let circuitLikeSessions20 = 0;
  const circuitWindow = bars.slice(-21);
  for (let index = 1; index < circuitWindow.length; index++) {
    if (isCircuitLikeSession(circuitWindow[index - 1], circuitWindow[index])) circuitLikeSessions20++;
  }
  const priceFloor = market === "IN" ? 20 : 2;
  const tradedValueFloor = market === "IN" ? 10_000_000 : 1_000_000;
  const triggered = currentPrice >= trigger;
  const exec = input.execution ?? null;
  const quoteVerified = Boolean(exec?.quoteFresh);
  const depthPresent = Boolean(exec && exec.bestBid !== null && exec.bestAsk !== null && exec.bestBid > 0 && exec.bestAsk > 0);
  const bandsPresent = Boolean(exec && exec.lowerCircuit !== null && exec.upperCircuit !== null && exec.lowerCircuit > 0 && exec.upperCircuit > 0);
  const spreadPct = depthPresent ? ((exec!.bestAsk! - exec!.bestBid!) / exec!.bestAsk!) * 100 : null;
  const lowerRoomPct = bandsPresent ? ((currentPrice / exec!.lowerCircuit!) - 1) * 100 : null;
  const limitInsideBand = bandsPresent && limit <= exec!.upperCircuit!;
  const results = input.results ?? null;
  const resultsVerified = Boolean(results?.verified);
  const inBlackout = results?.sessionsToNext != null && results.sessionsToNext <= R.resultsBlackoutSessions;

  const gates: ArmedSwingGate[] = [
    gate("trend", "Stage-2 trend", trendAligned, hasTrendHistory
      ? `Close above 150/200 SMA, 50 > 200 SMA, 200 SMA rising, within 25% of the 52-week high (${high52.toFixed(2)}) and 30% above the low (${low52.toFixed(2)}).`
      : "Insufficient 220-session history for the trend template."),
    gate("relative_strength", "Relative-strength rank", (input.rsPercentile ?? -1) >= R.minRsPercentile,
      input.rsPercentile === null ? "Not enough history to rank 3/6/9/12-month performance."
        : `${input.rsPercentile.toFixed(0)}th percentile of the market on weighted 3/6/9/12-month return; requires ${R.minRsPercentile}.`),
    gate("base_depth", "Tight base", baseDepthPct <= R.maxBaseDepthPct,
      `${R.baseLength}-session base is ${baseDepthPct.toFixed(1)}% deep; maximum ${R.maxBaseDepthPct}%.`),
    gate("contraction", "Volatility contraction", contracting,
      `Second-half range ${(contractionRatio * 100).toFixed(0)}% of the first half (≤ ${R.maxContractionRatio * 100}%) or bandwidth in the lowest ${(R.squeezePercentile * 100).toFixed(0)}% (now ${(bwPercentile * 100).toFixed(0)}%).`),
    gate("proximity", "Near the pivot", triggered || (distanceToTriggerAtr <= R.maxDistanceAtr && distanceToTriggerPct <= R.maxDistancePct),
      triggered ? "Price is at or through the trigger."
        : `${distanceToTriggerPct.toFixed(1)}% / ${distanceToTriggerAtr.toFixed(2)} ATR below the ${plan.trigger.toFixed(2)} trigger; maximum ${R.maxDistanceAtr} ATR and ${R.maxDistancePct}%.`),
    gate("volume_dryup", "Volume dry-up", volumeDryUp <= R.maxDryUp,
      `Five-session volume ${(volumeDryUp * 100).toFixed(0)}% of the 50-session average; supply is drying up below ${R.maxDryUp * 100}%.`, "technical", false),
    gate("rs_line", "RS line near high", rsLineNearHigh,
      rsLineNearHigh ? "Stock/benchmark ratio is within 2% of its six-month high — leadership often leads price."
        : "Stock/benchmark ratio is not yet near its six-month high.", "technical", false),
    gate("breakout_volume", "Breakout volume pace", !triggered || (volumePace ?? 0) >= R.minBreakoutPace,
      !triggered ? `Applies once price crosses the trigger: needs ≥ ${R.minBreakoutPace}x time-adjusted volume pace.`
        : volumePace === null ? "Triggered outside a live session; volume pace cannot be measured."
          : `Intraday volume pace ${volumePace.toFixed(2)}x the 20-session average; requires ${R.minBreakoutPace}x.`,
      "technical", triggered),
    gate("freshness", "Fresh EOD data", dataFresh,
      benchmarkBars.length === 0 ? "Benchmark data unavailable — cannot verify freshness." : `Latest completed session ${latest.date}.`, "execution"),
    gate("price", "Price floor", latest.close >= priceFloor, `${latest.close.toFixed(2)} vs minimum ${priceFloor.toFixed(2)}.`, "execution"),
    gate("liquidity", "20-day liquidity", averageTradedValue20 >= tradedValueFloor,
      `Average traded value ${Math.round(averageTradedValue20).toLocaleString("en-US")}.`, "execution"),
    gate("atr_risk", "Volatility ceiling", atrPct <= R.maxAtrPct, `ATR is ${atrPct.toFixed(1)}% of price; maximum ${R.maxAtrPct}%.`, "execution"),
    gate("stop_width", "Structure-stop risk", plan.riskPerSharePct <= R.maxStopRiskPct,
      `Stop ${plan.stop.toFixed(2)} below the last contraction low risks ${plan.riskPerSharePct.toFixed(1)}% from the trigger; maximum ${R.maxStopRiskPct}%.`, "execution"),
    gate("circuit_behaviour", "Circuit behaviour", circuitLikeSessions20 < 2,
      `${circuitLikeSessions20} circuit-like closes in 20 sessions; maximum 1.`, "execution"),
    gate("market_shock", "Market shock", !marketShock,
      benchmarkTwoDay === null ? "Two-session benchmark move unavailable." : `${benchmarkTwoDay.toFixed(1)}% over two sessions; entries stop at -4%.`, "execution"),
    gate("market_regime", "Market regime", marketRegimePositive,
      marketRegimePositive ? "Benchmark is above a rising 50 SMA; normal sizing." : "Selective regime: use 50% position size.", "execution", false),
    gate("results_blackout", "Results blackout", resultsVerified && !inBlackout,
      !results ? "Results calendar unavailable; entry is not verified against company results."
        : !resultsVerified ? `${results.detail} Entry is not verified against company results.`
          : inBlackout ? `Results due in ${results.sessionsToNext} session${results.sessionsToNext === 1 ? "" : "s"} (${results.nextDate}); no new entries within ${R.resultsBlackoutSessions}.`
            : results.detail, "execution"),
    gate("live_quote", "Fresh live quote", quoteVerified,
      !exec ? `No live execution quote${market === "IN" ? " from Breeze" : ""}; actionable states require one.`
        : quoteVerified ? `Quote is ${exec.quoteAgeMinutes?.toFixed(0) ?? "0"} min old.`
          : exec.quoteAgeMinutes === null ? "Market closed: re-verify with a live quote in the session."
            : `Quote is ${exec.quoteAgeMinutes.toFixed(0)} min old; maximum ${R.maxQuoteAgeMinutes} during the session.`, "execution"),
    gate("live_spread", "Live bid-ask spread", spreadPct !== null && spreadPct <= R.maxSpreadPct,
      spreadPct === null ? "Bid/ask depth unavailable; the spread cannot be verified." : `${spreadPct.toFixed(2)}% spread; maximum ${R.maxSpreadPct}%.`, "execution"),
    gate("live_circuit", "Circuit bands", lowerRoomPct !== null && lowerRoomPct > R.minLowerCircuitRoomPct && limitInsideBand,
      lowerRoomPct === null ? "Circuit bands unavailable; exit room and limit fill cannot be verified."
        : !limitInsideBand ? `Limit ${plan.limit.toFixed(2)} is above the upper circuit ${exec!.upperCircuit!.toFixed(2)}.`
          : `${lowerRoomPct.toFixed(1)}% above lower circuit (requires ${R.minLowerCircuitRoomPct}%); limit inside the upper band.`, "execution"),
  ];

  const blocking = gates.filter((item) => item.blocking);
  const strengthScore = Math.round((blocking.filter((item) => item.passed).length / blocking.length) * 100);
  const failed = (key: string) => gates.some((item) => item.key === key && !item.passed);
  // Missing or stale execution/results data is "unverified", not a market risk call; a real
  // threshold breach on data that IS present is a hard risk. Both block entry.
  const unverified = !quoteVerified || !depthPresent || !bandsPresent || !resultsVerified;
  const dataGateKeys = new Set(["live_quote", "live_spread", "live_circuit", "results_blackout"]);
  const hardRisk = gates.some((item) => item.category === "execution" && item.blocking && !item.passed && !dataGateKeys.has(item.key))
    || (depthPresent && (spreadPct as number) > R.maxSpreadPct)
    || (bandsPresent && !gates.find((item) => item.key === "live_circuit")!.passed)
    || (resultsVerified && inBlackout);
  const technicalPassed = gates
    .filter((item) => item.category === "technical" && item.blocking && item.key !== "breakout_volume")
    .every((item) => item.passed);

  let status: ArmedSwingStatus;
  if (currentPrice < stop) status = "INVALIDATED";
  else if (hardRisk) status = "RISK_OFF";
  else if (triggered && currentPrice > limit) status = "EXTENDED";
  else if (!technicalPassed) status = "FORMING";
  else if (unverified) status = "UNVERIFIED";
  else if (triggered) status = failed("breakout_volume") ? "TRIGGERED_UNCONFIRMED" : "BUY_ZONE";
  else status = "ARMED";

  return {
    status, strengthScore, gates, plan,
    latestClose: latest.close, latestDate: latest.date, atr, atrPct,
    distanceToTriggerPct, distanceToTriggerAtr, baseDepthPct, contractionRatio,
    bandwidthPercentile: bwPercentile, volumeDryUp, volumePace,
    rsPercentile: input.rsPercentile, rsLineNearHigh, averageTradedValue20,
    sma50, sma150, sma200, high52, low52, marketRegimePositive, suggestedExposurePct, circuitLikeSessions20,
  };
}

const STATUS_ORDER: Record<ArmedSwingStatus, number> = {
  BUY_ZONE: 0, TRIGGERED_UNCONFIRMED: 1, ARMED: 2, UNVERIFIED: 3, FORMING: 4, EXTENDED: 5, RISK_OFF: 6, INVALIDATED: 7,
};

/** Actionable first; within a status, stronger leaders closer to their trigger first. */
export function rankArmedSwingCandidates<T extends {
  ticker: string; status: ArmedSwingStatus; rsPercentile: number | null; distanceToTriggerAtr: number; strengthScore: number;
}>(candidates: readonly T[]): T[] {
  return [...candidates].sort((a, b) =>
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
      || b.strengthScore - a.strengthScore
      || (b.rsPercentile ?? -1) - (a.rsPercentile ?? -1)
      || Math.abs(a.distanceToTriggerAtr) - Math.abs(b.distanceToTriggerAtr)
      || a.ticker.localeCompare(b.ticker));
}
