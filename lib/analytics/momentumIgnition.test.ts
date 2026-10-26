import { describe, expect, it } from "vitest";
import { assessMomentumIgnition, observedTradingSessionDistance } from "./momentumIgnition";
import type { OHLCV } from "@/lib/types";

function momentumBars(count = 240): OHLCV[] {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index * 0.25;
    const nearEnd = index >= count - 5;
    const accumulation = index === count - 9 || index === count - 7;
    return {
      date: new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10),
      open: close - 0.15,
      high: close + (nearEnd ? 0.35 : 1.5),
      low: close - (nearEnd ? 0.35 : 1.5),
      close,
      volume: accumulation ? 1_500_000 : nearEnd ? 600_000 : 1_000_000,
      openInterest: null,
    };
  });
}

function benchmark(count = 240): OHLCV[] {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index * 0.08;
    return {
      date: new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10),
      open: close - 0.2,
      high: close + 0.5,
      low: close - 0.5,
      close,
      volume: 10_000_000,
      openInterest: null,
    };
  });
}

function businessDates(count: number, end: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${end}T00:00:00Z`);
  while (dates.length < count) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return dates.reverse();
}

describe("Momentum Ignition", () => {
  it("treats Friday-to-Monday as one observed trading session", () => {
    const stock = [
      { ...momentumBars(1)[0], date: "2026-10-09" },
      { ...momentumBars(1)[0], date: "2026-10-12" },
    ];
    const index = [{ ...benchmark(1)[0], date: "2026-10-09" }];
    expect(observedTradingSessionDistance("2026-10-12", "2026-10-09", stock, index)).toBe(1);
  });

  it("rejects a benchmark that is two observed sessions behind", () => {
    const stock = [
      { ...momentumBars(1)[0], date: "2026-10-09" },
      { ...momentumBars(1)[0], date: "2026-10-12" },
      { ...momentumBars(1)[0], date: "2026-10-13" },
    ];
    const index = [{ ...benchmark(1)[0], date: "2026-10-09" }];
    expect(observedTradingSessionDistance("2026-10-13", "2026-10-09", stock, index)).toBe(2);
  });

  it("keeps the established-stock freshness gate valid from Friday to Monday", () => {
    const stock = momentumBars();
    const index = benchmark();
    const stockDates = businessDates(stock.length, "2026-10-26");
    const benchmarkDates = businessDates(index.length, "2026-10-23");
    stock.forEach((bar, i) => { bar.date = stockDates[i]; });
    index.forEach((bar, i) => { bar.date = benchmarkDates[i]; });
    const result = assessMomentumIgnition({
      currentPrice: stock.at(-1)!.close,
      bars: stock,
      benchmarkBars: index,
    });
    expect(result.gates.find((item) => item.key === "freshness")?.passed).toBe(true);
  });

  it("finds a liquid trend leader approaching its breakout", () => {
    const bars = momentumBars();
    const result = assessMomentumIgnition({
      currentPrice: bars.at(-1)!.close,
      bars,
      benchmarkBars: benchmark(),
    });
    expect(result.status).toBe("EARLY_WATCH");
    expect(result.qualifies).toBe(true);
    expect(result.distanceToBreakoutPct).toBeGreaterThanOrEqual(0);
  });

  it("promotes a high-volume breakout inside the entry zone", () => {
    const bars = momentumBars();
    bars[bars.length - 1].volume = 2_500_000;
    const preview = assessMomentumIgnition({ currentPrice: bars.at(-1)!.close, bars, benchmarkBars: benchmark() });
    const result = assessMomentumIgnition({
      currentPrice: preview.entryTrigger + preview.atr14 * 0.2,
      bars,
      benchmarkBars: benchmark(),
    });
    expect(result.status).toBe("ENTRY_READY");
    expect(result.projectedVolumeRatio).toBeGreaterThanOrEqual(1.5);
  });

  it("does not re-label an extended breakout as a fresh entry", () => {
    const bars = momentumBars();
    bars[bars.length - 1].volume = 2_500_000;
    const preview = assessMomentumIgnition({ currentPrice: bars.at(-1)!.close, bars, benchmarkBars: benchmark() });
    const result = assessMomentumIgnition({
      currentPrice: preview.entryTrigger + preview.atr14,
      bars,
      benchmarkBars: benchmark(),
    });
    expect(result.status).toBe("WAIT_FOR_PULLBACK");
    expect(result.entryExtensionAtr).toBeGreaterThan(0.5);
  });

  it("surfaces a volatile breakout for pullback review without calling it entry ready", () => {
    const bars = momentumBars().map((bar, index, all) => index >= all.length - 20
      ? { ...bar, high: bar.close + 10, low: bar.close - 10, volume: index === all.length - 1 ? 2_500_000 : bar.volume }
      : bar);
    const preview = assessMomentumIgnition({ currentPrice: bars.at(-1)!.close, bars, benchmarkBars: benchmark() });
    const result = assessMomentumIgnition({
      currentPrice: preview.entryTrigger + preview.atr14 * 0.2,
      bars,
      benchmarkBars: benchmark(),
    });
    expect(result.qualifies).toBe(true);
    expect(result.status).toBe("WAIT_FOR_PULLBACK");
    expect(result.gates.find((item) => item.key === "volatility")?.passed).toBe(false);
  });

  it("rejects an otherwise attractive but illiquid stock", () => {
    const bars = momentumBars().map((bar) => ({ ...bar, volume: 100 }));
    const result = assessMomentumIgnition({
      currentPrice: bars.at(-1)!.close,
      bars,
      benchmarkBars: benchmark(),
    });
    expect(result.qualifies).toBe(false);
    expect(result.gates.find((item) => item.key === "liquidity")?.passed).toBe(false);
  });

  it("detects a liquid recent listing without requiring 200 sessions", () => {
    const bars = momentumBars(60).slice(-24).map((bar, index) => ({
      ...bar,
      close: 100 + index * 1.5,
      open: 99.5 + index * 1.5,
      high: 101 + index * 1.5,
      low: 99 + index * 1.5,
      volume: index === 23 ? 3_000_000 : 1_000_000,
    }));
    const result = assessMomentumIgnition({
      currentPrice: bars.at(-1)!.close,
      bars,
      benchmarkBars: benchmark(60),
    });
    expect(result.modelType).toBe("NEW_LISTING");
    expect(result.tradingSessions).toBe(24);
    expect(result.gates.find((item) => item.key === "trend")?.passed).toBe(true);
  });

  it("keeps a circuit-prone recent listing out of entry ready", () => {
    const bars = momentumBars(60).slice(-24).map((bar, index) => {
      const close = 100 * Math.pow(1.1, Math.max(0, index - 20));
      return { ...bar, open: close, high: close, low: close, close, volume: 2_000_000 };
    });
    const result = assessMomentumIgnition({ currentPrice: bars.at(-1)!.close, bars, benchmarkBars: benchmark(60) });
    expect(result.modelType).toBe("NEW_LISTING");
    expect(result.status).not.toBe("ENTRY_READY");
    expect(result.gates.find((item) => item.key === "circuit")?.passed).toBe(false);
  });
});
