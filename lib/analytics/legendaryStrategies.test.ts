import { describe, expect, it } from "vitest";
import type { OHLCV } from "@/lib/types";
import {
  detectDarvas, detectMinervini, detectPTJ, detectQullamaggie, detectSimons, evaluateLegendary,
  darvasTrailingBottom, momentumLeaderPercentiles, relativeStrengthRatings, strategyFollowUp, strategyTradeLevels,
  withBreakoutDay,
} from "./legendaryStrategies";
import { DEFAULT_RISK, type SwingSetup } from "./swingClassifier";

/** Bars from [high, low, close, volume] tuples; open is the prior close. */
function series(points: Array<[number, number, number, number?]>): OHLCV[] {
  return points.map(([high, low, close, volume = 1000], i) => ({
    date: `2026-01-${String(i + 1).padStart(3, "0")}`,
    open: i === 0 ? close : points[i - 1][2],
    high, low, close, volume, openInterest: null,
  }));
}

/** A steady trend from `from` to `to` over `n` bars with a ±`spread` daily range. */
function trend(n: number, from: number, to: number, volume = 1000, spread = 0.01): Array<[number, number, number, number]> {
  return Array.from({ length: n }, (_, i) => {
    const c = from + ((to - from) * i) / Math.max(1, n - 1);
    return [c * (1 + spread), c * (1 - spread), c, volume];
  });
}

describe("detectDarvas", () => {
  const box: Array<[number, number, number]> = [
    [105, 100, 103], [104, 99, 101], [103, 97, 98], [102, 95, 97],
    [101, 96, 99], [102, 97, 100], [103, 98, 101], [102.5, 98, 100],
  ];

  it("matches a confirmed box topped by a new 52-week high", () => {
    const result = detectDarvas(series([...trend(250, 50, 100), ...box]));
    expect(result.matched).toBe(true);
    expect(result.entryTrigger).toBe(105.01);
    expect(result.score).toBe(1);
    // Stop one tick under the box bottom, trailed along the box bottom.
    expect(result.exit).toEqual({ stop: 94.99, target: null, trail: 94.99, maxRisk: 0.15, scaleOutFraction: 0.5 });
  });

  it("rejects a box below an earlier 52-week high", () => {
    const bars = trend(250, 50, 100);
    bars[100] = [130, 70, 75, 1000];
    const result = detectDarvas(series([...bars, ...box]));
    expect(result.matched).toBe(false);
    expect(result.note).toMatch(/52-week high/);
  });

  it("voids a box whose bottom is broken after it was set", () => {
    const broken: Array<[number, number, number]> = [...box, [101, 93, 94], [99, 92, 95], [100, 94, 97], [101, 95, 98]];
    const result = detectDarvas(series([...trend(250, 50, 100), ...broken]));
    expect(result.matched).toBe(false);
    expect(result.note).toMatch(/box bottom/);
  });

  it("needs three sessions holding above the box bottom", () => {
    const result = detectDarvas(series([...trend(250, 50, 100), ...box.slice(0, 5)]));
    expect(result.matched).toBe(false);
  });
});

