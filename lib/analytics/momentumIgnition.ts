import type { OHLCV } from "@/lib/types";

export type MomentumIgnitionStatus =
  | "EARLY_WATCH"
  | "BREAKOUT_TRIGGERED"
  | "ENTRY_READY"
  | "WAIT_FOR_PULLBACK"
  | "NOT_QUALIFIED";

export interface MomentumIgnitionGate {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface MomentumIgnitionInput {
  currentPrice: number;
  bars: OHLCV[];
  benchmarkBars: OHLCV[];
  sessionProgressFraction?: number;
  currentSessionVolume?: boolean;
}

export interface MomentumIgnitionAssessment {
  status: MomentumIgnitionStatus;
  qualifies: boolean;
  score: number;
  gates: MomentumIgnitionGate[];
  breakoutLevel: number;
  entryTrigger: number;
  atr14: number;
  entryExtensionAtr: number;
  distanceToBreakoutPct: number;
  relativeStrength20Pct: number | null;
  relativeStrength5Pct: number | null;
  relativeStrengthAcceleration: number | null;
  compressionRatio: number;
  volumeDryUpRatio: number;
  projectedVolumeRatio: number;
  accumulationDays10: number;
  averageTradedValue20: number;
  closeLocation: number;
  marketRegimePositive: boolean;
  circuitLikeSessions20: number;
}

const mean = (values: number[]): number =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const sma = (values: number[], period: number, end = values.length): number | null =>
  end >= period ? mean(values.slice(end - period, end)) : null;

const pctChange = (from: number, to: number): number | null =>
  from > 0 && Number.isFinite(from) && Number.isFinite(to) ? ((to / from) - 1) * 100 : null;

const trueRanges = (bars: OHLCV[]): number[] => bars.map((bar, index) => {
  if (index === 0) return bar.high - bar.low;
  const previousClose = bars[index - 1].close;
  return Math.max(
    bar.high - bar.low,
    Math.abs(bar.high - previousClose),
    Math.abs(bar.low - previousClose),
  );
});

const KNOWN_CIRCUIT_BANDS = [5, 10, 20];

function isCircuitLike(previous: OHLCV, current: OHLCV): boolean {
  const change = pctChange(previous.close, current.close);
  if (change === null || !KNOWN_CIRCUIT_BANDS.some((band) => Math.abs(Math.abs(change) - band) <= 0.25)) {
    return false;
  }
  const range = current.high - current.low;
  if (range <= 0) return true;
  const location = (current.close - current.low) / range;
  return change > 0 ? location >= 0.98 : location <= 0.02;
}

function benchmarkReturn(
  benchmarkBars: OHLCV[],
  startDate: string,
  endDate: string,
): number | null {
  let start: OHLCV | null = null;
  let end: OHLCV | null = null;
  for (const bar of benchmarkBars) {
    if (bar.date <= startDate) start = bar;
    if (bar.date <= endDate) end = bar;
  }
  return start && end && start !== end ? pctChange(start.close, end.close) : null;
}

function gate(key: string, label: string, passed: boolean, detail: string): MomentumIgnitionGate {
  return { key, label, passed, detail };
}

/**
 * Pre-breakout discovery model. It is intentionally independent of the
 * confirmed Strong Swing engine and never changes that engine's calculations.
 */
export function assessMomentumIgnition(input: MomentumIgnitionInput): MomentumIgnitionAssessment {
  if (input.bars.length < 200) throw new Error("Momentum Ignition requires at least 200 bars.");
  const bars = input.bars;
  const latest = bars.at(-1) as OHLCV;
  const closes = bars.map((bar) => bar.close);
  const ranges = bars.map((bar) => Math.max(0, bar.high - bar.low));
  const trs = trueRanges(bars);
  const sma20 = sma(closes, 20) as number;
  const sma50 = sma(closes, 50) as number;
  const sma200 = sma(closes, 200) as number;
  const sma50Prior = sma(closes, 50, closes.length - 20) as number | null;
  const atr14 = mean(trs.slice(-14));
  const atr5 = mean(trs.slice(-5));
  const atr20 = mean(trs.slice(-20));
  const range5 = mean(ranges.slice(-5));
  const range20 = mean(ranges.slice(-20));
  const compressionRatio = Math.min(
    atr20 > 0 ? atr5 / atr20 : Number.POSITIVE_INFINITY,
    range20 > 0 ? range5 / range20 : Number.POSITIVE_INFINITY,
  );

  const prior20 = bars.slice(-21, -1);
  const breakoutLevel = Math.max(...prior20.map((bar) => bar.high));
  const entryTrigger = breakoutLevel + 0.1 * atr14;
  const distanceToBreakoutPct = pctChange(input.currentPrice, entryTrigger) ?? Number.POSITIVE_INFINITY;
  const entryExtensionAtr = atr14 > 0
    ? (input.currentPrice - entryTrigger) / atr14
    : Number.POSITIVE_INFINITY;

  const averageVolume20 = mean(prior20.map((bar) => bar.volume));
  const priorThree = bars.slice(-4, -1);
  const volumeDryUpRatio = averageVolume20 > 0
    ? mean(priorThree.map((bar) => bar.volume)) / averageVolume20
    : Number.POSITIVE_INFINITY;
  const progress = input.currentSessionVolume
    ? Math.max(0.12, Math.min(1, input.sessionProgressFraction ?? 1))
    : 1;
  const projectedVolumeRatio = averageVolume20 > 0
    ? latest.volume / (averageVolume20 * progress)
    : 0;

  let accumulationDays10 = 0;
  const accumulationWindow = bars.slice(-11, -1);
  for (let index = 1; index < accumulationWindow.length; index++) {
    const bar = accumulationWindow[index];
    if (bar.close > accumulationWindow[index - 1].close && bar.volume >= averageVolume20 * 1.1) {
      accumulationDays10++;
    }
  }

  const stockStart20 = bars.at(-21) as OHLCV;
  const stockStart5 = bars.at(-6) as OHLCV;
  const stockReturn20 = pctChange(stockStart20.close, input.currentPrice);
  const stockReturn5 = pctChange(stockStart5.close, input.currentPrice);
  const benchmark20 = benchmarkReturn(input.benchmarkBars, stockStart20.date, latest.date);
  const benchmark5 = benchmarkReturn(input.benchmarkBars, stockStart5.date, latest.date);
  const relativeStrength20Pct = stockReturn20 !== null && benchmark20 !== null
    ? stockReturn20 - benchmark20
    : null;
  const relativeStrength5Pct = stockReturn5 !== null && benchmark5 !== null
    ? stockReturn5 - benchmark5
    : null;
  const relativeStrengthAcceleration = relativeStrength20Pct !== null && relativeStrength5Pct !== null
    ? relativeStrength5Pct - relativeStrength20Pct
    : null;

  const benchmarkCloses = input.benchmarkBars.map((bar) => bar.close);
  const benchmarkSma50 = sma(benchmarkCloses, 50);
  const benchmarkSma50Prior = sma(benchmarkCloses, 50, benchmarkCloses.length - 20);
  const benchmarkLatest = input.benchmarkBars.at(-1);
  const marketRegimePositive = Boolean(
    benchmarkLatest && benchmarkSma50 !== null && benchmarkSma50Prior !== null
      && benchmarkLatest.close > benchmarkSma50 && benchmarkSma50 > benchmarkSma50Prior,
  );
  const dateGap = benchmarkLatest
    ? Math.abs(Date.parse(`${latest.date}T00:00:00Z`) - Date.parse(`${benchmarkLatest.date}T00:00:00Z`)) / 86_400_000
    : Number.POSITIVE_INFINITY;
  const dataFresh = dateGap <= 1;

  const trendAligned = Boolean(
    input.currentPrice > sma20 && sma20 > sma50 && sma50 > sma200
      && sma50Prior !== null && sma50 > sma50Prior,
  );
  const relativeStrengthPositive = (relativeStrength20Pct ?? Number.NEGATIVE_INFINITY) > 0;
  const relativeStrengthAccelerating = (relativeStrengthAcceleration ?? Number.NEGATIVE_INFINITY) > 0;
  const nearBreakout = input.currentPrice >= entryTrigger || (
    distanceToBreakoutPct >= 0 && distanceToBreakoutPct <= 5
  );
  const compressed = compressionRatio <= 0.85;
  const volumeDry = volumeDryUpRatio <= 0.8;
  const volumeExpanding = projectedVolumeRatio >= 1.5;
  const averageTradedValue20 = mean(prior20.map((bar) => bar.close * bar.volume));
  const liquid = averageTradedValue20 >= 50_000_000;
  const priceFloor = input.currentPrice >= 20;
  const atrPct = input.currentPrice > 0 ? (atr14 / input.currentPrice) * 100 : Number.POSITIVE_INFINITY;
  const volatilitySafe = atrPct <= 5;
  const latestWindow = bars.slice(-21);
  let circuitLikeSessions20 = 0;
  for (let index = 1; index < latestWindow.length; index++) {
    if (isCircuitLike(latestWindow[index - 1], latestWindow[index])) circuitLikeSessions20++;
  }
  const circuitSafe = circuitLikeSessions20 < 2;
  const range = latest.high - latest.low;
  const closeLocation = range > 0
    ? Math.max(0, Math.min(1, (input.currentPrice - latest.low) / range))
    : 0.5;

  const gates = [
    gate("freshness", "Fresh price history", dataFresh, benchmarkLatest ? `Stock ${latest.date}; benchmark ${benchmarkLatest.date}.` : "Benchmark history unavailable."),
    gate("trend", "Primary trend", trendAligned, "Price > 20 > 50 > 200-day averages, with the 50-day average rising."),
    gate("relative_strength", "20-day relative strength", relativeStrengthPositive, relativeStrength20Pct === null ? "Benchmark comparison unavailable." : `${relativeStrength20Pct.toFixed(1)}% versus Nifty.`),
    gate("rs_acceleration", "Relative-strength acceleration", relativeStrengthAccelerating, relativeStrengthAcceleration === null ? "Short-window comparison unavailable." : `${relativeStrengthAcceleration.toFixed(1)} percentage-point acceleration.`),
    gate("proximity", "Near breakout", nearBreakout, `${distanceToBreakoutPct.toFixed(1)}% below trigger ${entryTrigger.toFixed(2)}.`),
    gate("compression", "Range compression", compressed, `${compressionRatio.toFixed(2)} short/base volatility ratio; requires <= 0.85.`),
    gate("dry_up", "Volume dry-up", volumeDry, `${volumeDryUpRatio.toFixed(2)}x prior volume; requires <= 0.80x.`),
    gate("accumulation", "Accumulation sessions", accumulationDays10 >= 2, `${accumulationDays10} qualifying sessions in the prior ten.`),
    gate("live_volume", "Breakout volume", volumeExpanding, `${projectedVolumeRatio.toFixed(2)}x time-adjusted 20-day volume.`),
    gate("market", "Market regime", marketRegimePositive, marketRegimePositive ? "Nifty is above a rising 50-day average." : "Nifty regime is not supportive."),
    gate("liquidity", "Execution liquidity", liquid, `20-day traded value ${Math.round(averageTradedValue20).toLocaleString("en-IN")}; requires INR 5 crore.`),
    gate("volatility", "Volatility ceiling", volatilitySafe, `ATR is ${atrPct.toFixed(1)}% of price; maximum 5%.`),
    gate("circuit", "Circuit behaviour", circuitSafe, `${circuitLikeSessions20} circuit-like sessions in 20; maximum 1.`),
  ];

  const score = Math.round(
    (trendAligned ? 20 : 0)
      + (relativeStrengthPositive ? 15 : 0)
      + (relativeStrengthAccelerating ? 10 : 0)
      + (nearBreakout ? 10 : 0)
      + (compressed ? 10 : 0)
      + (volumeDry ? 10 : 0)
      + (accumulationDays10 >= 2 ? 10 : 0)
      + (volumeExpanding ? 10 : 0)
      + (marketRegimePositive ? 5 : 0),
  );

  const discoverySafe = dataFresh && liquid && priceFloor && circuitSafe;
  const qualifies = discoverySafe && trendAligned && relativeStrengthPositive && nearBreakout && score >= 55;
  const breakoutTriggered = input.currentPrice >= entryTrigger;
  let status: MomentumIgnitionStatus = "NOT_QUALIFIED";
  if (qualifies && breakoutTriggered && (!volatilitySafe || entryExtensionAtr > 0.5)) status = "WAIT_FOR_PULLBACK";
  else if (qualifies && breakoutTriggered && volumeExpanding && closeLocation >= 0.6) status = "ENTRY_READY";
  else if (qualifies && breakoutTriggered) status = "BREAKOUT_TRIGGERED";
  else if (qualifies) status = "EARLY_WATCH";

  return {
    status,
    qualifies,
    score,
    gates,
    breakoutLevel,
    entryTrigger,
    atr14,
    entryExtensionAtr,
    distanceToBreakoutPct,
    relativeStrength20Pct,
    relativeStrength5Pct,
    relativeStrengthAcceleration,
    compressionRatio,
    volumeDryUpRatio,
    projectedVolumeRatio,
    accumulationDays10,
    averageTradedValue20,
    closeLocation,
    marketRegimePositive,
    circuitLikeSessions20,
  };
}
