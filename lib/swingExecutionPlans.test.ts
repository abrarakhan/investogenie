import { describe, expect, it } from "vitest";
import {
  isExecutablePlanGeometry,
  protectedExecutionEditViolation,
  trendContinuationExecutionPlanInputs,
  validateExecutionPlanPurchase,
  type ExecutionPlanInput,
  type StoredExecutionPlan,
} from "@/lib/swingExecutionPlans";
import type { TrendContinuationCandidate } from "@/lib/trendContinuation";
import { MOMENTUM_EXECUTION_MODEL_VERSION } from "@/lib/momentumExecution";

const plan = (overrides: Partial<StoredExecutionPlan> = {}): StoredExecutionPlan => ({
  id: "00000000-0000-0000-0000-000000000001", assetId: "asset-1", market: "IN",
  strategyKey: "STRONG_SWING", status: "EXECUTION_READY", sessionDate: "2026-10-13",
  capturedAt: "2026-10-13T05:00:00.000Z", entry: 100, target: 112, stop: 95, trail: 96,
  atr: 2, trailingDistance: 6, expectedDays: 10, signalAsOf: "2026-10-12", score: 0.9,
  snapshot: {}, ...overrides,
});

describe("protected swing execution plans", () => {
  const purchase = {
    assetId: "asset-1", market: "IN" as const, strategyKey: "STRONG_SWING" as const,
    boughtOn: "2026-10-13", buyPrice: 101, today: "2026-10-13", nowMs: Date.parse("2026-10-13T05:10:00Z"),
  };

  it("accepts a recent matching execution plan", () => {
    expect(validateExecutionPlanPurchase(plan(), purchase)).toBeNull();
  });

  it("rejects altered identity, stale plans, and prices below entry", () => {
    expect(validateExecutionPlanPurchase(null, purchase)).toMatch(/not found/);
    expect(validateExecutionPlanPurchase(plan({ assetId: "asset-2" }), purchase)).toMatch(/does not match/);
    expect(validateExecutionPlanPurchase(plan(), { ...purchase, strategyKey: "MOMENTUM_IGNITION" })).toMatch(/does not match/);
    expect(validateExecutionPlanPurchase(plan({ status: "WAIT_FOR_ENTRY" }), purchase)).toMatch(/not execution ready/);
    expect(validateExecutionPlanPurchase(plan(), { ...purchase, nowMs: purchase.nowMs + 31 * 60_000 })).toMatch(/stale/);
    expect(validateExecutionPlanPurchase(plan(), { ...purchase, buyPrice: 98 })).toMatch(/confirmed entry/);
  });

  it("protects subsequent edits without affecting manual trades", () => {
    expect(protectedExecutionEditViolation("STRONG_SWING", 100, 99)).toMatch(/recorded entry/);
    expect(protectedExecutionEditViolation("MOMENTUM_IGNITION", 100, 101)).toBeNull();
    expect(protectedExecutionEditViolation("TREND_CONTINUATION", 100, 99)).toMatch(/recorded entry/);
    expect(protectedExecutionEditViolation("DEFAULT_SWING", 100, 50)).toBeNull();
  });

  it("accepts only a confirmed Trend Continuation plan", () => {
    const continuation = plan({ strategyKey: "TREND_CONTINUATION", status: "TREND_CONTINUATION_READY" });
    expect(validateExecutionPlanPurchase(continuation, { ...purchase, strategyKey: "TREND_CONTINUATION" })).toBeNull();
    expect(validateExecutionPlanPurchase({ ...continuation, status: "CONTINUATION_WATCH" }, { ...purchase, strategyKey: "TREND_CONTINUATION" }))
      .toMatch(/not execution ready/);
  });

  it("invalidates Momentum plans captured by older entry logic", () => {
    const momentumPurchase = { ...purchase, strategyKey: "MOMENTUM_IGNITION" as const };
    const current = plan({
      strategyKey: "MOMENTUM_IGNITION", status: "MOMENTUM_READY",
      snapshot: { executionModelVersion: MOMENTUM_EXECUTION_MODEL_VERSION },
    });
    expect(validateExecutionPlanPurchase(current, momentumPurchase)).toBeNull();
    expect(validateExecutionPlanPurchase({ ...current, snapshot: {} }, momentumPurchase)).toMatch(/model changed/);
  });

  it("builds a plan only for an execution-eligible day-two continuation", () => {
    const candidate = {
      assetId: "asset-1", status: "TREND_CONTINUATION_READY", executionEligible: true,
      entry: 104.2, target: 112, stop: 100, score: 90, asOfMarketDate: "2026-10-13",
      metrics: { atr14: 2.1, expected_holding_days: 5 }, reasons: ["Day two confirmed."],
    } as unknown as TrendContinuationCandidate;
    expect(trendContinuationExecutionPlanInputs([candidate])).toMatchObject([{
      strategyKey: "TREND_CONTINUATION", status: "TREND_CONTINUATION_READY", entry: 104.2,
      target: 112, stop: 100, atr: 2.1, expectedDays: 5,
    }]);
    expect(trendContinuationExecutionPlanInputs([{ ...candidate, executionEligible: false }])).toEqual([]);
  });

  it("fails closed when a candidate produces unsafe execution geometry", () => {
    const input: ExecutionPlanInput = {
      assetId: "asset-1", strategyKey: "MOMENTUM_IGNITION", status: "MOMENTUM_READY",
      entry: 1241.6, target: 1303.68, stop: 1200, trail: 1200, atr: 53.8,
      expectedDays: 1, signalAsOf: "2026-10-26", score: 0.85, snapshot: {},
    };

    expect(isExecutablePlanGeometry(input)).toBe(true);
    expect(isExecutablePlanGeometry({ ...input, stop: 1254.55 })).toBe(false);
    expect(isExecutablePlanGeometry({ ...input, trail: 1254.55 })).toBe(false);
    expect(isExecutablePlanGeometry({ ...input, target: input.entry })).toBe(false);
  });
});