describe("detectQullamaggie", () => {
  // Flat base, a 40% move on heavy volume, then a shallow consolidation on light
  // volume — on a volatile stock (±2.5% sessions, ~5% average daily range).
  const base = trend(70, 50, 50, 1000, 0.025);
  const move = trend(20, 50, 70, 2000, 0.025);
  // Twelve sessions: the first six set the low, the last six hold higher lows in a
  // narrower range.
  const flag: Array<[number, number, number, number]> = [
    [70.2, 67.4, 68.6], [69.9, 67.1, 68.4], [69.6, 66.8, 68.8], [69.8, 67.0, 69.0],
    [70.0, 67.2, 69.2], [70.1, 67.3, 69.4],
    [70.3, 67.5, 69.5], [70.3, 67.6, 69.6], [70.4, 67.7, 69.8], [70.4, 67.7, 69.9],
    [70.5, 67.8, 70.0], [70.5, 67.9, 70.2],
  ].map(([h, l, c]) => [h, l, c, 600]);

  it("matches a big prior move followed by an orderly, quiet consolidation", () => {
    const result = detectQullamaggie(series([...base, ...move, ...flag]));
    expect(result.note).toMatch(/prior move/);
    expect(result.matched).toBe(true);
    expect(result.entryTrigger).toBe(71.75);
    // Stop one ATR under the entry, never below the consolidation low; trail the 10-day EMA.
    expect(result.exit!.stop).toBeGreaterThanOrEqual(66.8);
    expect(result.exit!.stop).toBeLessThan(71.75);
    expect(result.exit!.target).toBeNull();
    expect(result.exit!.trail).toBeGreaterThanOrEqual(result.exit!.stop);
  });

  it("rejects a consolidation without a 30% prior move", () => {
    const small = trend(20, 60, 70, 2000, 0.025);
    const result = detectQullamaggie(series([...trend(70, 60, 60, 1000, 0.025), ...small, ...flag]));
    expect(result.matched).toBe(false);
  });

  it("rejects a quiet stock with a narrow daily range", () => {
    const quiet = series([...trend(70, 50, 50, 1000), ...trend(20, 50, 70, 2000), ...flag]);
    const result = detectQullamaggie(quiet);
    expect(result.matched).toBe(false);
    expect(result.note).toMatch(/Daily range/);
  });

  it("requires a top-2% momentum leader when a ranking is supplied", () => {
    const bars = series([...base, ...move, ...flag]);
    expect(detectQullamaggie(bars, 99).matched).toBe(true);
    const laggard = detectQullamaggie(bars, 90);
    expect(laggard.matched).toBe(false);
    expect(laggard.note).toMatch(/momentum leader/);
  });

  it("rejects a consolidation on rising volume", () => {
    const loud = flag.map(([h, l, c]) => [h, l, c, 5000] as [number, number, number, number]);
    const result = detectQullamaggie(series([...base, ...move, ...loud]));
    expect(result.exit).toBeNull();
    expect(result.matched).toBe(false);
  });
});

describe("detectPTJ", () => {
  it("scores a trade near the rising 200-day above one that is stretched", () => {
    const near = detectPTJ(series(trend(260, 80, 100)));
    const stretched = detectPTJ(series([...trend(250, 80, 100), ...trend(10, 101, 104)]));
    expect(near.matched).toBe(true);
    expect(stretched.matched).toBe(true);
    expect(near.score).toBeGreaterThan(stretched.score);
    expect(near.score).toBeLessThanOrEqual(1);
    expect(stretched.score).toBeGreaterThanOrEqual(0.5);
  });

  it("exits on a close through the 200-day average", () => {
    const result = detectPTJ(series(trend(260, 80, 100)));
    // Mean of the last 200 closes of a straight line is its midpoint.
    const sma200 = (80 + (20 * 60) / 259 + 100) / 2;
    expect(result.exit!.stop).toBeCloseTo(sma200, 1);
    expect(result.exit!.trail).toBe(result.exit!.stop);
    expect(result.exit!.target).toBeNull();
  });
});

describe("detectSimons", () => {
  it("targets the 20-day mean with a stop one standard deviation beyond entry", () => {
    const closes = [...Array(19).fill(100).map((c, i) => c + (i % 2 ? 1 : -1)), 90];
    // 200 earlier sessions at 60 keep the dip above the 200-day average.
    const result = detectSimons(series([...Array(200).fill(60), 100, ...closes].map((c) => [c * 1.01, c * 0.99, c])));
    expect(result.matched).toBe(true);
    expect(result.direction).toBe("LONG");
    const m = closes.reduce((a, b) => a + b, 0) / 20;
    const sd = Math.sqrt(closes.reduce((a, b) => a + (b - m) ** 2, 0) / 19);
    expect(result.exit).toEqual({ stop: Math.round((90 - sd) * 100) / 100, target: Math.round(m * 100) / 100, trail: Math.round((90 - sd) * 100) / 100, maxRisk: 0.15, scaleOutFraction: 1 });
  });

  it("does not fade an extreme against the 200-day trend or without the history to judge it", () => {
    const closes = [...Array(19).fill(100).map((c, i) => c + (i % 2 ? 1 : -1)), 90];
    const toBars = (values: number[]) => series(values.map((c) => [c * 1.01, c * 0.99, c]));
    const downtrend = detectSimons(toBars([...Array(200).fill(140), 100, ...closes]));
    expect(downtrend.matched).toBe(false);
    expect(downtrend.note).toMatch(/against the 200-day trend/);
    expect(detectSimons(toBars([100, ...closes])).matched).toBe(false);
  });

  it("rejects an extreme whose one-sigma stop is wider than 15% of price", () => {
    const closes = [...Array(19).fill(100).map((c, i) => c + (i % 2 ? 1 : -1)), 40];
    const result = detectSimons(series([...Array(200).fill(20), 100, ...closes].map((c) => [c * 1.01, c * 0.99, c])));
    expect(result.matched).toBe(false);
    expect(result.note).toMatch(/collapse or unadjusted/);
  });
});

