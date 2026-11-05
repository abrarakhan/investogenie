import { describe, expect, it } from "vitest";
import { classifySwingSetup, deriveLevels, type SwingSetup } from "@/lib/analytics/swingClassifier";
import type { OHLCV } from "@/lib/types";

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

/** Flat base, then a final-bar close above the 20-bar high. `recentVolume` sets the last five bars. */
function cashBreakout(recentVolume: number, withOi = false): OHLCV[] {
  return Array.from({ length: 80 }, (_, index) => {
    const last = index === 79;
    const close = last ? 106 : 100 + (index % 3) * 0.3;
    return {
      date: new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10),
      open: close - 0.5, high: close + 0.4, low: close - 0.8, close,
      volume: index >= 75 ? recentVolume : 1_000_000,
      openInterest: withOi ? 500_000 : null,
    };
  });
}

describe("classifySwingSetup build-up", () => {
  it("confirms a cash breakout with expanding five-session volume", () => {
    const signal = classifySwingSetup(cashBreakout(1_800_000));
    expect(signal.buildupSource).toBe("VOLUME");
    expect(signal.participationRatio).toBeCloseTo(1.8, 5);
    expect(signal.isLongBuildup).toBe(true);
    expect(signal.verdict).toBe("LONG_BREAKOUT");
    expect(signal.score).toBeCloseTo(0.75, 5); // breakout 0.35 + build-up 0.30 + volume 0.10
  });

  it("leaves a cash breakout unconfirmed when participation is not expanding", () => {
    const signal = classifySwingSetup(cashBreakout(1_100_000));
    expect(signal.isLongBuildup).toBe(false);
    expect(signal.verdict).toBe("BREAKOUT_UNCONFIRMED");
  });

  it("keeps OI authoritative where open interest exists", () => {
    // Flat OI: heavy volume alone must not confirm a derivative build-up.
    const signal = classifySwingSetup(cashBreakout(1_800_000, true));
    expect(signal.buildupSource).toBe("OI");
    expect(signal.isLongBuildup).toBe(false);
    expect(signal.verdict).toBe("BREAKOUT_UNCONFIRMED");
  });
});
