import { describe, expect, it } from "vitest";
import { reviseSwingTradePlan, type TradePlanRevisionInput } from "./tradePlanRevision";

const base: TradePlanRevisionInput = {
  status: "OPEN", currentPrice: 112, buyPrice: 100, originalTarget: 120,
  originalStop: 94, effectiveTrailingStop: 103, atr: 4,
  highestHighSinceEntry: 114, lowestLowSinceEntry: 98,
  stockMove1dPct: 2, stockMove2dPct: 4, soldQuantity: 0,
  remainingQuantity: 10,
  externalExitRisk: false, externalExitReasons: [],
};

describe("revised swing trade plan", () => {
  it("keeps the frozen target while the original plan remains valid", () => {
    const result = reviseSwingTradePlan(base);
    expect(result.action).toBe("FOLLOW_ORIGINAL");
    expect(result.revisedTarget).toBe(120);
    expect(result.protectiveStop).toBe(103);
  });

  it("extends only a target-reached position with positive momentum", () => {
    const result = reviseSwingTradePlan({ ...base, currentPrice: 122, highestHighSinceEntry: 123 });
    expect(result.action).toBe("EXTEND_RUNNER");
    expect(result.revisedTarget).toBe(127);
  });

  it("protects profit instead of extending when momentum is not positive", () => {
    const result = reviseSwingTradePlan({ ...base, currentPrice: 122, stockMove1dPct: -1 });
    expect(result.action).toBe("PROTECT_PROFIT");
    expect(result.revisedTarget).toBeNull();
  });

  it("does not revive a plan whose stop traded through before recovery", () => {
    const result = reviseSwingTradePlan({
      ...base, currentPrice: 108, lowestLowSinceEntry: 92, soldQuantity: 4, remainingQuantity: 6,
    });
    expect(result.action).toBe("PROTECT_RECOVERY");
    expect(result.revisedTarget).toBeNull();
    expect(result.originalPlanBreached).toBe(true);
  });

  it("activates exit when the current quote breaches the effective trail", () => {
    const result = reviseSwingTradePlan({ ...base, currentPrice: 102 });
    expect(result.action).toBe("EXIT");
    expect(result.revisedTarget).toBeNull();
  });

  it("lets adverse external risk override a momentum target extension", () => {
    const result = reviseSwingTradePlan({
      ...base, currentPrice: 122, externalExitRisk: true,
      externalExitReasons: ["Verified adverse stock-specific event."],
    });
    expect(result.action).toBe("EXIT");
    expect(result.reasons).toEqual(["Verified adverse stock-specific event."]);
  });
});