describe("detectMinervini", () => {
  it("requires enough history for the 200-day average a month ago", () => {
    const result = detectMinervini(series(trend(215, 50, 100)));
    expect(result.matched).toBe(false);
    expect(result.note).toMatch(/222 bars/);
  });
});

describe("relativeStrengthRatings", () => {
  it("percentile-ranks the weighted 12-month performance from 1 to 99", () => {
    const ratings = relativeStrengthRatings(new Map([
      ["weak", { c0: 80, c63: 100, c126: 100, c189: 100, c252: 100 }],
      ["flat", { c0: 100, c63: 100, c126: 100, c189: 100, c252: 100 }],
      ["strong", { c0: 150, c63: 100, c126: 100, c189: 100, c252: 100 }],
    ]));
    expect(Object.fromEntries(ratings)).toEqual({ weak: 1, flat: 50, strong: 99 });
  });

  it("weights the latest quarter double and reweights shorter histories", () => {
    const ratings = relativeStrengthRatings(new Map([
      // Recent quarter strong, older quarters flat → beats an equal but older gain.
      ["recent", { c0: 120, c63: 100, c126: 120, c189: 120, c252: 120 }],
      ["older", { c0: 120, c63: 120, c126: 120, c189: 120, c252: 100 }],
      ["young", { c0: 110, c63: 100, c126: null, c189: null, c252: null }],
      ["new", { c0: 110, c63: null, c126: null, c189: null, c252: null }],
    ]));
    expect(ratings.get("recent")).toBeGreaterThan(ratings.get("older")!);
    expect(ratings.has("young")).toBe(true);
    expect(ratings.has("new")).toBe(false);
  });
});

describe("detectMinervini VCP", () => {
  // A stage-2 uptrend into 150, then three pullbacks of 12%, 6% and 3% back to the
  // 150 pivot, the last on light volume.
  const leg = (from: number, to: number, n: number, volume: number) => trend(n, from, to, volume).slice(1);
  const uptrend = trend(260, 60, 150, 1000);
  const base = [
    ...leg(150, 132, 8, 1000), ...leg(132, 149, 8, 900),
    ...leg(149, 140, 6, 800), ...leg(140, 149.5, 6, 700),
    ...leg(149.5, 145, 5, 400), ...leg(145, 148, 5, 400),
  ];

  it("matches narrowing contractions on drying volume near the pivot", () => {
    const result = detectMinervini(series([...uptrend, ...base]), 90);
    expect(result.note).toMatch(/8\/8/);
    expect(result.matched).toBe(true);
    expect(result.entryTrigger).toBeGreaterThan(148);
    // Stop under the final contraction low, never more than 8% below the pivot.
    expect(result.exit!.stop).toBeLessThan(145);
    expect(result.exit!.stop).toBeGreaterThanOrEqual(result.entryTrigger! * 0.92 - 0.01);
  });

  it("rejects a base whose final contraction is on heavy volume", () => {
    const loud = base.map(([h, l, c], i) => [h, l, c, i >= base.length - 9 ? 3000 : 1000] as [number, number, number, number]);
    expect(detectMinervini(series([...uptrend, ...loud]), 90).matched).toBe(false);
  });

  it("rejects a stock more than 5% beyond the pivot", () => {
    const run = [...base, ...leg(148, 165, 6, 400)];
    expect(detectMinervini(series([...uptrend, ...run]), 90).matched).toBe(false);
  });

  it("judges demand on the pivot-crossing bar rather than the later hold bar", () => {
    const highBreakoutQuietHold = [...base, [152, 149, 151, 2_000], [152, 150, 151, 100]] as Array<[number, number, number, number]>;
    expect(detectMinervini(series([...uptrend, ...highBreakoutQuietHold]), 90).matched).toBe(true);

    const weakBreakoutLoudHold = [...base, [152, 149, 151, 100], [152, 150, 151, 2_000]] as Array<[number, number, number, number]>;
    expect(detectMinervini(series([...uptrend, ...weakBreakoutLoudHold]), 90).matched).toBe(false);
  });
});

