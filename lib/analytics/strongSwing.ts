import type { OHLCV } from "@/lib/types";

export type StrongSwingStatus = "CONFIRMED" | "WATCHLIST" | "INVALIDATED";

export interface StrongSwingGate {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface StrongSwingInput {
  market: "IN" | "US";
  verdict: string;
  isBreakout: boolean;
  trigger: number;
  atr: number;
  trailingStop: number | null;
  bars: OHLCV[];
  benchmarkBars: OHLCV[];
}

export interface StrongSwingAssessment {
  status: StrongSwingStatus;
  strengthScore: number;
  gates: StrongSwingGate[];
  confirmationEntry: number;
  latestClose: number;
  latestDate: string;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  relativeStrength20Pct: number | null;
  averageTradedValue20: number;
  volumeRatio: number;
  closeLocation: number;
  triggerClearanceAtr: number;
  oiChange5Pct: number | null;
  marketRegimePositive: boolean;
  confirmationMode: "OI" | "CASH";
}

const mean = (values: number[]): number =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const sma = (values: number[], period: number, end = values.length): number | null => {
  if (end < period) return null;
  return mean(values.slice(end - period, end));
};

const pctChange = (from: number, to: number): number | null =>
  from > 0 && Number.isFinite(from) && Number.isFinite(to) ? ((to - from) / from) * 100 : null;

/**
 * Absolute day gap between two dates. Freshness cares about lag in *either* direction: the
 * previous helper clamped negatives to 0, so a benchmark older than the stock reported a gap
 * of 0 and always passed the freshness gate — even though the benchmark drives the regime and
 * relative-strength gates too.
 */
const absDaysBetween = (from: string, to: string): number => {
  const start = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(start) && Number.isFinite(end)
    ? Math.abs(Math.floor((end - start) / 86_400_000))
    : Number.POSITIVE_INFINITY;
};

function gate(key: string, label: string, passed: boolean, detail: string): StrongSwingGate {
  return { key, label, passed, detail };
}

/**
 * Apply execution-quality gates on top of the existing swing classifier.
 * This is deliberately stricter than Swing Candidates: it produces a state,
 * not a recommendation, and requires a second close above the stronger entry.
 */
export function assessStrongSwing(input: StrongSwingInput): StrongSwingAssessment {
  const { bars, benchmarkBars } = input;
  if (bars.length < 21) throw new Error("Strong Swing requires at least 21 bars.");

  const latest = bars[bars.length - 1];
  const previous = bars[bars.length - 2];
  const closes = bars.map((bar) => bar.close);
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const sma50Prior = sma(closes, 50, closes.length - 20);
  const latestPrice = latest.close;
  const atr = Math.max(0, input.atr);

  // The breakout level is derived from price history, NOT from input.trigger.
  //
  // swing_signals.long_trigger is rebased to the latest market price once a trigger has
  // already traded, so it tracks today's close. Anchoring the confirmation level to it made
  // every level land between yesterday's and today's close: measured across 100 IN
  // candidates, the latest close cleared it 47 times and the previous close 0 times, so the
  // follow-through gate could never pass and CONFIRMED was unreachable.
  //
  // The window ends two bars back so that both of the closes being tested are outside it —
  // a level computed from a window containing the previous bar could not be cleared by that
  // bar's close, since a close never exceeds its own high.
  const breakoutWindow = bars.slice(-22, -2);
  const breakoutLevel = breakoutWindow.length
    ? Math.max(...breakoutWindow.map((bar) => bar.high))
    : latest.close;
  const confirmationEntry = breakoutLevel + 0.25 * atr;

  const prior20 = bars.slice(-21, -1);
  const averageVolume20 = mean(prior20.map((bar) => bar.volume));
  const volumeRatio = averageVolume20 > 0 ? latest.volume / averageVolume20 : 0;
  const averageTradedValue20 = mean(prior20.map((bar) => bar.close * bar.volume));
  const range = latest.high - latest.low;
  const closeLocation = range > 0 ? (latest.close - latest.low) / range : 0.5;
  // Measured against the historical breakout level, so this reports how decisively price
  // cleared a prior high rather than its distance from a level anchored to today's close.
  const triggerClearanceAtr = atr > 0 ? (latest.close - breakoutLevel) / atr : 0;

  // Relative strength is aligned by DATE, not by array index. Indexing both series at -21
  // assumes they share a trading calendar, which fails for any stock with halts or illiquid
  // gaps — 253 of 2,411 NSE candidates carry fewer bars than the benchmark over the same
  // window, so index -21 reached further back for them and their return was measured over a
  // longer period than the benchmark's.
  const benchmarkOnOrBefore = (isoDate: string): OHLCV | null => {
    for (let i = benchmarkBars.length - 1; i >= 0; i--) {
      if (benchmarkBars[i].date <= isoDate) return benchmarkBars[i];
    }
    return null;
  };

  const stockStartBar = bars.length >= 21 ? bars[bars.length - 21] : null;
  const stockReturn20 = stockStartBar ? pctChange(stockStartBar.close, latest.close) : null;

  const benchmarkStart = stockStartBar ? benchmarkOnOrBefore(stockStartBar.date) : null;
  const benchmarkEnd = benchmarkOnOrBefore(latest.date) ?? benchmarkBars.at(-1) ?? null;
  const benchmarkReturn20 = benchmarkStart && benchmarkEnd && benchmarkStart !== benchmarkEnd
    ? pctChange(benchmarkStart.close, benchmarkEnd.close)
    : null;

  const relativeStrength20Pct = stockReturn20 !== null && benchmarkReturn20 !== null
    ? stockReturn20 - benchmarkReturn20
    : null;

  const benchmarkCloses = benchmarkBars.map((bar) => bar.close);
  const benchmarkSma50 = sma(benchmarkCloses, 50);
  const benchmarkSma50Prior = sma(benchmarkCloses, 50, benchmarkCloses.length - 20);
  const benchmarkLatest = benchmarkBars.at(-1);
  const marketRegimePositive = Boolean(
    benchmarkLatest && benchmarkSma50 !== null && benchmarkSma50Prior !== null
      && benchmarkLatest.close > benchmarkSma50 && benchmarkSma50 > benchmarkSma50Prior,
  );

  const referenceDate = benchmarkLatest?.date ?? latest.date;
  const dataFresh = benchmarkBars.length > 0 && absDaysBetween(latest.date, referenceDate) <= 1;
  const priceFloor = input.market === "IN" ? 20 : 2;
  const tradedValueFloor = input.market === "IN" ? 10_000_000 : 1_000_000;
  const hasTrendHistory = sma50 !== null && sma200 !== null && sma50Prior !== null && sma20 !== null;
  const trendAligned = Boolean(
    hasTrendHistory && latest.close > (sma50 as number) && latest.close > (sma200 as number)
      && (sma20 as number) > (sma50 as number) && (sma50 as number) > (sma50Prior as number),
  );
  const followThrough = previous.close >= confirmationEntry && latest.close >= confirmationEntry;

  const fiveBarsAgo = bars.length >= 6 ? bars[bars.length - 6] : null;
  const hasOi = fiveBarsAgo?.openInterest != null && latest.openInterest != null
    && Number(fiveBarsAgo.openInterest) > 0;
  const oiChange5Pct = hasOi
    ? pctChange(Number(fiveBarsAgo?.openInterest), Number(latest.openInterest))
    : null;
  const priceChange5Pct = fiveBarsAgo ? pctChange(fiveBarsAgo.close, latest.close) : null;
  const oiConfirmed = hasOi && (oiChange5Pct ?? 0) >= 5 && (priceChange5Pct ?? 0) > 0;

  // Cash substitute for the OI test, and deliberately independent of the other gates.
  //
  // It previously required followThrough, trendAligned, relative strength and volumeRatio —
  // all of which are already separate gates. That made it a duplicate rather than an extra
  // check, and because followThrough could never pass, this gate could never pass either:
  // two gates reported 100/100 failures that were really one failure counted twice.
  //
  // The OI path asks "is participation building while price rises". This mirrors that in cash
  // terms: five-session volume expanding against the 20-session base, with price up over the
  // same five sessions.
  const recentVolume5 = mean(bars.slice(-5).map((bar) => bar.volume));
  const volumeTrend5 = averageVolume20 > 0 ? recentVolume5 / averageVolume20 : 0;
  const cashConfirmed = !hasOi && (priceChange5Pct ?? 0) > 0 && volumeTrend5 >= 1.2;

  const gates = [
    gate("structure", "Structural setup", input.isBreakout, input.isBreakout ? "Existing engine detected a breakout." : `Base verdict: ${input.verdict}.`),
    gate("freshness", "Fresh EOD data", dataFresh,
      benchmarkBars.length === 0
        ? "Benchmark data unavailable — cannot verify freshness."
        : dataFresh ? `Latest bar ${latest.date}.` : `Latest bar ${latest.date}; benchmark ${referenceDate}.`),
    gate("price", "Price floor", latest.close >= priceFloor, `${latest.close.toFixed(2)} vs minimum ${priceFloor.toFixed(2)}.`),
    gate("liquidity", "20-day liquidity", averageTradedValue20 >= tradedValueFloor, `Average traded value ${Math.round(averageTradedValue20).toLocaleString("en-US")}.`),
    gate("trend", "Primary trend", trendAligned, hasTrendHistory ? "Price > 50/200 SMA; 20 > 50 and 50 SMA rising." : "Insufficient 200-session trend history."),
    gate("relative_strength", "Relative strength", (relativeStrength20Pct ?? Number.NEGATIVE_INFINITY) > 0, relativeStrength20Pct === null ? "Benchmark comparison unavailable." : `${relativeStrength20Pct.toFixed(1)}% vs benchmark over 20 sessions.`),
    gate("clearance", "Decisive breakout", triggerClearanceAtr >= 0.25, `${triggerClearanceAtr.toFixed(2)} ATR above the ${breakoutLevel.toFixed(2)} 20-session high; requires 0.25.`),
    gate("close_quality", "Strong close", closeLocation >= 0.7, `Closed at ${(closeLocation * 100).toFixed(0)}% of the daily range; requires top 30%.`),
    gate("volume", "Volume confirmation", volumeRatio >= 1.5, `${volumeRatio.toFixed(2)}x 20-session average; requires 1.50x.`),
    gate("follow_through", "Two-close follow-through", followThrough, `Both latest closes must hold above ${confirmationEntry.toFixed(2)}.`),
    gate("market_regime", "Market regime", marketRegimePositive,
      benchmarkBars.length === 0
        ? "Benchmark data unavailable — regime cannot be assessed."
        : marketRegimePositive ? "Benchmark is above a rising 50 SMA." : "Benchmark is not above a rising 50 SMA."),
    gate("confirmation", hasOi ? "OI build-up" : "Cash-equity confirmation", hasOi ? oiConfirmed : cashConfirmed,
      hasOi
        ? `${(oiChange5Pct ?? 0).toFixed(1)}% OI change over five sessions.`
        : `${volumeTrend5.toFixed(2)}x five-session volume vs the 20-session base, price ${(priceChange5Pct ?? 0).toFixed(1)}% over five sessions; requires 1.20x and a rise.`),
  ];

  const passed = gates.filter((item) => item.passed).length;
  const strengthScore = Math.round((passed / gates.length) * 100);
  const trailingBreached = input.trailingStop !== null && latest.close <= input.trailingStop;
  // Against the historical breakout level. Compared against the rebased trigger this asked
  // whether the close sat a full ATR below itself, so it never fired and every invalidation
  // came from the trailing stop alone.
  const breakoutFailed = input.isBreakout && atr > 0 && latest.close < breakoutLevel - atr;
  const status: StrongSwingStatus = trailingBreached || breakoutFailed
    ? "INVALIDATED"
    : gates.every((item) => item.passed) ? "CONFIRMED" : "WATCHLIST";

  return {
    status,
    strengthScore,
    gates,
    confirmationEntry,
    latestClose: latestPrice,
    latestDate: latest.date,
    sma20,
    sma50,
    sma200,
    relativeStrength20Pct,
    averageTradedValue20,
    volumeRatio,
    closeLocation,
    triggerClearanceAtr,
    oiChange5Pct,
    marketRegimePositive,
    confirmationMode: hasOi ? "OI" : "CASH",
  };
}
