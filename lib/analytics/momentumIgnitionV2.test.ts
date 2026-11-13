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

function compressedBase(): OHLCV[] {
  const history = bars();
  const start = history.length - 12;
  const base = history[start - 1].close;
  for (let index = start; index < history.length; index++) {
    const close = base + ((index - start) % 3) * 0.03;
    history[index] = {
      ...history[index], open: close - 0.08, high: close + 0.32,
      low: close - 0.32, close, volume: 600_000,
    };
  }
  return history;
}

describe("Momentum Ignition V2", () => {
  it("uses a one-session plan for a clean first thrust", () => {
    const history = compressedBase();
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

  it("keeps a genuine day-two continuation eligible", () => {
    const history = compressedBase();
    const preview = assessMomentumIgnitionV2({
      currentPrice: history.at(-2)!.close,
      bars: history.slice(0, -1),
      benchmarkBars: benchmark().slice(0, -1),
    });
    const dayOne = preview.entryTrigger + preview.atr14 * 0.12;
    history[history.length - 2] = {
      ...history.at(-2)!, open: dayOne - 0.45, high: dayOne + 0.18,
      low: dayOne - 0.7, close: dayOne, volume: 2_400_000,
    };
    const dayTwo = dayOne + preview.atr14 * 0.18;
    history[history.length - 1] = {
      ...history.at(-1)!, open: dayOne + preview.atr14 * 0.05, high: dayTwo + preview.atr14 * 0.02,
      low: dayOne + preview.atr14 * 0.03, close: dayTwo, volume: 2_200_000,
    };
    const result = assessMomentumIgnitionV2({ currentPrice: dayTwo, bars: history, benchmarkBars: benchmark() });
    expect(result.breakoutAgeSessions).toBe(1);
    expect(result.status).toBe("MOMENTUM_READY");
  });

  it("does not re-arm a mature staircase when it prints another rolling high", () => {
    const history = compressedBase();
    const preview = assessMomentumIgnitionV2({
      currentPrice: history.at(-8)!.close,
      bars: history.slice(0, -7),
      benchmarkBars: benchmark().slice(0, -7),
    });
    const anchor = preview.entryTrigger + preview.atr14 * 0.12;
    for (let offset = 0; offset < 7; offset++) {
      const index = history.length - 7 + offset;
      const close = anchor + preview.atr14 * (0.25 + offset * 0.42);
      history[index] = {
        ...history[index], open: close - preview.atr14 * 0.25,
        high: close + preview.atr14 * 0.12, low: close - preview.atr14 * 0.32,
        close, volume: 2_000_000 + offset * 100_000,
      };
    }
    const current = history.at(-1)!.close;
    const result = assessMomentumIgnitionV2({ currentPrice: current, bars: history, benchmarkBars: benchmark() });
    expect(result.breakoutAgeSessions).toBeGreaterThan(2);
    expect(result.status).toBe("LATE_PROFIT_BOOKING");
    expect(result.timingReasons.join(" ")).toContain("original breakout");
    expect(result.status).not.toBe("MOMENTUM_READY");
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