describe("evaluateLegendary", () => {
  it("does not tag a plan whose stop rounds onto its entry", () => {
    // An untraded "consolidation" of flat bars pinned at the high: stop = entry.
    const flat = Array.from({ length: 10 }, () => [74.2, 74.2, 74.2, 600] as [number, number, number, number]);
    const bars = series([...trend(70, 50, 50, 1000, 0.06), ...trend(20, 50, 70, 2000, 0.06), ...flat]);
    const result = evaluateLegendary(bars);
    expect(result.results.find((r) => r.key === "QULLAMAGGIE")!.matched).toBe(true);
    expect(result.tags).not.toContain("QULLAMAGGIE");
  });
});

describe("momentumLeaderPercentiles", () => {
  it("scores each asset by its best percentile across 1, 3 and 6 months", () => {
    const pct = momentumLeaderPercentiles(new Map([
      ["monthLeader", { c0: 130, c21: 100, c63: 125, c126: 125 }],
      ["halfYearLeader", { c0: 200, c21: 195, c63: 190, c126: 100 }],
      ["laggard", { c0: 100, c21: 102, c63: 105, c126: 110 }],
    ]));
    expect(pct.get("monthLeader")).toBe(100);
    expect(pct.get("halfYearLeader")).toBe(100);
    expect(pct.get("laggard")).toBe(0);
  });
});

describe("strategyTradeLevels", () => {
  const setup: SwingSetup = {
    currentPrice: 98, atr: 2, longTrigger: 101, shortTrigger: 95, hh22: 100, ll22: 90, dailyVelocity: 1,
  };

  it("uses the strategy's stop and trail with the user's R multiple as the first target", () => {
    const lv = strategyTradeLevels(setup, { score: 1, dir: "LONG", entry: 100, stop: 94, target: null, trail: 96 }, DEFAULT_RISK);
    expect(lv).toMatchObject({ entry: 100, stopLoss: 94, target: 112, trailingStop: 96, riskRewardRatio: 2, expectedDays: 12 });
  });

  it("keeps the strategy's own target", () => {
    const lv = strategyTradeLevels(setup, { score: 1, dir: "LONG", entry: 98, stop: 96, target: 103, trail: 96 }, DEFAULT_RISK);
    expect(lv).toMatchObject({ entry: 98, stopLoss: 96, target: 103, riskRewardRatio: 2.5 });
  });

  it("rebases the entry to a live price above the trigger and keeps the structural stop", () => {
    const lv = strategyTradeLevels({ ...setup, currentPrice: 102 }, { score: 1, dir: "LONG", entry: 100, stop: 94, target: null, trail: 96 }, DEFAULT_RISK);
    expect(lv).toMatchObject({ entry: 102, stopLoss: 94, target: 118 });
  });

  it("falls back to the ATR plan for records without an exit or with a crossed stop", () => {
    const atr = strategyTradeLevels(setup, { score: 1, dir: "LONG", entry: 100 }, DEFAULT_RISK);
    expect(atr).toMatchObject({ entry: 100, stopLoss: 97, target: 106 });
    const crossed = strategyTradeLevels({ ...setup, currentPrice: 90 }, { score: 1, dir: "SHORT", entry: 92, stop: 89, target: null, trail: 89 }, DEFAULT_RISK);
    expect(crossed.stopLoss).toBe(93);
  });

  it("mirrors levels for a short", () => {
    const lv = strategyTradeLevels(setup, { score: 1, dir: "SHORT", entry: 95, stop: 100, target: 88, trail: 99 }, DEFAULT_RISK);
    expect(lv).toMatchObject({ direction: "SHORT", entry: 95, stopLoss: 100, target: 88, trailingStop: 99 });
  });
});

describe("detectMinervini relative strength", () => {
  // A long, steady uptrend passes every price/average criterion of the Trend Template.
  const bars = series(trend(300, 50, 150));

  it("uses the cross-sectional RS rating when one is supplied", () => {
    expect(detectMinervini(bars, 85).note).toMatch(/Trend Template 8\/8|8\/8/);
    expect(detectMinervini(bars, 40).note).toMatch(/Trend Template 7\/8/);
  });
});

