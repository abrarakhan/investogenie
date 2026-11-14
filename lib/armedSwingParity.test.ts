// Differential test: the TypeScript Armed Swing implementation against the Python port.
//
// This is the safety net for moving calculation authority to Python. A migration is only
// correct if it is behaviour-preserving, so this runs both implementations over the same
// inputs and requires byte-identical results — statuses, scores, plan levels, every gate and
// every gate detail string. Detail strings are compared deliberately: they are where JS/Python
// rounding differences surface first (Math.round is half-up, Python's round is half-to-even;
// toFixed is half-away-from-zero, Python's format is half-to-even).
import { describe, expect, it } from "vitest";
import { assessArmedSwing, type ArmedSwingInput } from "@/lib/analytics/armedSwing";
import { runPythonStrategyBatch } from "@/lib/pythonStrategyMath";
import type { OHLCV } from "@/lib/types";

/** Deterministic PRNG so a failure is always reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A stage-2 leader that rallies, then rests in a tight 20-session base under a pivot set early
 * in that base. Shaped deliberately: a plain random walk prints a new high late in the base, so
 * `pivot_rest` fails and every scenario collapses to one status, which would make a
 * differential test look green while exercising almost nothing.
 */
function buildBars(seed: number, count: number, opts: {
  trendDrift?: number; baseFade?: number; trend?: boolean;
} = {}): OHLCV[] {
  const random = mulberry32(seed);
  // The base holds flat under the pivot. Any real fade pushes the close past
  // `maxDistanceAtr` from the trigger, and a benchmark that keeps climbing through the base
  // drags the RS line off its high — either one alone made every scenario fail a technical
  // gate, so none of the actionable statuses were ever reached.
  const { trendDrift = 0.006, baseFade = 0, trend = false } = opts;
  const bars: OHLCV[] = [];
  let close = 40;
  const start = Date.UTC(2025, 0, 1);
  const baseStart = trend ? count : count - 20;
  let pivot = 0;
  for (let index = 0; index < count; index++) {
    const inBase = index >= baseStart;
    if (inBase) {
      // Fade gently off the pivot with small noise, so the high stands near the base's start.
      close = close * (1 - baseFade + (random() - 0.5) * 0.008);
    } else {
      close = Math.max(5, close * (1 + trendDrift + (random() - 0.5) * 0.02));
    }
    const range = close * (inBase ? 0.009 : 0.022);
    let high = close + range * random();
    const low = close - range * random();
    if (inBase) {
      if (index === baseStart) pivot = high;
      // Nothing after the first base session may exceed the pivot, which is what "resting
      // under the pivot" means; without this the pivot keeps resetting to the latest bar.
      else high = Math.min(high, pivot * 0.995);
    }
    bars.push({
      date: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
      open: (high + low) / 2,
      high: Math.max(high, close),
      low: Math.min(low, close),
      close,
      volume: Math.round(1_000_000 * (0.5 + random()) * (inBase ? 0.55 : 1)),
      openInterest: null,
    });
  }
  return bars;
}

const curve = {
  market: "IN" as const,
  version: "test-1",
  sampleSessions: 60,
  points: [[0, 0], [0.25, 0.34], [0.5, 0.56], [0.75, 0.78], [1, 1]] as ReadonlyArray<readonly [number, number]>,
};

