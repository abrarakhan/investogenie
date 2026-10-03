import { describe, expect, it } from "vitest";
import { backtestUniversalPortfolio } from "./universalPortfolio";

const points = Array.from({ length: 260 }, (_, index) => ({
  date: new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10),
  prices: [100 * Math.pow(1.001, index) * (index % 2 ? 1.02 : 0.98), 100 * Math.pow(1.0005, index) * (index % 2 ? 0.98 : 1.02)] as [number, number],
}));

describe("Universal Portfolio", () => {
  it("produces finite allocations and comparative metrics", () => {
    const result = backtestUniversalPortfolio(points, { initialCapital: 100_000, feeBps: 10, noTradeBandPct: 0.5 });
    expect(result.sessions).toBe(260);
    expect(result.latestTarget[0]).toBeGreaterThanOrEqual(0);
    expect(result.latestTarget[0]).toBeLessThanOrEqual(1);
    expect(result.universalNet.finalValue).toBeGreaterThan(0);
    expect(result.hindsightBestCrp.weightA).toBeGreaterThanOrEqual(0);
  });

  it("charges costs when rebalancing", () => {
    const free = backtestUniversalPortfolio(points, { initialCapital: 100_000, feeBps: 0, noTradeBandPct: 0 });
    const costly = backtestUniversalPortfolio(points, { initialCapital: 100_000, feeBps: 50, noTradeBandPct: 0 });
    expect(costly.universalNet.finalValue).toBeLessThan(free.universalNet.finalValue);
    expect(costly.estimatedCosts).toBeGreaterThan(0);
  });

  it("fails closed on suspicious discontinuities", () => {
    const broken = points.map((point) => ({ ...point, prices: [...point.prices] as [number, number] }));
    broken[100].prices[0] *= 0.4;
    expect(() => backtestUniversalPortfolio(broken, { initialCapital: 1, feeBps: 0, noTradeBandPct: 0 })).toThrow(/corporate-action/);
  });
});
