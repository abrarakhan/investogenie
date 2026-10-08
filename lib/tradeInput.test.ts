import { describe, expect, it } from "vitest";
import { validateShareQuantity } from "@/lib/tradeInput";

describe("validateShareQuantity", () => {
  it("accepts whole India share quantities", () => {
    expect(() => validateShareQuantity("IN", 488)).not.toThrow();
  });

  it("rejects a decimal India quantity that can result from swapped price and quantity", () => {
    expect(() => validateShareQuantity("IN", 376.45)).toThrow(/whole number/);
  });

  it("allows fractional US shares", () => {
    expect(() => validateShareQuantity("US", 1.25)).not.toThrow();
  });
});
