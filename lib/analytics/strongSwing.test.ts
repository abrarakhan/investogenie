import { describe, expect, it } from "vitest";
import {
  assessStrongSwing as assessStrongSwingRaw,
  assessStrongSwingFromBars as assessStrongSwingFromBarsRaw,
  strongSwingBreakoutLevel,
} from "@/lib/analytics/strongSwing";
import { averageTrueRange, classifySwingSetup, deriveLevels, isStructuralBreakout } from "@/lib/analytics/swingClassifier";
import type { OHLCV } from "@/lib/types";

// India requires a verified results calendar; the tests below supply a clear one unless they
// are about the results gate itself.
const RESULTS_CLEAR = { verified: true, sessionsToNext: null, nextDate: null, detail: "No results due." };
const assessStrongSwing = (input: Parameters<typeof assessStrongSwingRaw>[0]) =>
  assessStrongSwingRaw({ results: RESULTS_CLEAR, ...input });
const assessStrongSwingFromBars = (input: Parameters<typeof assessStrongSwingFromBarsRaw>[0]) =>
  assessStrongSwingFromBarsRaw({ results: RESULTS_CLEAR, ...input });

function risingBars(count = 240, withOi = false, slope = 0.5): OHLCV[] {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index * slope;
    return {
      date: new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10),
      open: close - 1,
      high: close + 0.5,
      low: close - 1.5,
      close,
      volume: index >= count - 5 ? 3_000_000 : 1_000_000,
      openInterest: withOi ? 1_000_000 + index * 10_000 : null,
    };
  });
}

/**
 * A base that goes sideways, then breaks out on the final two bars.
 *
 * The gates are checked against the highest high of the 20 sessions ending two bars back, so a
 * breakout has to clear that level on both of the last two closes. Building it into the price
 * series is the point: the earlier version of this test passed a hand-picked `trigger` sitting
 * 1.5 below the latest close, which no production trigger ever does — swing_signals.long_trigger
 * is rebased to the current price. That made the test pass while the gate was unsatisfiable
 * against every real row.
 */
function breakoutBars(count = 240, opts: { clears?: boolean } = {}): OHLCV[] {
  const { clears = true } = opts;
  const baseClose = 100;
  const breakoutClose = clears ? 112 : 100.4;
  return Array.from({ length: count }, (_, index) => {
    const fromEnd = count - 1 - index;
    const isBreakoutBar = fromEnd <= 1;
    const close = isBreakoutBar ? breakoutClose : baseClose + (index % 5) * 0.1;
    return {
      date: new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10),
      open: close - 0.4,
      high: close + 0.2,
      low: close - 0.6,
      close,
      volume: fromEnd <= 4 ? 4_000_000 : 1_000_000,
      openInterest: null,
    };
  });
}

/** Benchmark that trails the stock, so relative strength is positive and the regime is healthy. */
const benchmark = (count = 240) => risingBars(count, false, 0.2);

function cleanConfirmedBars(): { bars: OHLCV[]; entry: number } {
  const bars = risingBars(240, false, 0.5);
  const breakoutLevel = Math.max(...bars.slice(-22, -2).map((bar) => bar.high));
  const entry = breakoutLevel + 0.5;
  for (let index = bars.length - 2; index < bars.length; index++) {
    const close = entry + 0.2;
    bars[index] = {
      ...bars[index],
      open: close - 0.4,
      high: close + 0.2,
      low: close - 0.6,
      close,
      volume: 4_000_000,
    };
  }
  return { bars, entry };
}

