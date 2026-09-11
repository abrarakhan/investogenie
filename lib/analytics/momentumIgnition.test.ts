import { describe, expect, it } from "vitest";
import { assessMomentumIgnition } from "./momentumIgnition";
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

describe("Momentum Ignition", () => {
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
});
