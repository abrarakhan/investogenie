import { describe, expect, it } from "vitest";
import {
  armedEditViolation, armedPlanHash, captureBucket, validatePlanForPendingOrder, validatePlanForPurchase,
  type StoredArmedPlan,
} from "@/lib/armedSwingPlans";

const plan = (overrides: Partial<StoredArmedPlan> = {}): StoredArmedPlan => ({
  id: "00000000-0000-0000-0000-000000000001", assetId: "asset-1", market: "IN",
  sessionDate: "2026-10-13", capturedAt: "2026-10-13T05:00:00.000Z", status: "BUY_ZONE",
  trigger: 100, limit: 101, target: 112, stop: 95, trail: 95, atr: 2, trailingDistance: 6,
  expectedDays: 9, latestBarDate: "2026-10-12", strengthScore: 100, ...overrides,
});

describe("server-held Armed plans", () => {
  const purchase = { assetId: "asset-1", market: "IN" as const, boughtOn: "2026-10-13", buyPrice: 100.5 };

  it("accepts a same-session Buy zone purchase inside [trigger, limit]", () => {
    expect(validatePlanForPurchase(plan(), purchase)).toBeNull();
  });

  it("rejects a purchase below the stored trigger, whatever the browser sends", () => {
    expect(validatePlanForPurchase(plan(), { ...purchase, buyPrice: 98 })).toMatch(/trigger/);
  });

  it("rejects a missing plan, another stock's plan, an ARMED plan, or another session", () => {
    expect(validatePlanForPurchase(null, purchase)).toMatch(/not found/);
    expect(validatePlanForPurchase(plan({ assetId: "asset-2" }), purchase)).toMatch(/does not match/);
    expect(validatePlanForPurchase(plan({ status: "ARMED" }), purchase)).toMatch(/Buy zone/);
    expect(validatePlanForPurchase(plan(), { ...purchase, boughtOn: "2026-10-14" })).toMatch(/session/);
    expect(validatePlanForPurchase(plan(), { ...purchase, buyPrice: 103 })).toMatch(/limit/);
  });

  it("records a pending buy-stop only from a fresh ARMED plan of today's session", () => {
    const nowMs = Date.parse("2026-10-13T05:10:00.000Z");
    const context = { today: "2026-10-13", nowMs, market: "IN" as const };
    expect(validatePlanForPendingOrder(plan({ status: "ARMED" }), context)).toBeNull();
    expect(validatePlanForPendingOrder(plan({ status: "BUY_ZONE" }), context)).toMatch(/ARMED/);
    expect(validatePlanForPendingOrder(plan({ status: "ARMED", sessionDate: "2026-10-12" }), context)).toMatch(/earlier session/);
    expect(validatePlanForPendingOrder(plan({ status: "ARMED" }), { ...context, nowMs: nowMs + 60 * 60_000 })).toMatch(/minutes old/);
  });

  it("blocks edits that move an Armed purchase below its recorded trigger", () => {
    expect(armedEditViolation("ARMED_SWING", 100, 99)).toMatch(/below its recorded trigger/);
    expect(armedEditViolation("ARMED_SWING", 100, 100.2)).toBeNull();
    expect(armedEditViolation("STRONG_SWING", 100, 50)).toBeNull();
  });
});

describe("plan version identity", () => {
  const content = {
    bucketAt: "2026-10-13T05:05:00.000Z", market: "IN" as const, assetId: "asset-1", sessionDate: "2026-10-13",
    status: "ARMED", currentPrice: 99.2, trigger: 100, limit: 101, target: 112, stop: 95, trail: 95,
    atr: 2, trailingDistance: 6, expectedDays: 9, latestBarDate: "2026-10-12", strengthScore: 100,
    gates: [{ key: "trend", passed: true }],
  };

  it("is stable for an identical calculation", () => {
    expect(armedPlanHash(content)).toBe(armedPlanHash({ ...content, gates: [{ key: "trend", passed: true }] }));
  });

  it("changes when status, any level, price, score, gate or bucket changes", () => {
    const base = armedPlanHash(content);
    for (const change of [
      { status: "BUY_ZONE" }, { trigger: 100.05 }, { stop: 94.9 }, { currentPrice: 99.25 },
      { strengthScore: 95 }, { gates: [{ key: "trend", passed: false }] }, { bucketAt: "2026-10-13T05:10:00.000Z" },
    ]) {
      expect(armedPlanHash({ ...content, ...change })).not.toBe(base);
    }
  });

  it("buckets capture time to five minutes", () => {
    expect(captureBucket(new Date("2026-10-13T05:07:41.123Z"))).toBe("2026-10-13T05:05:00.000Z");
    expect(captureBucket(new Date("2026-10-13T05:10:00.000Z"))).toBe("2026-10-13T05:10:00.000Z");
  });
});