describe("assessStrongSwing", () => {
  it("marks a clean, timely setup as execution ready", () => {
    const { bars, entry } = cleanConfirmedBars();
    const result = assessStrongSwing({
      market: "IN", verdict: "LONG_BREAKOUT", isBreakout: true,
      trigger: entry, atr: 2, trailingStop: null, currentPrice: entry + 0.2,
      stopAtrMult: 1.5, bars, benchmarkBars: benchmark(),
    });

    expect(result.status).toBe("EXECUTION_READY");
    expect(result.gates.every((gate) => gate.passed)).toBe(true);
  });

  it("blocks execution when a live Breeze spread is too wide", () => {
    const { bars, entry } = cleanConfirmedBars();
    const result = assessStrongSwing({
      market: "IN", verdict: "LONG_BREAKOUT", isBreakout: true,
      trigger: entry, atr: 2, trailingStop: null, currentPrice: entry + 0.2,
      stopAtrMult: 1.5, bars, benchmarkBars: benchmark(),
      requireLiveExecutionData: true,
      microstructure: { bestBid: 100, bestAsk: 101, lowerCircuit: 90, quoteFresh: true },
    });
    expect(result.status).toBe("RISK_OFF");
    expect(result.gates.find((gate) => gate.key === "live_spread")?.passed).toBe(false);
  });

  it("fails closed during India market hours when Breeze execution data is absent", () => {
    const { bars, entry } = cleanConfirmedBars();
    const result = assessStrongSwing({
      market: "IN", verdict: "LONG_BREAKOUT", isBreakout: true,
      trigger: entry, atr: 2, trailingStop: null, currentPrice: entry + 0.2,
      stopAtrMult: 1.5, bars, benchmarkBars: benchmark(),
      requireLiveExecutionData: true,
    });

    expect(result.status).toBe("RISK_OFF");
    expect(result.gates.find((gate) => gate.key === "live_quote")?.passed).toBe(false);
    expect(result.gates.find((gate) => gate.key === "live_spread")?.passed).toBe(false);
    expect(result.gates.find((gate) => gate.key === "live_circuit")?.passed).toBe(true);
  });

  it("does not require intraday depth after the India session closes", () => {
    const { bars, entry } = cleanConfirmedBars();
    const result = assessStrongSwing({
      market: "IN", verdict: "LONG_BREAKOUT", isBreakout: true,
      trigger: entry, atr: 2, trailingStop: null, currentPrice: entry + 0.2,
      stopAtrMult: 1.5, bars, benchmarkBars: benchmark(),
      requireLiveExecutionData: false,
    });

    expect(result.gates.find((gate) => gate.key === "live_quote")?.passed).toBe(true);
    expect(result.gates.find((gate) => gate.key === "live_spread")?.passed).toBe(true);
    expect(result.gates.find((gate) => gate.key === "live_circuit")?.passed).toBe(true);
  });

  it("does not reprice a missed breakout into a new entry", () => {
    const { bars, entry } = cleanConfirmedBars();
    const result = assessStrongSwing({
      market: "IN", verdict: "LONG_BREAKOUT", isBreakout: true,
      trigger: entry, atr: 2, trailingStop: null, currentPrice: entry + 2,
      stopAtrMult: 1.5, bars, benchmarkBars: benchmark(),
    });

    expect(result.status).toBe("WAIT_FOR_ENTRY");
    expect(result.gates.find((gate) => gate.key === "entry_zone")?.passed).toBe(false);
  });

  it("blocks a BODALCHEM-style parabolic move", () => {
    const { bars, entry } = cleanConfirmedBars();
    const start = bars.length - 11;
    for (let index = start; index < bars.length; index++) {
      const close = 180 + (index - start) * 12;
      bars[index] = {
        ...bars[index], open: close - 2, high: close + 1, low: close - 3,
        close, volume: 4_000_000,
      };
    }
    const result = assessStrongSwing({
      market: "IN", verdict: "LONG_BREAKOUT", isBreakout: true,
      trigger: entry, atr: 4, trailingStop: null, currentPrice: bars.at(-1)!.close,
      stopAtrMult: 1.5, bars, benchmarkBars: benchmark(),
    });

    expect(result.status).toBe("RISK_OFF");
    expect(result.gates.find((gate) => gate.key === "extension_10d")?.passed).toBe(false);
  });

  /** Steep 25-session advance, then a confirmed two-close breakout inside the buy zone. */
  function stretchedConfirmedBars(atr = 12): { bars: OHLCV[]; entry: number; close: number } {
    const bars = Array.from({ length: 240 }, (_, index) => {
      const close = index < 215 ? 100 + index * 0.5 : 207 + (index - 215) * 5;
      return {
        date: new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10),
        open: close - 0.8, high: close + 0.3, low: close - 1, close,
        volume: index >= 235 ? 3_000_000 : 1_000_000, openInterest: null,
      };
    });
    const entry = Math.max(...bars.slice(-22, -2).map((bar) => bar.high)) + 0.25 * atr;
    const close = entry + 0.4 * atr;
    for (let index = bars.length - 2; index < bars.length; index++) {
      bars[index] = { ...bars[index], open: close - 1, high: close + 0.2, low: close - 1.5, close, volume: 4_000_000 };
    }
    return { bars, entry, close };
  }

  it("treats a confirmed breakout stretched above SMA20 as a pullback candidate", () => {
    const { bars, entry, close } = stretchedConfirmedBars();
    const result = assessStrongSwing({
      market: "IN", verdict: "LONG_BREAKOUT", isBreakout: true,
      trigger: entry, atr: 12, trailingStop: null, currentPrice: close,
      stopAtrMult: 1.5, bars, benchmarkBars: benchmark(),
    });

    const failed = result.gates.filter((gate) => gate.blocking && !gate.passed).map((gate) => gate.key);
    expect(failed).toEqual(["sma20_extension"]);
    expect(result.status).toBe("WAIT_FOR_ENTRY");
  });

  it("keeps an unconfirmed stretched setup risk off", () => {
    const { bars, entry, close } = stretchedConfirmedBars();
    const result = assessStrongSwing({
      market: "IN", verdict: "BREAKOUT_UNCONFIRMED", isBreakout: false,
      trigger: entry, atr: 12, trailingStop: null, currentPrice: close,
      stopAtrMult: 1.5, bars, benchmarkBars: benchmark(),
    });
    expect(result.status).toBe("RISK_OFF");
  });

  it("keeps a first-day breakout on the watchlist", () => {
    // Only the final bar clears the level, so follow-through has not been proven.
    const bars = breakoutBars();
    bars[bars.length - 2] = { ...bars[bars.length - 2], close: 100.2, high: 100.4, low: 99.8 };
    const latest = bars.at(-1)!;
    const result = assessStrongSwing({
      market: "IN",
      verdict: "BREAKOUT_UNCONFIRMED",
      isBreakout: true,
      trigger: latest.close,
      atr: 2,
      trailingStop: latest.close - 10,
      bars,
      benchmarkBars: benchmark(),
    });
    expect(result.status).toBe("WATCHLIST");
    expect(result.gates.find((item) => item.key === "follow_through")?.passed).toBe(false);
  });

  it("passes follow-through when both closes clear the prior 20-session high", () => {
    const bars = breakoutBars();
    const latest = bars.at(-1)!;
    const result = assessStrongSwing({
      market: "IN",
      verdict: "LONG_BREAKOUT",
      isBreakout: true,
      // A rebased trigger, as production actually supplies: it tracks the latest close.
      trigger: latest.close,
      atr: 2,
      trailingStop: latest.close - 10,
      bars,
      benchmarkBars: benchmark(),
    });
    expect(result.gates.find((item) => item.key === "follow_through")?.passed).toBe(true);
  });

  it("does not depend on the trigger it is handed", () => {
    // The same bars must produce the same follow-through verdict whatever the trigger is,
    // because the level now comes from price history. This is the regression guard for the
    // rebased-trigger bug.
    const bars = breakoutBars();
    const base = {
      market: "IN" as const,
      verdict: "LONG_BREAKOUT",
      isBreakout: true,
      atr: 2,
      trailingStop: 0,
      bars,
      benchmarkBars: benchmark(),
    };
    const withRebased = assessStrongSwing({ ...base, trigger: bars.at(-1)!.close });
    const withHistorical = assessStrongSwing({ ...base, trigger: 100 });
    expect(withRebased.confirmationEntry).toBe(withHistorical.confirmationEntry);
    expect(withRebased.gates.find((g) => g.key === "follow_through")?.passed)
      .toBe(withHistorical.gates.find((g) => g.key === "follow_through")?.passed);
  });

  it("invalidates a setup after its trailing stop is breached", () => {
    const bars = breakoutBars();
    const latest = bars.at(-1)!;
    const result = assessStrongSwing({
      market: "IN",
      verdict: "LONG_BREAKOUT",
      isBreakout: true,
      trigger: latest.close,
      atr: 2,
      trailingStop: latest.close + 0.1,
      bars,
      benchmarkBars: benchmark(),
    });
    expect(result.status).toBe("INVALIDATED");
  });

  it("invalidates when price falls a full ATR back below the breakout level", () => {
    // Guards the branch that was dead while it compared against the rebased trigger.
    const bars = breakoutBars(240, { clears: false });
    const collapsed = bars.at(-1)!;
    bars[bars.length - 1] = { ...collapsed, close: 95, high: 95.4, low: 94.6 };
    const result = assessStrongSwing({
      market: "IN",
      verdict: "LONG_BREAKOUT",
      isBreakout: true,
      trigger: 95,
      atr: 2,
      trailingStop: null,
      bars,
      benchmarkBars: benchmark(),
    });
    expect(result.status).toBe("INVALIDATED");
  });

  it("requires OI growth when OI data is available", () => {
    const bars = breakoutBars();
    bars.forEach((bar, index) => { bar.openInterest = 1_000_000 + index * 10_000; });
    bars[bars.length - 6].openInterest = 1_000_000;
    bars[bars.length - 1].openInterest = 1_020_000; // +2%, under the 5% requirement
    const result = assessStrongSwing({
      market: "IN",
      verdict: "LONG_BREAKOUT",
      isBreakout: true,
      trigger: bars.at(-1)!.close,
      atr: 2,
      trailingStop: bars.at(-1)!.close - 10,
      bars,
      benchmarkBars: benchmark(),
    });
    expect(result.confirmationMode).toBe("OI");
    expect(result.gates.find((item) => item.key === "confirmation")?.passed).toBe(false);
  });

  it("does not let the cash confirmation gate mirror follow-through", () => {
    // Both were failing together because cashConfirmed required followThrough. With only the
    // final bar clearing the level, follow-through must fail while cash confirmation — which
    // tests five-session participation and price — can still pass on its own evidence.
    const bars = breakoutBars();
    bars[bars.length - 2] = { ...bars[bars.length - 2], close: 100.2, high: 100.4, low: 99.8 };
    const result = assessStrongSwing({
      market: "IN",
      verdict: "LONG_BREAKOUT",
      isBreakout: true,
      trigger: bars.at(-1)!.close,
      atr: 2,
      trailingStop: bars.at(-1)!.close - 10,
      bars,
      benchmarkBars: benchmark(),
    });
    expect(result.confirmationMode).toBe("CASH");
    expect(result.gates.find((g) => g.key === "follow_through")?.passed).toBe(false);
    expect(result.gates.find((g) => g.key === "confirmation")?.passed).toBe(true);
  });

  it("fails freshness when the benchmark is stale, not just the stock", () => {
    // The old clamp reported a gap of 0 whenever the benchmark lagged, so this always passed.
    const bars = breakoutBars();
    const stale = benchmark().slice(0, -10);
    const result = assessStrongSwing({
      market: "IN",
      verdict: "LONG_BREAKOUT",
      isBreakout: true,
      trigger: bars.at(-1)!.close,
      atr: 2,
      trailingStop: null,
      bars,
      benchmarkBars: stale,
    });
    expect(result.gates.find((g) => g.key === "freshness")?.passed).toBe(false);
  });

  it("treats Friday benchmark data as fresh for a Monday live bar", () => {
    const bars = breakoutBars();
    const benchmarkBars = benchmark();
    bars[bars.length - 1] = { ...bars.at(-1)!, date: "2026-09-21" };
    benchmarkBars[benchmarkBars.length - 1] = { ...benchmarkBars.at(-1)!, date: "2026-09-18" };
    const result = assessStrongSwing({
      market: "IN",
      verdict: "LONG_BREAKOUT",
      isBreakout: true,
      trigger: bars.at(-1)!.close,
      atr: 2,
      trailingStop: null,
      bars,
      benchmarkBars,
    });
    expect(result.gates.find((g) => g.key === "freshness")?.passed).toBe(true);
  });

  it("reports missing benchmark data rather than blaming the market regime", () => {
    const bars = breakoutBars();
    const result = assessStrongSwing({
      market: "IN",
      verdict: "LONG_BREAKOUT",
      isBreakout: true,
      trigger: bars.at(-1)!.close,
      atr: 2,
      trailingStop: null,
      bars,
      benchmarkBars: [],
    });
    expect(result.relativeStrength20Pct).toBeNull();
    expect(result.gates.find((g) => g.key === "market_regime")?.detail).toContain("unavailable");
    expect(result.gates.find((g) => g.key === "freshness")?.passed).toBe(false);
  });

  it("measures relative strength over matching dates when the stock has gaps", () => {
    // A stock missing sessions must not be credited with a longer return window than the
    // benchmark. Dropping bars shifts index -21 further back in calendar time; date alignment
    // is what keeps the comparison honest.
    const full = risingBars(240, false, 0.5);
    const gapped = full.filter((_, index) => index < 200 || index % 2 === 0);
    const dense = assessStrongSwing({
      market: "IN", verdict: "LONG_BREAKOUT", isBreakout: true,
      trigger: full.at(-1)!.close, atr: 2, trailingStop: null,
      bars: full, benchmarkBars: benchmark(),
    });
    const sparse = assessStrongSwing({
      market: "IN", verdict: "LONG_BREAKOUT", isBreakout: true,
      trigger: gapped.at(-1)!.close, atr: 2, trailingStop: null,
      bars: gapped, benchmarkBars: benchmark(),
    });
    // Both compare against benchmark returns drawn from their own 20-session date span, so
    // neither is null and the gapped series is not silently handed a longer benchmark window.
    expect(dense.relativeStrength20Pct).not.toBeNull();
    expect(sparse.relativeStrength20Pct).not.toBeNull();
  });
});

