import { describe, expect, it } from "vitest";
import { deriveLevels, type SwingSetup } from "@/lib/analytics/swingClassifier";

const setup: SwingSetup = {
  currentPrice: 100,
  atr: 5,
  longTrigger: 105,
  shortTrigger: 95,
  hh22: 120,
  ll22: 80,
  dailyVelocity: 2,
};

describe("deriveLevels", () => {
  it("keeps long entry, target, stop, and risk/reward internally consistent", () => {
    const levels = deriveLevels(setup, "LONG");
    expect(levels.entry).toBe(105);
    expect(levels.stopLoss).toBe(97.5);
    expect(levels.target).toBe(120);
    expect(levels.riskRewardRatio).toBe(2);
  });

  it("retains a breached chandelier level so callers can flag it", () => {
    const levels = deriveLevels({ ...setup, currentPrice: 90 }, "LONG");
    expect(levels.trailingStop).toBe(105);
    expect(levels.trailingStop).toBeGreaterThan(levels.currentPrice);
  });
});
