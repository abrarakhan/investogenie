import { describe, expect, it } from "vitest";
import type { OHLCV } from "@/lib/types";
import {
  detectDarvas, detectMinervini, detectPTJ, detectQullamaggie, detectSimons, evaluateLegendary,
  momentumLeaderPercentiles, relativeStrengthRatings, strategyTradeLevels,
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
    expect(result.exit).toEqual({ stop: 94.99, target: null, trail: 94.99 });
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
  const flag: Array<[number, number, number, number]> = [
    [70.2, 67.5, 68], [69.5, 67, 67.8], [69, 66.8, 68.2], [69.4, 67.6, 68.6],
    [69.6, 68, 69], [69.8, 68.4, 69.3],
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
    const result = detectSimons(series([100, ...closes].map((c) => [c * 1.01, c * 0.99, c])));
    expect(result.matched).toBe(true);
    expect(result.direction).toBe("LONG");
    const m = closes.reduce((a, b) => a + b, 0) / 20;
    const sd = Math.sqrt(closes.reduce((a, b) => a + (b - m) ** 2, 0) / 19);
    expect(result.exit).toEqual({ stop: Math.round((90 - sd) * 100) / 100, target: Math.round(m * 100) / 100, trail: Math.round((90 - sd) * 100) / 100 });
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
});

describe("evaluateLegendary", () => {
  it("does not tag a plan whose stop rounds onto its entry", () => {
    // An untraded "consolidation" of flat bars pinned at the high: stop = entry.
    const flat = Array.from({ length: 4 }, () => [74.2, 74.2, 74.2, 600] as [number, number, number, number]);
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