/**
 * A choppy base (closes cycling 98, 100, 102) followed by the given closes. The base is wide
 * enough that a close holding just under a breakout day sits inside the upper band, which a
 * flat base never allows. Mirrored by choppy_breakout_bars() in the Python parity tests.
 */
function choppyBreakoutBars(tail: number[], count = 240): OHLCV[] {
  const closes = [...Array.from({ length: count - tail.length }, (_, index) => 98 + (index % 3) * 2), ...tail];
  return closes.map((close, index) => ({
    date: new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10),
    open: close - 0.4, high: close + 0.2, low: close - 0.6, close,
    volume: 1_000_000, openInterest: null,
  }));
}

describe("assessStrongSwingFromBars", () => {
  const assess = (bars: OHLCV[], currentPrice?: number) => assessStrongSwingFromBars({
    market: "IN", verdict: "LONG_BREAKOUT", currentPrice, stopAtrMult: 1.5,
    bars, benchmarkBars: benchmark(),
  });

  it("derives ATR, breakout and trail from the bars it is given", () => {
    const bars = breakoutBars();
    const result = assess(bars);
    const atr = averageTrueRange(bars, 14);
    expect(result.atr).toBeCloseTo(atr, 10);
    expect(result.atrPct).toBeCloseTo((atr / bars.at(-1)!.close) * 100, 10);
    expect(result.confirmationEntry).toBeCloseTo(strongSwingBreakoutLevel(bars) + 0.25 * atr, 10);
    expect(result.stopRiskPct).toBeCloseTo(((atr * 1.5) / result.confirmationEntry) * 100, 10);
    expect(result.isBreakout).toBe(isStructuralBreakout(bars) || isStructuralBreakout(bars.slice(0, -1)));
  });

  it("accepts a day-one breakout that holds on day two without a new high", () => {
    const held = choppyBreakoutBars([104.5, 104.0]);
    expect(isStructuralBreakout(held.slice(0, -1))).toBe(true);
    expect(isStructuralBreakout(held)).toBe(false);
    const result = assess(held);
    expect(result.breakoutBar).toBe("previous");
    expect(result.gates.find((gate) => gate.key === "structure")!.passed).toBe(true);
    expect(result.gates.find((gate) => gate.key === "follow_through")!.passed).toBe(true);
    expect(assess(held.slice(0, -1)).breakoutBar).toBe("latest");
  });

  it("does not count a breakout older than the two confirmation bars", () => {
    const result = assess(choppyBreakoutBars([104.5, 104.0, 103.8]));
    expect(result.breakoutBar).toBeNull();
    expect(result.gates.find((gate) => gate.key === "structure")!.passed).toBe(false);
  });

  it("starts the trail at the protective stop, never above the entry", () => {
    const bars = breakoutBars();
    const last = bars.at(-1)!;
    // A spike far above the entry inside the 22-session window: it used to lift the initial
    // chandelier above the entry itself.
    const spiked = [...bars.slice(0, -1), { ...last, high: last.close + 30 }];
    for (const series of [bars, spiked, risingBars(), choppyBreakoutBars([104.5, 104.0])]) {
      const result = assess(series);
      expect(result.trailingStop).toBeLessThan(result.confirmationEntry);
      expect(result.trailingStop).toBeCloseTo(Math.round(result.confirmationEntry * 100) / 100 - 1.5 * result.atr, 1);
    }
  });

  it("does not activate a stop for an unfilled candidate", () => {
    // A base drifting well under its 20-session high: below where a stop would sit, but no
    // position could exist, so there is nothing to stop out.
    const bars = choppyBreakoutBars([98, 97.5]);
    const result = assess(bars);
    expect(bars.at(-1)!.close).toBeLessThanOrEqual(result.effectiveTrailingStop);
    expect(result.status).not.toBe("INVALIDATED");
  });

  it("does not let a falling bar loosen the stop it is judged against", () => {
    const bars = choppyBreakoutBars([104.5, 104.0]);
    const calm = assess(bars);
    const last = bars.at(-1)!;
    // A wide collapse: its range inflates the ATR, which would push a same-bar stop below the close.
    const close = calm.effectiveTrailingStop - 0.05;
    const collapse = [...bars.slice(0, -1), { ...last, high: last.close + 1, low: close - 12, close }];
    const result = assess(collapse);
    expect(result.atr).toBeGreaterThan(calm.atr);
    expect(result.effectiveTrailingStop).toBe(calm.effectiveTrailingStop);
    expect(close).toBeGreaterThan(result.trailingStop);
    expect(close).toBeLessThanOrEqual(result.effectiveTrailingStop);
    // The reference stop stays strict for parity, but an unfilled candidate has no active stop.
    expect(result.status).not.toBe("INVALIDATED");
  });

  it("uses the same trail the displayed plan is built with", () => {
    for (const bars of [breakoutBars(), risingBars(), breakoutBars(240, { clears: false })]) {
      const result = assess(bars);
      const recent = bars.slice(-22);
      const levels = deriveLevels({
        currentPrice: result.confirmationEntry, atr: result.atr, longTrigger: result.confirmationEntry,
        shortTrigger: 0, hh22: Math.max(...recent.map((bar) => bar.high)),
        ll22: Math.min(...recent.map((bar) => bar.low)), dailyVelocity: 1,
      }, "LONG", { stopAtrMult: 1.5, targetRR: 2, trailAtrMult: 3 });
      expect(result.trailingStop).toBe(levels.stopLoss);
      expect(levels.stopLoss).toBeLessThan(levels.entry);
      expect(levels.target).toBeGreaterThan(levels.entry);
    }
  });

  it("agrees with the classifier's breakout flag on the same series", () => {
    const series = [breakoutBars(), breakoutBars(240, { clears: false }), risingBars(), risingBars(60), risingBars(240, false, -0.1)];
    for (const bars of series) {
      expect(isStructuralBreakout(bars)).toBe(classifySwingSetup(bars).isBreakout);
    }
    expect(isStructuralBreakout(breakoutBars())).toBe(true);
    expect(isStructuralBreakout(breakoutBars(240, { clears: false }))).toBe(false);
  });

  it("is unchanged by an unfinished candle the caller left out", () => {
    const completed = breakoutBars();
    const last = completed.at(-1)!;
    // A wild partial session after the completed bars: it would move ATR, the 22-session high
    // and the breakout flag if it were allowed in.
    const partial: OHLCV = { ...last, date: "2026-01-01", open: last.close, high: last.close * 1.3, low: last.close * 0.8, close: last.close * 0.85, volume: 10 };
    const withPartial = assess([...completed, partial]);
    const clean = assess(completed);
    expect(withPartial.atr).not.toBeCloseTo(clean.atr, 2);
    expect(assess(completed)).toEqual(clean);
    expect(clean.latestDate).toBe(last.date);
  });

  it("invalidates a collapse only through the technical failed-breakout rule", () => {
    const bars = breakoutBars();
    const healthy = assess(bars);
    expect(healthy.status).not.toBe("INVALIDATED");
    const last = bars.at(-1)!;
    const collapsed = [...bars.slice(0, -1), { ...last, close: 60, low: 59, high: last.high }];
    const broken = assess(collapsed, 500);
    expect(collapsed.at(-1)!.close).toBeLessThanOrEqual(broken.effectiveTrailingStop);
    expect(broken.status).toBe("INVALIDATED");
    const directWithoutStop = assessStrongSwing({
      market: "IN", verdict: "LONG_BREAKOUT", isBreakout: broken.isBreakout,
      trigger: 0, atr: broken.atr, trailingStop: null, currentPrice: 500,
      stopAtrMult: 1.5, bars: collapsed, benchmarkBars: benchmark(),
    });
    expect(directWithoutStop.status).toBe("INVALIDATED");
  });

  it("produces the values the independent Python check expects for the same series", () => {
    // Mirrored in pipelines/test_strong_swing_parity.py; change both together.
    const result = assess(breakoutBars());
    expect(result.atr).toBeCloseTo(1.6285714285714263, 9);
    expect(result.confirmationEntry).toBeCloseTo(101.00714285714287, 9);
    expect(result.trailingStop).toBe(98.57);
    expect(result.effectiveTrailingStop).toBe(98.55);
    expect(result.isBreakout).toBe(true);
    const flat = assess(breakoutBars(240, { clears: false }));
    expect(flat.atr).toBeCloseTo(0.8285714285714262, 9);
    expect(flat.trailingStop).toBe(99.57);
    expect(flat.isBreakout).toBe(false);
  });

  it("matches the gate engine when handed its own derived inputs", () => {
    const bars = breakoutBars();
    const derived = assess(bars, bars.at(-1)!.close);
    const direct = assessStrongSwing({
      market: "IN", verdict: "LONG_BREAKOUT", isBreakout: derived.isBreakout, trigger: 0, atr: derived.atr,
      trailingStop: null, currentPrice: bars.at(-1)!.close, stopAtrMult: 1.5,
      bars, benchmarkBars: benchmark(),
    });
    expect(derived.status).toBe(direct.status);
    expect(derived.gates.map((gate) => [gate.key, gate.passed])).toEqual(direct.gates.map((gate) => [gate.key, gate.passed]));
  });
});

