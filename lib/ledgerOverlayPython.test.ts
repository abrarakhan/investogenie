import { describe, expect, it } from "vitest";
import { runPythonStrategyBatch } from "@/lib/pythonStrategyMath";
import type { OHLCV } from "@/lib/types";

const bars = (closes: number[]): OHLCV[] => closes.map((close, index) => ({
  date: new Date(Date.UTC(2026, 0, 1) + index * 86_400_000).toISOString().slice(0, 10),
  open: close, high: close + 1, low: close - 1, close, volume: 1000, openInterest: null,
}));

describe("Python-owned ledger follow-up and overlay", () => {
  it("calculates the named strategy line and effective target in Python", async () => {
    const input = { strategyKey: "PTJ", bars: bars(Array.from({ length: 220 }, (_, i) => 100 + i / 10)),
      boughtOn: "2026-01-01", tick: .05, direction: "SHORT", buyPrice: 120, frozenTarget: 100 };
    const [result] = await runPythonStrategyBatch<typeof input, { line: number; closeExitConfirmed: boolean; effectiveTarget: number }>("ledger_followup", [input]);
    expect(result.line).toBeGreaterThan(100);
    expect(result.closeExitConfirmed).toBe(true);
    expect(result.effectiveTarget).toBe(100);
  });

  it("treats an upward move as adverse for a short", async () => {
    const input = {
      now: "2026-11-14T10:00:00Z", direction: "SHORT", tradeState: "ON_TRACK", pnlPct: -10,
      distanceToStopPct: -1, marketMove1dPct: 0, marketMove2dPct: 0,
      currentPrice: 110, priorClose: 100, twoSessionClose: 98, technicalScore: 70,
      impacts: [], newsFresh: true, status: "OPEN", buyPrice: 100, originalTarget: 90,
      originalStop: 108, effectiveTrailingStop: 108, atr: 3, highestHighSinceEntry: 110,
      lowestLowSinceEntry: 99, soldQuantity: 0, remainingQuantity: 10,
      holdingWindowExpired: false, recoveryTarget: 95, historicalTarget: 92,
      historicalSampleSize: 20, historicalHorizon: 10,
    };
    const [result] = await runPythonStrategyBatch<typeof input, { risk: { recommendation: string }; revision: { action: string }; stockMove1dPct: number }>("ledger_overlay", [input]);
    expect(result.stockMove1dPct).toBeCloseTo(10);
    expect(result.risk.recommendation).toBe("EXIT");
    expect(result.revision.action).toBe("EXIT");
  });

  it("extends a short runner downward after its target", async () => {
    const input = {
      now: "2026-11-14T10:00:00Z", direction: "SHORT", tradeState: "TARGET_REACHED", pnlPct: 15,
      distanceToStopPct: 20, marketMove1dPct: 0, marketMove2dPct: 0,
      currentPrice: 85, priorClose: 90, twoSessionClose: 95, technicalScore: 70,
      impacts: [], newsFresh: true, status: "OPEN", buyPrice: 100, originalTarget: 90,
      originalStop: 108, effectiveTrailingStop: 95, atr: 3, highestHighSinceEntry: 101,
      lowestLowSinceEntry: 84, soldQuantity: 5, remainingQuantity: 5,
      holdingWindowExpired: false, recoveryTarget: 82, historicalTarget: 80,
      historicalSampleSize: 20, historicalHorizon: 10,
    };
    const [result] = await runPythonStrategyBatch<typeof input, { revision: { action: string; revisedTarget: number } }>("ledger_overlay", [input]);
    expect(result.revision.action).toBe("EXTEND_RUNNER");
    expect(result.revision.revisedTarget).toBe(81);
  });
});
