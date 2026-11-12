import { describe, expect, it } from "vitest";
import { ENGINE_METHODS, selectEngineCalls, validLongLevels, type EngineCandidates } from "@/lib/forwardTestEngines";

const empty: EngineCandidates = { strong: [], momentum: [], momentumV2: [], trend: [], armed: [] };
const mom = (ticker: string, status: string, entry = 100, target = 110, stop = 95) => ({
  assetId: `id-${ticker}`, ticker, status, projectedEntry: entry, projectedTarget: target, projectedStop: stop, projectedDays: 4,
});

describe("forward-test engine calls", () => {
  it("validates long levels", () => {
    expect(validLongLevels(100, 110, 95)).toBe(true);
    expect(validLongLevels(100, 99, 95)).toBe(false);
    expect(validLongLevels(100, 110, 101)).toBe(false);
    expect(validLongLevels(null, 110, 95)).toBe(false);
  });

  it("takes only enrollable statuses, in engine order, up to the per-method cap", () => {
    const calls = selectEngineCalls({
      ...empty,
      momentum: [mom("A", "EARLY_WATCH"), mom("B", "ENTRY_READY"), mom("C", "BREAKOUT_TRIGGERED"), mom("D", "ENTRY_READY")],
    }, 2);
    expect(calls.map((c) => c.ticker)).toEqual(["B", "C"]);
    expect(calls[0]).toMatchObject({ method: ENGINE_METHODS.MOMENTUM_IGNITION, entry: 100, target: 110, stop: 95, horizonDays: 4 });
  });

  it("skips invalid levels and stocks that already have a live call", () => {
    const calls = selectEngineCalls({
      ...empty,
      momentumV2: [mom("A", "MOMENTUM_READY", 100, 90, 95), mom("B", "MOMENTUM_READY"), mom("C", "RETEST_SETUP")],
    }, 5, new Set([`${ENGINE_METHODS.MOMENTUM_IGNITION_V2}|id-B`]));
    expect(calls.map((c) => c.ticker)).toEqual(["C"]);
  });

  it("maps every engine's own levels", () => {
    const calls = selectEngineCalls({
      strong: [{ assetId: "s", ticker: "S", status: "WAIT_FOR_ENTRY", strongEntry: 50, strongTarget: 60, strongStop: 45, strongExpectedDays: 0 }],
      momentum: [], momentumV2: [],
      trend: [{ assetId: "t", ticker: "T", status: "TREND_CONTINUATION_READY", entry: 20, target: 24, stop: 18 }],
      armed: [{ assetId: "a", ticker: "A", status: "ARMED", plan: { trigger: 10, target: 13, stop: 9, expectedDays: 45 } }],
    }, 2);
    expect(calls).toEqual([
      expect.objectContaining({ method: ENGINE_METHODS.STRONG_SWING, entry: 50, horizonDays: 10 }),
      expect.objectContaining({ method: ENGINE_METHODS.TREND_CONTINUATION, entry: 20, horizonDays: 10 }),
      expect.objectContaining({ method: ENGINE_METHODS.ARMED_SWING, entry: 10, horizonDays: 30 }),
    ]);
  });

  it("tracks the second-day staircase separately, entries and held-back alike", () => {
    const stair = { developing_staircase: true };
    const calls = selectEngineCalls({
      ...empty,
      trend: [
        { assetId: "r", ticker: "READY", status: "TREND_CONTINUATION_READY", entry: 100, target: 112, stop: 94, metrics: stair },
        { assetId: "w", ticker: "WATCH", status: "IMPULSE_DETECTED", entry: null, target: 56, stop: 47, currentPrice: 50, metrics: stair },
        { assetId: "n", ticker: "NOLEVELS", status: "IMPULSE_DETECTED", entry: null, target: null, stop: null, currentPrice: 50, metrics: stair },
        { assetId: "b", ticker: "BREAKOUT", status: "TREND_CONTINUATION_READY", entry: 20, target: 24, stop: 18, metrics: { early_breakout: true } },
      ],
    }, 5);
    expect(calls.map((c) => [c.method, c.ticker, c.entry])).toEqual([
      [ENGINE_METHODS.TREND_CONTINUATION, "BREAKOUT", 20],
      [ENGINE_METHODS.TREND_DAY_TWO, "READY", 100],
      [ENGINE_METHODS.TREND_DAY_TWO_WATCH, "WATCH", 50],
    ]);
  });
});