describe("breakout day, risk limits and liquidity", () => {
  const base = trend(70, 50, 50, 1000, 0.025);
  const move = trend(20, 50, 70, 2000, 0.025);
  const flag: Array<[number, number, number, number]> = [
    [70.2, 67.4, 68.6], [69.9, 67.1, 68.4], [69.6, 66.8, 68.8], [69.8, 67.0, 69.0],
    [70.0, 67.2, 69.2], [70.1, 67.3, 69.4],
    [70.3, 67.5, 69.5], [70.3, 67.6, 69.6], [70.4, 67.7, 69.8], [70.4, 67.7, 69.9],
    [70.5, 67.8, 70.0], [70.5, 67.9, 70.2],
  ].map(([h, l, c]) => [h, l, c, 600]);
  const qulla = (bars: OHLCV[]) => withBreakoutDay(bars, (s) => detectQullamaggie(s), { stopAtBreakoutLow: true });

  it("reports the Qullamaggie breakout on the day it happens, with its volume", () => {
    const strong = qulla(series([...base, ...move, ...flag, [73.5, 70.6, 73.2, 4000]]));
    expect(strong).toMatchObject({ matched: true, triggered: true, breakoutConfirmed: true, entryTrigger: 71.75 });
    expect(strong.breakoutVolumeRatio).toBeGreaterThanOrEqual(1.5);
    // The stop moves up to the low of the breakout day.
    expect(strong.exit!.stop).toBe(70.6);

    const quiet = qulla(series([...base, ...move, ...flag, [73.5, 70.6, 73.2, 700]]));
    expect(quiet).toMatchObject({ matched: true, triggered: true, breakoutConfirmed: false });
    const failed = qulla(series([...base, ...move, ...flag, [73.5, 70.6, 71, 4000]]));
    expect(failed).toMatchObject({ triggered: true, breakoutConfirmed: false });
  });

  it("carries the breakout state into the stored score", () => {
    const result = evaluateLegendary(series([...base, ...move, ...flag, [73.5, 70.6, 73.2, 4000]]));
    expect(result.scores.QULLAMAGGIE).toMatchObject({ triggered: true, confirmed: true, entry: 71.75 });
  });

  it("tags nothing below the liquidity floor", () => {
    const bars = series([...base, ...move, ...flag]);
    expect(evaluateLegendary(bars).tags).toContain("QULLAMAGGIE");
    expect(evaluateLegendary(bars, { minTradedValue: 10_000_000 }).tags).toEqual([]);
  });

  it("rejects a Darvas box whose bottom is more than 15% under the entry", () => {
    const wide: Array<[number, number, number]> = [
      [105, 100, 103], [104, 92, 95], [100, 84, 86], [95, 82, 90],
      [96, 85, 93], [98, 86, 95], [99, 88, 96], [99.5, 89, 97],
    ];
    const result = detectDarvas(series([...trend(250, 50, 100), ...wide]));
    expect(result.matched).toBe(false);
    expect(result.note).toMatch(/too wide/);
  });

  it("puts the Darvas entry and stop on the exchange tick", () => {
    const box: Array<[number, number, number]> = [
      [105.02, 100, 103], [104, 99, 101], [103, 97, 98], [102, 95.03, 97],
      [101, 96, 99], [102, 97, 100], [103, 98, 101], [102.5, 98, 100],
    ];
    const result = detectDarvas(series([...trend(250, 50, 100), ...box]), 0.05);
    expect(result.entryTrigger).toBe(105.1);
    expect(result.exit!.stop).toBe(94.95);
  });

  it("measures the PTJ 15% limit from the entry, where the 200-day stop will sit", () => {
    // Close 13% above the 200-day, but the 10-session high is far enough above to break 15%.
    const steady = trend(230, 100, 110, 1000, 0.005);
    const bars = series([...steady.slice(0, -1), [150, 108, 112.5, 1000]]);
    const result = detectPTJ(bars);
    expect(result.matched).toBe(false);
    expect(result.note).toMatch(/over-extended/);
  });

  it("tightens a strategy stop to its risk limit when the entry has moved up", () => {
    const setup: SwingSetup = { currentPrice: 105, atr: 2, longTrigger: 100, shortTrigger: 90, hh22: 106, ll22: 90, dailyVelocity: 1 };
    const levels = strategyTradeLevels(setup, { score: 1, dir: "LONG", entry: 100, stop: 92, trail: 95, maxRisk: 0.08 }, DEFAULT_RISK);
    expect(levels.entry).toBe(105);
    expect(levels.stopLoss).toBe(96.6);
    const uncapped = strategyTradeLevels(setup, { score: 1, dir: "LONG", entry: 100, stop: 92, trail: 95 }, DEFAULT_RISK);
    expect(uncapped.stopLoss).toBe(92);
  });
});