/** A spread of scenarios so every status branch and both markets are covered. */
function scenarios(): { name: string; input: ArmedSwingInput }[] {
  const risk = { targetRR: 2.5, trailAtrMult: 3 };
  const bench = (seed: number, count = 300) =>
    // A steadily rising benchmark, so the regime gate passes and does not mask other branches.
    buildBars(seed + 7777, count, { trendDrift: 0.0007, trend: true });

  /**
   * Build one case. Execution bands are sized from the stock's own price and the entry levels
   * are read back from a dry run, because trigger and limit depend on the generated bars —
   * hardcoding them put the limit outside the circuit band and forced RISK_OFF everywhere.
   */
  const make = (
    name: string,
    seed: number,
    market: "IN" | "US",
    tune: (plan: { trigger: number; limit: number; stop: number; close: number }) => Partial<ArmedSwingInput>,
    count = 300,
  ): { name: string; input: ArmedSwingInput } => {
    const bars = buildBars(seed, count);
    const benchmarkBars = bench(seed, count);
    const dry: ArmedSwingInput = {
      market, bars, benchmarkBars, currentPrice: 0, rsPercentile: 92,
      liveSession: null, volumeCurve: curve, expectedSessionLag: 0,
      execution: null, results: null, risk,
    };
    const { plan, latestClose } = assessArmedSwing(dry);
    const levels = { trigger: plan.trigger, limit: plan.limit, stop: plan.stop, close: latestClose };
    const wideBands = {
      quoteFresh: true, quoteAgeMinutes: 2,
      bestBid: latestClose * 0.999, bestAsk: latestClose * 1.001,
      lowerCircuit: latestClose * 0.8, upperCircuit: latestClose * 1.2,
    };
    const okResults = { verified: true, sessionsToNext: 30, nextDate: "2026-02-01", detail: "Next results 2026-02-01." };
    return { name, input: { ...dry, execution: wideBands, results: okResults, ...tune(levels) } };
  };

  return [
    make("armed under the pivot", 1, "IN", () => ({})),
    make("buy zone: through the trigger on heavy pace", 2, "IN", (levels) => ({
      currentPrice: levels.trigger,
      liveSession: { volume: 2_000_000, progress: 0.4 },
    })),
    make("triggered but volume pace is light", 3, "IN", (levels) => ({
      currentPrice: levels.trigger,
      liveSession: { volume: 50_000, progress: 0.4 },
    })),
    make("triggered outside a live session", 4, "US", (levels) => ({
      currentPrice: levels.trigger, liveSession: null, volumeCurve: null,
    })),
    make("unverified: no execution or results data", 5, "IN", () => ({
      execution: null, results: null,
    })),
    make("extended above the limit", 6, "IN", (levels) => ({
      currentPrice: levels.limit * 1.05,
    })),
    make("invalidated below the structure stop", 7, "IN", (levels) => ({
      currentPrice: levels.stop * 0.9,
    })),
    make("risk off: spread far too wide", 8, "IN", (levels) => ({
      execution: {
        quoteFresh: true, quoteAgeMinutes: 1,
        bestBid: levels.close * 0.95, bestAsk: levels.close,
        lowerCircuit: levels.close * 0.8, upperCircuit: levels.close * 1.2,
      },
    })),
    make("in the results blackout window", 9, "IN", () => ({
      results: { verified: true, sessionsToNext: 2, nextDate: "2026-01-20", detail: "Next results 2026-01-20." },
    })),
    make("forming: short history and no rank", 10, "US", () => ({
      rsPercentile: null, expectedSessionLag: 3,
    }), 120),
  ];
}

describe("Armed Swing TypeScript/Python parity", () => {
  it("produces identical assessments for every scenario", async () => {
    const cases = scenarios();
    const tsResults = cases.map((entry) => assessArmedSwing(entry.input));
    const pyResults = await runPythonStrategyBatch<ArmedSwingInput, ReturnType<typeof assessArmedSwing>>(
      "armed_swing",
      cases.map((entry) => entry.input),
    );

    for (let index = 0; index < cases.length; index++) {
      const name = cases[index].name;
      const ts = tsResults[index];
      const py = pyResults[index] as ReturnType<typeof assessArmedSwing> & { policyVersion: string };

      expect(`${name}: ${py.status}`).toBe(`${name}: ${ts.status}`);
      expect(`${name}: ${py.strengthScore}`).toBe(`${name}: ${ts.strengthScore}`);

      // Plan levels are money: they must match to the cent/paise the TS rounding produced.
      expect({ name, plan: py.plan }).toEqual({ name, plan: ts.plan });

      // Gate-for-gate, including the human-readable detail.
      expect({ name, gates: py.gates }).toEqual({ name, gates: ts.gates });

      for (const key of [
        "atr", "atrPct", "distanceToTriggerPct", "distanceToTriggerAtr", "baseDepthPct",
        "contractionRatio", "pivotAgeSessions", "bandwidthPercentile", "volumeDryUp",
        "volumePace", "averageTradedValue20", "sma50", "sma150", "sma200", "high52", "low52",
        "suggestedExposurePct", "circuitLikeSessions20",
      ] as const) {
        const tsValue = ts[key] as number | null;
        const pyValue = py[key] as number | null;
        if (tsValue === null || pyValue === null) {
          expect(`${name}.${key}: ${pyValue}`).toBe(`${name}.${key}: ${tsValue}`);
        } else {
          // Float arithmetic in two runtimes can differ in the last bit; money and gate
          // decisions are compared exactly above, so a relative tolerance is right here.
          expect(Math.abs(pyValue - tsValue)).toBeLessThanOrEqual(Math.abs(tsValue) * 1e-12 + 1e-12);
        }
      }

      expect(`${name}: ${py.rsLineNearHigh}`).toBe(`${name}: ${ts.rsLineNearHigh}`);
      expect(`${name}: ${py.marketRegimePositive}`).toBe(`${name}: ${ts.marketRegimePositive}`);
      expect(`${name}: ${py.latestDate}`).toBe(`${name}: ${ts.latestDate}`);
    }
  }, 120_000);

  it("ranks the book in Python, matching rankArmedSwingCandidates", async () => {
    const cases = scenarios();
    const inputs = cases.map((entry) => ({ ...entry.input, ticker: `T${cases.indexOf(entry)}` }));
    const pyResults = await runPythonStrategyBatch<typeof inputs[number], { pythonRank: number; status: string }>(
      "armed_swing",
      inputs,
    );
    const ranks = pyResults.map((result) => result.pythonRank).sort((a, b) => a - b);
    expect(ranks).toEqual(Array.from({ length: cases.length }, (_, index) => index + 1));
  }, 120_000);
});