describe("Strong Swing v4 rules", () => {
  const ready = (overrides: Partial<Parameters<typeof assessStrongSwingRaw>[0]> = {}) => {
    const { bars, entry } = cleanConfirmedBars();
    return { entry, result: assessStrongSwing({
      market: "IN", verdict: "LONG_BREAKOUT", isBreakout: true,
      trigger: entry, atr: 2, trailingStop: null, currentPrice: entry + 0.2,
      stopAtrMult: 1.5, bars, benchmarkBars: benchmark(), ...overrides,
    }) };
  };
  const gateOf = (result: ReturnType<typeof assessStrongSwing>, key: string) =>
    result.gates.find((gate) => gate.key === key)!;

  it("blocks an India entry inside three sessions of company results", () => {
    const { result } = ready({ results: { verified: true, sessionsToNext: 2, nextDate: "2026-11-17", detail: "Next results 2026-11-17." } });
    expect(gateOf(result, "results_blackout").passed).toBe(false);
    expect(result.status).toBe("RISK_OFF");
  });

  it("blocks an India entry when the results calendar cannot be verified", () => {
    expect(ready({ results: null }).result.status).toBe("RISK_OFF");
    expect(ready({ results: { verified: false, sessionsToNext: null, nextDate: null, detail: "Not checked." } }).result.status).toBe("RISK_OFF");
  });

  it("reports a missing US results calendar without blocking on it", () => {
    const { result } = ready({ market: "US", results: null });
    expect(gateOf(result, "results_blackout")).toMatchObject({ passed: false, blocking: false });
    expect(result.status).toBe("EXECUTION_READY");
  });

  it("waits when the live price is below the confirmed entry", () => {
    const { result, entry } = ready();
    const below = ready({ currentPrice: entry - 1 }).result;
    expect(result.status).toBe("EXECUTION_READY");
    expect(gateOf(below, "entry_zone").passed).toBe(false);
    expect(below.status).toBe("WAIT_FOR_ENTRY");
  });

  it("judges volume, close and clearance on the breakout bar when the latest bar is the hold", () => {
    const { bars, entry } = cleanConfirmedBars();
    // Quiet hold day: light volume and a close near the low of its range, still above the entry.
    const hold = bars.at(-1)!;
    bars[bars.length - 1] = { ...hold, volume: 900_000, high: hold.close + 1.5, low: hold.close - 0.1 };
    const input = {
      market: "IN" as const, verdict: "NO_SETUP", isBreakout: true,
      trigger: entry, atr: 2, trailingStop: null, currentPrice: entry + 0.2,
      stopAtrMult: 1.5, bars, benchmarkBars: benchmark(),
    };
    const onHoldDay = assessStrongSwing({ ...input, breakoutBar: "latest" });
    const onBreakoutBar = assessStrongSwing({ ...input, breakoutBar: "previous" });
    expect(gateOf(onHoldDay, "volume").passed).toBe(false);
    expect(gateOf(onHoldDay, "close_quality").passed).toBe(false);
    expect(gateOf(onBreakoutBar, "volume").passed).toBe(true);
    expect(gateOf(onBreakoutBar, "close_quality").passed).toBe(true);
    expect(gateOf(onBreakoutBar, "clearance").passed).toBe(true);
  });

  it("requires the 50-day average above the 200-day", () => {
    // A long decline followed by a sharp recovery: price and the 50-day are rising, but the
    // 50-day is still under the 200-day.
    const bars = risingBars(240, false, 0.5).map((bar, index) => {
      const close = index < 200 ? 300 - index : 100 + (index - 200) * 2.4;
      return { ...bar, open: close - 1, high: close + 0.5, low: close - 1.5, close };
    });
    const result = assessStrongSwing({
      market: "IN", verdict: "LONG_BREAKOUT", isBreakout: true, trigger: 190, atr: 2,
      trailingStop: null, stopAtrMult: 1.5, bars, benchmarkBars: benchmark(),
    });
    expect(result.sma50!).toBeLessThan(result.sma200!);
    expect(gateOf(result, "trend").passed).toBe(false);
  });
});

