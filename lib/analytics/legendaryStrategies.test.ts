import { describe, expect, it } from "vitest";
import type { OHLCV } from "@/lib/types";
import { detectDarvas, detectMinervini, detectPTJ, detectQullamaggie, relativeStrengthRatings } from "./legendaryStrategies";

/** Bars from [high, low, close, volume] tuples; open is the prior close. */
function series(points: Array<[number, number, number, number?]>): OHLCV[] {
  return points.map(([high, low, close, volume = 1000], i) => ({
    date: `2026-01-${String(i + 1).padStart(3, "0")}`,
    open: i === 0 ? close : points[i - 1][2],
    high, low, close, volume, openInterest: null,
  }));
}

/** A steady trend from `from` to `to` over `n` bars with a ±1% daily range. */
function trend(n: number, from: number, to: number, volume = 1000): Array<[number, number, number, number]> {
  return Array.from({ length: n }, (_, i) => {
    const c = from + ((to - from) * i) / Math.max(1, n - 1);
    return [c * 1.01, c * 0.99, c, volume];
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
  });

  it("rejects a box below an earlier 52-week high", () => {
    const bars = trend(250, 50, 100);
    bars[100] = [130, 70, 75, 1000];
    const result = detectDarvas(series([...bars, ...box]));
    expect(result.matched).toBe(false);
    expect(result.note).toMatch(/52-week high/);
  });

  it("needs three sessions holding above the box bottom", () => {
    const result = detectDarvas(series([...trend(250, 50, 100), ...box.slice(0, 5)]));
    expect(result.matched).toBe(false);
  });
});

describe("detectQullamaggie", () => {
  // Flat base, a 40% move on heavy volume, then a shallow consolidation on light volume.
  const base = trend(70, 50, 50, 1000);
  const move = trend(20, 50, 70, 2000);
  const flag: Array<[number, number, number, number]> = [
    [70.2, 67.5, 68], [69.5, 67, 67.8], [69, 66.8, 68.2], [69.4, 67.6, 68.6],
    [69.6, 68, 69], [69.8, 68.4, 69.3],
  ].map(([h, l, c]) => [h, l, c, 600]);

  it("matches a big prior move followed by an orderly, quiet consolidation", () => {
    const result = detectQullamaggie(series([...base, ...move, ...flag]));
    expect(result.note).toMatch(/prior move/);
    expect(result.matched).toBe(true);
    expect(result.entryTrigger).toBe(70.7);
  });

  it("rejects a consolidation without a 30% prior move", () => {
    const small = trend(20, 60, 70, 2000);
    const result = detectQullamaggie(series([...trend(70, 60, 60), ...small, ...flag]));
    expect(result.matched).toBe(false);
  });

  it("rejects a consolidation on rising volume", () => {
    const loud = flag.map(([h, l, c]) => [h, l, c, 5000] as [number, number, number, number]);
    const result = detectQullamaggie(series([...base, ...move, ...loud]));
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

describe("detectMinervini relative strength", () => {
  // A long, steady uptrend passes every price/average criterion of the Trend Template.
  const bars = series(trend(300, 50, 150));

  it("uses the cross-sectional RS rating when one is supplied", () => {
    expect(detectMinervini(bars, 85).note).toMatch(/Trend Template 8\/8|8\/8/);
    expect(detectMinervini(bars, 40).note).toMatch(/Trend Template 7\/8/);
  });
});