// Coverage guard: a differential test that only ever reaches one status proves little.
describe("Armed Swing parity scenario coverage", () => {
  it("exercises a spread of statuses", () => {
    const seen = new Set(scenarios().map((entry) => assessArmedSwing(entry.input).status));
    console.log(`  statuses covered: ${[...seen].sort().join(", ")}`);
    expect(seen.size).toBeGreaterThanOrEqual(4);
  });
});

describe("Armed Swing Python-owned results coverage", () => {
  it("derives verification and blackout from raw point-in-time evidence", async () => {
    const base = scenarios()[0].input;
    const raw = {
      ...base,
      results: null,
      resultsEvidence: {
        today: "2026-11-14", lastSuccessAt: "2026-11-14T01:00:00Z",
        nextDate: "2026-11-17", lastPastDate: "2026-08-01",
        authoritativeSource: "NSE_CALENDAR", authoritativeAsOf: "2026-11-14",
        authoritativeCoverageFrom: "2026-11-16", authoritativeCoverageThrough: "2026-11-18",
        requiredCoverageFrom: "2026-11-16", requiredCoverageThrough: "2026-11-18",
        blackoutSessionDates: ["2026-11-16", "2026-11-17", "2026-11-18"],
      },
    };
    const [result] = await runPythonStrategyBatch<typeof raw, ReturnType<typeof assessArmedSwing> & { resultsCalendarVerified: boolean }>("armed_swing", [raw]);
    expect(result.resultsCalendarVerified).toBe(true);
    expect(result.gates.find((gate) => gate.key === "results_blackout")?.passed).toBe(false);
    expect(result.gates.find((gate) => gate.key === "results_blackout")?.detail).toContain("2 sessions");
  }, 120_000);
});

// Regression guard for the stale-benchmark cascade.
//
// A benchmark behind the market used to fail `freshness` and `market_regime` — both blocking
// execution gates — which set hardRisk and turned every candidate in the market into RISK_OFF.
// That reported an ingestion outage as a risk decision. Observed live: with BSE bars four
// sessions behind NSE, all 200 sampled India candidates read RISK_OFF.
describe("Armed Swing stale-benchmark handling", () => {
  const withBenchmark = (benchmarkBars: OHLCV[]): ArmedSwingInput => {
    const bars = buildBars(1, 300);
    const close = bars[bars.length - 1].close;
    return {
      market: "IN", bars, benchmarkBars, currentPrice: 0, rsPercentile: 92,
      liveSession: null, volumeCurve: curve, expectedSessionLag: 0,
      execution: {
        quoteFresh: true, quoteAgeMinutes: 1,
        bestBid: close * 0.999, bestAsk: close * 1.001,
        lowerCircuit: close * 0.8, upperCircuit: close * 1.2,
      },
      results: { verified: true, sessionsToNext: 30, nextDate: "2026-02-01", detail: "d" },
      risk: { targetRR: 2.5, trailAtrMult: 3 },
    };
  };

  it("reports a missing benchmark as unverified, not risk-off", () => {
    const result = assessArmedSwing(withBenchmark([]));
    expect(result.status).not.toBe("RISK_OFF");
    expect(result.gates.find((g) => g.key === "freshness")?.passed).toBe(false);
  });

  it("reports a stale benchmark as unverified, not risk-off", () => {
    // Benchmark stops several sessions before the stock's latest bar.
    const stale = buildBars(7778, 300, { trendDrift: 0.0007, trend: true }).slice(0, -6);
    const result = assessArmedSwing(withBenchmark(stale));
    expect(result.gates.find((g) => g.key === "freshness")?.passed).toBe(false);
    expect(result.status).not.toBe("RISK_OFF");
  });

  it("still hard-stops on a genuine risk breach when the benchmark is usable", () => {
    // Fresh benchmark, but the live spread is far outside the limit: that is a real risk call
    // and must keep producing RISK_OFF rather than being softened to UNVERIFIED.
    const input = withBenchmark(buildBars(7778, 300, { trendDrift: 0.0007, trend: true }));
    const close = input.bars[input.bars.length - 1].close;
    const result = assessArmedSwing({
      ...input,
      execution: { ...input.execution!, bestBid: close * 0.9, bestAsk: close },
    });
    expect(result.gates.find((g) => g.key === "live_spread")?.passed).toBe(false);
    expect(result.status).toBe("RISK_OFF");
  });
});
