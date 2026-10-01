import { describe, expect, it } from "vitest";
import { assessMomentumIgnitionV2 } from "./momentumIgnitionV2";
import type { OHLCV } from "@/lib/types";

function bars(count = 240): OHLCV[] {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index * 0.18;
    return {
      date: new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10),
      open: close - 0.2,
      high: close + 0.6,
      low: close - 0.6,
      close,
      volume: 1_000_000,
      openInterest: null,
    };
  });
}

function benchmark(count = 240): OHLCV[] {
  return bars(count).map((bar, index) => ({
    ...bar,
    open: 100 + index * 0.04,
    high: 100.4 + index * 0.04,
    low: 99.6 + index * 0.04,
    close: 100 + index * 0.04,
    volume: 10_000_000,
  }));
}

describe("Momentum Ignition V2", () => {
  it("uses a one-session plan for a clean first thrust", () => {
    const history = bars();
    const preview = assessMomentumIgnitionV2({
      currentPrice: history.at(-1)!.close,
      bars: history,
      benchmarkBars: benchmark(),
    });
    const price = preview.entryTrigger + preview.atr14 * 0.1;
    history[history.length - 1] = {
      ...history.at(-1)!,
      open: price - 0.5,
      high: price * 1.001,
      low: price - 1,
      close: price,
      volume: 2_500_000,
    };
    const result = assessMomentumIgnitionV2({ currentPrice: price, bars: history, benchmarkBars: benchmark() });
    expect(["FIRST_THRUST", "MOMENTUM_READY"]).toContain(result.status);
    expect(result.shortHorizonDays).toBe(1);
    expect(result.shortHorizonTargetPct).toBeLessThanOrEqual(5);
  });

  it("labels a breakout with nearby historical resistance as late", () => {
    const history = bars();
    const latestIndex = history.length - 1;
    history[latestIndex - 12] = { ...history[latestIndex - 12], high: 151 };
    history[latestIndex - 11] = { ...history[latestIndex - 11], high: 149 };
    history[latestIndex] = {
      ...history[latestIndex],
      open: 145,
      low: 144,
      high: 150,
      close: 148,
      volume: 2_500_000,
    };
    const result = assessMomentumIgnitionV2({ currentPrice: 148, bars: history, benchmarkBars: benchmark() });
    expect(result.resistanceHeadroomPct).not.toBeNull();
    expect(result.resistanceHeadroomPct!).toBeLessThan(5);
    expect(result.status).not.toBe("MOMENTUM_READY");
  });

  it("does not alter the legacy assessment retained for audit", () => {
    const history = bars();
    const result = assessMomentumIgnitionV2({
      currentPrice: history.at(-1)!.close,
      bars: history,
      benchmarkBars: benchmark(),
    });
    expect(result.legacyStatus).toBeTruthy();
    expect(result.gates.some((item) => item.key === "liquidity")).toBe(true);
  });
});
