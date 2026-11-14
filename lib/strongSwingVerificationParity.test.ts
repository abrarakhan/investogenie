// Strong Swing: TypeScript and Python must agree on how an unusable benchmark is reported.
//
// Equivalence alone is not the point here. Both engines previously shared the same defect —
// absent, stale or too-short benchmark data surfaced as RISK_OFF, which claims the market is
// dangerous when it has merely not been measured. This pins the corrected rule in both
// runtimes and, just as importantly, keeps a genuine market shock reported as RISK_OFF.
import { describe, expect, it } from "vitest";
import { assessStrongSwing } from "@/lib/analytics/strongSwing";
import { runPythonStrategyBatch } from "@/lib/pythonStrategyMath";
import type { OHLCV } from "@/lib/types";

const RESULTS_CLEAR = { verified: true, sessionsToNext: null, nextDate: null, detail: "No results due." };

function risingBars(count = 240, slope = 0.5): OHLCV[] {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index * slope;
    return {
      date: new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10),
      open: close - 1, high: close + 0.5, low: close - 1.5, close,
      volume: index >= count - 2 ? 3_000_000 : 1_000_000, openInterest: null,
    };
  });
}

/** A confirmed breakout holding two closes above the prior 20-session high. */
function cleanConfirmedBars(): { bars: OHLCV[]; entry: number } {
  const bars = risingBars(240, 0.5);
  const entry = Math.max(...bars.slice(-22, -2).map((bar) => bar.high)) + 0.5;
  for (let index = bars.length - 2; index < bars.length; index++) {
    const close = entry + 0.2;
    bars[index] = { ...bars[index], open: close - 0.4, high: close + 0.2, low: close - 0.6, close, volume: 4_000_000 };
  }
  return { bars, entry };
}

describe("Strong Swing benchmark verification parity", () => {
  it("agrees on every benchmark condition, and keeps a real shock as risk off", async () => {
    const { bars, entry } = cleanConfirmedBars();
    const benchmark = risingBars(240, 0.2);
    const shocked = [...benchmark];
    const third = shocked[shocked.length - 3];
    shocked[shocked.length - 1] = {
      ...shocked[shocked.length - 1],
      close: third.close * 0.9, high: third.close * 0.9, low: third.close * 0.9,
    };

    const variants: [string, OHLCV[], string][] = [
      ["usable", benchmark, "EXECUTION_READY"],
      ["missing", [], "UNVERIFIED"],
      ["stale", benchmark.slice(0, -8), "UNVERIFIED"],
      ["too-short", benchmark.slice(-30), "UNVERIFIED"],
      ["shocked", shocked, "RISK_OFF"],
    ];

    const inputs = variants.map(([, benchmarkBars]) => ({
      market: "IN" as const, verdict: "LONG_BREAKOUT", isBreakout: true,
      trigger: entry, atr: 2, trailingStop: null, currentPrice: entry + 0.2,
      stopAtrMult: 1.5, bars, benchmarkBars, results: RESULTS_CLEAR,
    }));

    const python = await runPythonStrategyBatch<typeof inputs[number], { status: string }>("strong_swing", inputs);

    for (let index = 0; index < variants.length; index++) {
      const [name, , expected] = variants[index];
      const ts = assessStrongSwing(inputs[index]);
      expect(`${name}: ${ts.status}`).toBe(`${name}: ${expected}`);
      expect(`${name}: ${python[index].status}`).toBe(`${name}: ${expected}`);
    }
  }, 120_000);

  it("records benchmark usability as a gate, naming the specific reason", async () => {
    // The gate is what lets an audit tell a negative regime apart from absent, stale or
    // too-short data; inferring it from other gates cannot distinguish those.
    const { bars, entry } = cleanConfirmedBars();
    const benchmark = risingBars(240, 0.2);
    const cases: [string, OHLCV[], boolean, string][] = [
      ["usable", benchmark, true, "present, current and long enough"],
      ["missing", [], false, "unavailable"],
      ["stale", benchmark.slice(0, -8), false, "behind the market"],
      ["too-short", benchmark.slice(-30), false, "needs more history"],
    ];
    const inputs = cases.map(([, benchmarkBars]) => ({
      market: "IN" as const, verdict: "LONG_BREAKOUT", isBreakout: true,
      trigger: entry, atr: 2, trailingStop: null, currentPrice: entry + 0.2,
      stopAtrMult: 1.5, bars, benchmarkBars, results: RESULTS_CLEAR,
    }));
    const python = await runPythonStrategyBatch<typeof inputs[number], { gates: { key: string; passed: boolean; detail: string; blocking: boolean }[] }>(
      "strong_swing", inputs);

    for (let index = 0; index < cases.length; index++) {
      const [name, , shouldPass, fragment] = cases[index];
      const tsGate = assessStrongSwing(inputs[index]).gates.find((gate) => gate.key === "benchmark_data");
      const pyGate = python[index].gates.find((gate) => gate.key === "benchmark_data");
      expect(`${name}: ts gate present`).toBe(tsGate ? `${name}: ts gate present` : `${name}: MISSING`);
      expect(`${name}: py gate present`).toBe(pyGate ? `${name}: py gate present` : `${name}: MISSING`);
      expect(`${name}: ${tsGate!.passed}`).toBe(`${name}: ${shouldPass}`);
      expect(`${name}: ${pyGate!.passed}`).toBe(`${name}: ${shouldPass}`);
      // Both runtimes must give the same reason, not merely the same verdict.
      expect(`${name}: ${pyGate!.detail}`).toBe(`${name}: ${tsGate!.detail}`);
      expect(tsGate!.detail.toLowerCase()).toContain(fragment);
      expect(tsGate!.blocking).toBe(true);
    }
  }, 120_000);
});