describe("strategyFollowUp", () => {
  const rising = series(trend(260, 50, 150));

  it("gives each trend strategy its author's line from completed bars", () => {
    const closes = rising.map((bar) => bar.close);
    const sma = (n: number) => Math.round((closes.slice(-n).reduce((a, b) => a + b, 0) / n) * 100) / 100;
    expect(strategyFollowUp("MINERVINI", rising, "2026-01-200")).toMatchObject({ line: sma(50), lineLabel: "50-day average" });
    expect(strategyFollowUp("PTJ", rising, "2026-01-200")).toMatchObject({ line: sma(200), lineLabel: "200-day average" });
    const qulla = strategyFollowUp("QULLAMAGGIE", rising, "2026-01-200");
    expect(qulla.lineLabel).toBe("10-day EMA");
    expect(qulla.line!).toBeGreaterThan(sma(50));
    expect(qulla.line!).toBeLessThan(closes.at(-1)!);
  });

  it("moves a mean-reversion target to the current 20-day mean and leaves the stop alone", () => {
    const result = strategyFollowUp("SIMONS", rising, "2026-01-200");
    const closes = rising.map((bar) => bar.close);
    expect(result.line).toBeNull();
    expect(result.target).toBe(Math.round((closes.slice(-20).reduce((a, b) => a + b, 0) / 20) * 100) / 100);
  });

  it("confirms PTJ close exits on the correct side for long and short trades", () => {
    const bars = rising.map((bar) => ({ ...bar }));
    const mean = bars.slice(-200).reduce((sum, bar) => sum + bar.close, 0) / 200;
    bars[bars.length - 1].close = mean - 20;
    expect(strategyFollowUp("PTJ", bars, "2026-01-200", 0.05, "LONG").closeExitConfirmed).toBe(true);
    expect(strategyFollowUp("PTJ", bars, "2026-01-200", 0.05, "SHORT").closeExitConfirmed).toBe(false);
    bars[bars.length - 1].close = mean + 20;
    expect(strategyFollowUp("PTJ", bars, "2026-01-200", 0.05, "SHORT").closeExitConfirmed).toBe(true);
  });

  it("leaves strategies without a line of their own on the ledger's default trail", () => {
    expect(strategyFollowUp("DEFAULT_SWING", rising, "2026-01-200")).toEqual({ line: null, lineLabel: null, target: null, closeExitConfirmed: false });
    expect(strategyFollowUp("PTJ", rising.slice(-50), "2026-01-200").line).toBeNull();
  });

  it("raises a Darvas stop to the bottom of each new box and never lowers it", () => {
    // Box one: high 110, low 104 held for three sessions. Then a higher box: high 120, low 113.
    const bars = series([
      [110, 106, 108], [109, 105, 106], [108, 104, 105], [108, 104.5, 106], [109, 105, 107], [109.5, 105.5, 108],
      [120, 109, 118], [119, 115, 116], [118, 113, 114], [118, 113.5, 115], [119, 114, 116], [119.5, 114.5, 117],
    ]).map((bar, index) => ({ ...bar, date: `2026-03-${String(index + 1).padStart(2, "0")}` }));
    expect(darvasTrailingBottom(bars.slice(0, 6))).toBe(103.99);
    expect(darvasTrailingBottom(bars)).toBe(112.99);
    expect(darvasTrailingBottom(bars, 0.05)).toBe(112.95);
    expect(darvasTrailingBottom(bars.slice(0, 3))).toBeNull();
    // Only bars after the purchase day build boxes.
    expect(strategyFollowUp("DARVAS", bars, bars[5].date).line).toBe(112.99);
    expect(strategyFollowUp("DARVAS", bars, bars[11].date).line).toBeNull();
  });
});
