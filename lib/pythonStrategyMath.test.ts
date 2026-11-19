import { describe, expect, it } from "vitest";
import type { MomentumIgnitionAssessment } from "@/lib/analytics/momentumIgnition";
import type { MomentumIgnitionV2Assessment } from "@/lib/analytics/momentumIgnitionV2";
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
  it("returns the Python-owned Strong Swing contract", async () => {
    const stock = bars(240);
    stock.at(-2)!.close = stock.at(-2)!.high = 190;
    stock.at(-1)!.close = stock.at(-1)!.high = 194;
    stock.at(-2)!.volume = 3_000_000;
    stock.at(-1)!.volume = 3_200_000;
    const benchmark = bars(240, 200, 0.2);
    const input = { market: "IN" as const, verdict: "LONG_BREAKOUT", currentPrice: 194,
      stopAtrMult: 1.5, targetRR: 2, trailAtrMult: 3, bars: stock, benchmarkBars: benchmark,
      requireLiveExecutionData: false,
      results: { verified: true, sessionsToNext: 2, nextDate: "2026-11-17", detail: "Next results 2026-11-17." } };
    const [python] = await runPythonStrategyBatch<typeof input, {
      modelVersion: string; status: string; strengthScore: number; gates: Array<{ key: string; passed: boolean }>;
      atr: number; confirmationEntry: number; trailingStop: number; effectiveTrailingStop: number;
    }>("strong_swing", [input]);
    expect(python.modelVersion).toBe("strong-swing-v6-session-reversal");
    expect(["EXECUTION_READY", "UNVERIFIED", "WAIT_FOR_ENTRY", "WATCHLIST", "RISK_OFF", "INVALIDATED"]).toContain(python.status);
    expect(python.strengthScore).toBeGreaterThanOrEqual(0);
    expect(python.strengthScore).toBeLessThanOrEqual(100);
    expect(gateMap(python)).toHaveProperty("benchmark_data");
    expect(python.atr).toBeGreaterThan(0);
    expect(python.confirmationEntry).toBeGreaterThan(0);
    expect(python.trailingStop).toBeLessThan(python.confirmationEntry);
  });

  it("returns deterministic Python-owned Momentum legacy and V2 contracts", async () => {
    const stock = bars(240);
    const benchmark = bars(240, 200, 0.2);
    const input = { currentPrice: stock.at(-1)!.close, bars: stock, benchmarkBars: benchmark,
      currentSessionVolume: false, sessionProgressFraction: 1, benchmarkLabel: "Nifty",
      liquidityFloor: 50_000_000, liquidityRequirementLabel: "INR 5 crore", priceFloor: 20,
      marketOpen: false, liveDataVerified: true, stopAtrMult: 1.5, targetRR: 2, trailAtrMult: 3 };
    type Result = { legacy: MomentumIgnitionAssessment; v2: MomentumIgnitionV2Assessment };
    const [first] = await runPythonStrategyBatch<typeof input, Result>("momentum", [input]);
    const [second] = await runPythonStrategyBatch<typeof input, Result>("momentum", [input]);
    expect(first).toEqual(second);
    expect(["EARLY_WATCH", "BREAKOUT_TRIGGERED", "ENTRY_READY", "WAIT_FOR_PULLBACK", "NOT_QUALIFIED"])
      .toContain(first.legacy.status);
    expect(["PRE_IGNITION", "FIRST_THRUST", "RETEST_SETUP", "MOMENTUM_READY", "LATE_PROFIT_BOOKING", "FAILED_BREAKOUT", "NOT_QUALIFIED"])
      .toContain(first.v2.status);
    expect(first.legacy.score).toBeGreaterThanOrEqual(0);
    expect(first.legacy.score).toBeLessThanOrEqual(100);
    expect(first.v2.score).toBeGreaterThanOrEqual(0);
    expect(first.v2.score).toBeLessThanOrEqual(100);
    expect(first.legacy.atr14).toBeGreaterThan(0);
    expect(first.legacy.entryTrigger).toBeGreaterThan(0);
    expect(gateMap(first.legacy)).toHaveProperty("freshness");
  });

  it("keeps Python Momentum outputs internally valid across varied inputs", async () => {
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
      legacy: MomentumIgnitionAssessment;
      v2: MomentumIgnitionV2Assessment;
    }>("momentum", scenarios);
    scenarios.forEach((input, index) => {
      const { legacy, v2 } = python[index];
      expect(legacy.score, input.ticker).toBeGreaterThanOrEqual(0);
      expect(legacy.score, input.ticker).toBeLessThanOrEqual(100);
      expect(v2.score, input.ticker).toBeGreaterThanOrEqual(0);
      expect(v2.score, input.ticker).toBeLessThanOrEqual(100);
      expect(legacy.tradingSessions, input.ticker).toBe(input.bars.length);
      expect(legacy.atr14, input.ticker).toBeGreaterThan(0);
      expect(legacy.entryTrigger, input.ticker).toBeGreaterThan(0);
      expect(v2.legacyStatus, input.ticker).toBe(legacy.status);
      expect(gateMap(legacy), input.ticker).toHaveProperty("freshness");
    });
  });

  it("short-circuits empty batches and produces identical outputs when benchmarkBars and resultsEvidence are hoisted", async () => {
    expect(await runPythonStrategyBatch("strong_swing", [])).toEqual([]);

    const stock = bars(240);
    stock.at(-2)!.close = stock.at(-2)!.high = 190;
    stock.at(-1)!.close = stock.at(-1)!.high = 194;
    stock.at(-2)!.volume = 3_000_000;
    stock.at(-1)!.volume = 3_200_000;
    const benchmark = bars(240, 200, 0.2);

    const evidence = {
      today: "2026-11-15",
      lastSuccessAt: "2026-11-15T06:00:00Z",
      nextDate: "2026-11-17",
      lastPastDate: "2026-08-14",
      sessionsToNext: 2,
      authoritativeSource: "NSE_CALENDAR",
      authoritativeAsOf: "2026-11-15",
      authoritativeCoverageFrom: "2026-11-16",
      authoritativeCoverageThrough: "2026-11-18",
      requiredCoverageFrom: "2026-11-16",
      requiredCoverageThrough: "2026-11-18",
    };
    const [coverage] = await runPythonStrategyBatch<typeof evidence, { verified: boolean; detail: string }>(
      "results_coverage", [evidence],
    );
    const precomputedResults = {
      verified: coverage.verified,
      detail: coverage.detail,
      nextDate: evidence.nextDate,
      sessionsToNext: evidence.sessionsToNext,
      source: evidence.authoritativeSource,
      sourceAsOf: evidence.authoritativeAsOf,
      coverageFrom: evidence.authoritativeCoverageFrom,
      coverageThrough: evidence.authoritativeCoverageThrough,
    };

    const inlineInput = {
      market: "IN" as const, verdict: "LONG_BREAKOUT", currentPrice: 194,
      stopAtrMult: 1.5, targetRR: 2, trailAtrMult: 3, bars: stock, benchmarkBars: benchmark,
      requireLiveExecutionData: false, results: precomputedResults,
    };
    const hoistedInput = {
      market: "IN" as const, verdict: "LONG_BREAKOUT", currentPrice: 194,
      stopAtrMult: 1.5, targetRR: 2, trailAtrMult: 3, bars: stock,
      requireLiveExecutionData: false, resultsEvidence: evidence,
    };
    const [fromInline] = await runPythonStrategyBatch("strong_swing", [inlineInput]);
    const [fromHoisted] = await runPythonStrategyBatch("strong_swing", [hoistedInput], { benchmarkBars: benchmark });
    expect(fromHoisted).toEqual(fromInline);

    const momInline = {
      currentPrice: stock.at(-1)!.close, bars: stock, benchmarkBars: benchmark,
      currentSessionVolume: false, sessionProgressFraction: 1, benchmarkLabel: "Nifty",
      liquidityFloor: 50_000_000, liquidityRequirementLabel: "INR 5 crore", priceFloor: 20,
      marketOpen: false, liveDataVerified: true, stopAtrMult: 1.5, targetRR: 2, trailAtrMult: 3,
    };
    const { benchmarkBars: _omit, ...momHoisted } = momInline;
    void _omit;
    const [momFromInline] = await runPythonStrategyBatch("momentum", [momInline]);
    const [momFromHoisted] = await runPythonStrategyBatch("momentum", [momHoisted], { benchmarkBars: benchmark });
    expect(momFromHoisted).toEqual(momFromInline);
  });
});
