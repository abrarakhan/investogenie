import { describe, expect, it } from "vitest";
import { selectAdaptiveAllocationPair, type AdaptiveSelectionCandidate } from "./adaptiveAllocationSelection";

const candidate = (
  ticker: string,
  sector: string,
  liquidityRank: number,
  dailyReturn: (index: number) => number,
): AdaptiveSelectionCandidate => {
  let close = 100;
  return {
    id: ticker,
    ticker,
    name: ticker,
    exchange: "TEST",
    sector,
    liquidityRank,
    prices: Array.from({ length: 200 }, (_, index) => {
      close *= 1 + dailyReturn(index);
      return { date: new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10), close };
    }),
  };
};

describe("adaptive allocation pair selection", () => {
  it("selects the more diversified cross-sector pair", () => {
    const alpha = candidate("ALPHA", "Tech", 1, (index) => index % 2 ? 0.01 : -0.008);
    const clone = candidate("CLONE", "Tech", 2, (index) => index % 2 ? 0.009 : -0.007);
    const hedge = candidate("HEDGE", "Energy", 3, (index) => index % 2 ? -0.006 : 0.009);
    const result = selectAdaptiveAllocationPair([alpha, clone, hedge]);
    expect([result.assetA.ticker, result.assetB.ticker]).toEqual(["ALPHA", "HEDGE"]);
    expect(result.correlation).toBeLessThan(0);
  });

  it("fails closed when candidates lack sufficient common history", () => {
    const short = candidate("SHORT", "Tech", 1, () => 0.001);
    short.prices = short.prices.slice(0, 50);
    const other = candidate("OTHER", "Finance", 2, () => 0.001);
    expect(() => selectAdaptiveAllocationPair([short, other])).toThrow(/126 clean common sessions/);
  });
});