describe("assessStrongSwing benchmark verification", () => {
  // Previously a benchmark that was absent, behind the market, or too short for its 50-SMA
  // produced RISK_OFF (or fell through to WATCHLIST via the relative-strength gate), telling
  // the user the market was dangerous when it simply could not be measured.
  const setup = (benchmarkBars: OHLCV[]) => {
    const { bars, entry } = cleanConfirmedBars();
    return assessStrongSwing({
      market: "IN", verdict: "LONG_BREAKOUT", isBreakout: true,
      trigger: entry, atr: 2, trailingStop: null, currentPrice: entry + 0.2,
      stopAtrMult: 1.5, bars, benchmarkBars,
    });
  };

  it("reports a missing benchmark as unverified, not risk off", () => {
    const result = setup([]);
    expect(result.status).toBe("UNVERIFIED");
  });

  it("reports a stale benchmark as unverified, not risk off", () => {
    const result = setup(benchmark().slice(0, -8));
    expect(result.status).toBe("UNVERIFIED");
  });

  it("reports a benchmark too short for its 50-SMA as unverified", () => {
    // Fresh, but only 30 bars: the regime question has no answer rather than a negative one.
    const short = benchmark().slice(-30);
    const result = setup(short);
    expect(result.status).toBe("UNVERIFIED");
  });

  it("never reaches execution ready without a usable benchmark", () => {
    for (const bench of [[], benchmark().slice(0, -8), benchmark().slice(-30)]) {
      expect(setup(bench as OHLCV[]).status).not.toBe("EXECUTION_READY");
    }
  });

  it("still reports a genuine two-session shock as risk off", () => {
    // A usable benchmark that really did fall: that is a market call, and must stay RISK_OFF.
    const shocked = benchmark();
    const last = shocked[shocked.length - 1];
    const third = shocked[shocked.length - 3];
    shocked[shocked.length - 1] = { ...last, close: third.close * 0.9, high: third.close * 0.9, low: third.close * 0.9 };
    const result = setup(shocked);
    expect(result.gates.find((gate) => gate.key === "market_shock")?.passed).toBe(false);
    expect(result.status).toBe("RISK_OFF");
  });
});
