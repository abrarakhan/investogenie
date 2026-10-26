import { describe, expect, it } from "vitest";
import { momentumExecutionBlockReason } from "@/lib/momentumIgnition";

describe("Momentum Ignition execution geometry", () => {
  it("allows a target above entry with both protective levels below entry", () => {
    expect(momentumExecutionBlockReason({ entry: 100, target: 106, stop: 96, trail: 97 })).toBeNull();
  });

  it("blocks the live CYIENT geometry instead of presenting it as ready to buy", () => {
    expect(momentumExecutionBlockReason({
      entry: 1252,
      target: 1314.6,
      stop: 1254.37,
      trail: 1254.37,
    })).toBe("Model stop 1254.37 is not below live entry 1252.00.");
  });

  it("also blocks invalid targets, trailing references, and non-finite levels", () => {
    expect(momentumExecutionBlockReason({ entry: 100, target: 100, stop: 95, trail: 95 })).toMatch(/target/);
    expect(momentumExecutionBlockReason({ entry: 100, target: 110, stop: 95, trail: 101 })).toMatch(/Trailing/);
    expect(momentumExecutionBlockReason({ entry: Number.NaN, target: 110, stop: 95, trail: 95 })).toMatch(/invalid/);
  });
});
