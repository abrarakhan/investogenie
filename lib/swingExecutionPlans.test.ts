import { describe, expect, it } from "vitest";
import { protectedExecutionEditViolation, validateExecutionPlanPurchase, type StoredExecutionPlan } from "@/lib/swingExecutionPlans";

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
    expect(protectedExecutionEditViolation("DEFAULT_SWING", 100, 50)).toBeNull();
  });
});
