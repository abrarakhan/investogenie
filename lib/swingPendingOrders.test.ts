import { describe, expect, it } from "vitest";
import { nextOrderState, validatePendingFill } from "@/lib/swingPendingOrders";

const order = {
  trigger: 100, limit: 101, remainingQuantity: 10,
  placedOn: "2026-10-10", validUntil: "2026-10-17", today: "2026-10-13",
};

describe("pending buy-stop fills", () => {
  it("rejects a fill below the trigger: the order has not executed", () => {
    expect(validatePendingFill({ ...order, fillPrice: 99, fillQuantity: 10, filledOn: "2026-10-13" })).toMatch(/not executed/);
  });

  it("rejects a fill above the limit", () => {
    expect(validatePendingFill({ ...order, fillPrice: 102, fillQuantity: 10, filledOn: "2026-10-13" })).toMatch(/limit/);
  });

  it("accepts a fill inside [trigger, limit] within the order's life", () => {
    expect(validatePendingFill({ ...order, fillPrice: 100.4, fillQuantity: 10, filledOn: "2026-10-13" })).toBeNull();
  });

  it("caps each fill at the unfilled remainder, not the original quantity", () => {
    expect(validatePendingFill({ ...order, remainingQuantity: 4, fillPrice: 100.4, fillQuantity: 4, filledOn: "2026-10-13" })).toBeNull();
    expect(validatePendingFill({ ...order, remainingQuantity: 4, fillPrice: 100.4, fillQuantity: 5, filledOn: "2026-10-13" })).toMatch(/4 unfilled/);
  });

  it("rejects future dates and fills after expiry", () => {
    expect(validatePendingFill({ ...order, fillPrice: 100.4, fillQuantity: 10, filledOn: "2026-10-14" })).toMatch(/date/);
    expect(validatePendingFill({ ...order, today: "2026-10-20", fillPrice: 100.4, fillQuantity: 10, filledOn: "2026-10-18" })).toMatch(/expired/);
  });

  it("keeps a partially filled order pending with its remainder", () => {
    expect(nextOrderState(10, 0, 6)).toEqual({ filledQuantity: 6, status: "PENDING" });
    expect(nextOrderState(10, 6, 4)).toEqual({ filledQuantity: 10, status: "FILLED" });
    // Float residue from fractional US shares still completes the order exactly.
    expect(nextOrderState(1, 0.7, 0.3)).toEqual({ filledQuantity: 1, status: "FILLED" });
  });
});
