import { describe, expect, it } from "vitest";
import { assessStrongSwingFromBars } from "@/lib/analytics/strongSwing";
import { assessMomentumIgnition } from "@/lib/analytics/momentumIgnition";
import { assessMomentumIgnitionV2 } from "@/lib/analytics/momentumIgnitionV2";
import { runPythonStrategyBatch } from "@/lib/pythonStrategyMath";
import type { OHLCV } from "@/lib/types";

const bars = (count: number, start = 100, slope = 0.35): OHLCV[] => Array.from({ length: count }, (_, index) => {
  const close = start + index * slope + Math.sin(index / 4) * 1.2;
  return {
    date: new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10),
    open: close - 0.4,
    high: close + 1.2,
    low: close - 1.1,
    close,
    volume: 1_000_000 + index * 4_000,
    openInterest: null,
  };
});

const gateMap = (value: { gates: Array<{ key: string; passed: boolean }> }) =>
  Object.fromEntries(value.gates.map((gate) => [gate.key, gate.passed]));

describe("Python strategy authority", () => {
  it("matches the former TypeScript Strong Swing formulas", async () => {
    const stock = bars(240);
    stock.at(-2)!.close = stock.at(-2)!.high = 190;
    stock.at(-1)!.close = stock.at(-1)!.high = 194;
    stock.at(-2)!.volume = 3_000_000;
    stock.at(-1)!.volume = 3_200_000;
    const benchmark = bars(240, 200, 0.2);
    const input = { market: "IN" as const, verdict: "LONG_BREAKOUT", currentPrice: 194,
      stopAtrMult: 1.5, targetRR: 2, trailAtrMult: 3, bars: stock, benchmarkBars: benchmark,
      requireLiveExecutionData: false };
    const legacy = assessStrongSwingFromBars(input);
    const [python] = await runPythonStrategyBatch<typeof input, typeof legacy & { strongTarget: number }>("strong_swing", [input]);
    expect(python.status).toBe(legacy.status);
    expect(python.strengthScore).toBe(legacy.strengthScore);
    expect(gateMap(python)).toEqual(gateMap(legacy));
    for (const key of ["atr", "confirmationEntry", "trailingStop", "effectiveTrailingStop"] as const) {
      expect(python[key]).toBeCloseTo(legacy[key], 8);
    }
  });

  it("matches the former TypeScript Momentum legacy and V2 formulas", async () => {
    const stock = bars(240);
    const benchmark = bars(240, 200, 0.2);
    const input = { currentPrice: stock.at(-1)!.close, bars: stock, benchmarkBars: benchmark,
      currentSessionVolume: false, sessionProgressFraction: 1, benchmarkLabel: "Nifty",
      liquidityFloor: 50_000_000, liquidityRequirementLabel: "INR 5 crore", priceFloor: 20,
      marketOpen: false, liveDataVerified: true, stopAtrMult: 1.5, targetRR: 2, trailAtrMult: 3 };
    const legacy = assessMomentumIgnition(input);
    const v2 = assessMomentumIgnitionV2(input);
    const [python] = await runPythonStrategyBatch<typeof input, { legacy: typeof legacy; v2: typeof v2 }>("momentum", [input]);
    expect(python.legacy.status).toBe(legacy.status);
    expect(python.legacy.score).toBe(legacy.score);
    expect(gateMap(python.legacy)).toEqual(gateMap(legacy));
    expect(python.v2.status).toBe(v2.status);
    expect(python.v2.score).toBe(v2.score);
    for (const key of ["atr14", "entryTrigger", "projectedVolumeRatio", "relativeStrength20Pct"] as const) {
      expect(python.legacy[key]).toBeCloseTo(legacy[key] as number, 8);
    }
  });

  it("keeps Python parity across varied trends, ages, volume and breakout paths", async () => {
    const scenarios = Array.from({ length: 18 }, (_, scenario) => {
      const count = scenario % 3 === 0 ? 45 + scenario : 220 + scenario;
      const slope = (scenario % 6 - 2) * 0.12;
      const stock = bars(count, 70 + scenario * 3, slope);
      const benchmark = bars(260, 180, scenario % 4 === 0 ? -0.03 : 0.08);
      const volumeMultiplier = scenario % 4 === 0 ? 2.2 : scenario % 4 === 1 ? 0.55 : 1.05;
      stock.at(-1)!.volume *= volumeMultiplier;
      stock.at(-2)!.volume *= scenario % 5 === 0 ? 2 : 1;
      if (scenario % 3 === 1) {
        const priorHigh = Math.max(...stock.slice(-22, -2).map((bar) => bar.high));
        stock.at(-2)!.close = priorHigh + 1.5;
        stock.at(-2)!.high = priorHigh + 2;
        stock.at(-1)!.close = priorHigh + (scenario % 2 ? 2 : 0.2);
        stock.at(-1)!.high = Math.max(stock.at(-1)!.high, stock.at(-1)!.close + 0.5);
      }
      return { ticker: `CASE${scenario}`, baseScore: (scenario % 4) * 0.1,
        currentPrice: stock.at(-1)!.close, bars: stock, benchmarkBars: benchmark,
        currentSessionVolume: scenario % 2 === 0, sessionProgressFraction: 0.55,
        benchmarkLabel: "Nifty", liquidityFloor: 10_000_000,
        liquidityRequirementLabel: "INR 1 crore", priceFloor: 20,
        marketOpen: scenario % 2 === 0, liveDataVerified: scenario % 4 !== 0,
        stopAtrMult: 1.5, targetRR: 2, trailAtrMult: 3 };
    });
    const python = await runPythonStrategyBatch<(typeof scenarios)[number], {
      legacy: ReturnType<typeof assessMomentumIgnition>;
      v2: ReturnType<typeof assessMomentumIgnitionV2>;
    }>("momentum", scenarios);
    scenarios.forEach((input, index) => {
      const legacy = assessMomentumIgnition(input);
      const v2 = assessMomentumIgnitionV2(input);
      expect(python[index].legacy.status, input.ticker).toBe(legacy.status);
      expect(python[index].legacy.score, input.ticker).toBe(legacy.score);
      expect(gateMap(python[index].legacy), input.ticker).toEqual(gateMap(legacy));
      expect(python[index].v2.status, input.ticker).toBe(v2.status);
      expect(python[index].v2.score, input.ticker).toBe(v2.score);
      for (const key of ["atr14", "entryTrigger", "entryExtensionAtr", "projectedVolumeRatio"] as const) {
        const expected = legacy[key];
        const actual = python[index].legacy[key];
        if (Number.isFinite(expected)) expect(actual, `${input.ticker} ${key}`).toBeCloseTo(expected, 8);
      }
    });
  });
});
