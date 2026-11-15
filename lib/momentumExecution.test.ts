import { describe, expect, it } from "vitest";
import { isMomentumExecutionReady } from "@/lib/momentumExecution";

describe("Momentum execution eligibility", () => {
  it("allows the two independently safety-qualified Momentum states", () => {
    expect(isMomentumExecutionReady("ENTRY_READY")).toBe(true);
    expect(isMomentumExecutionReady("MOMENTUM_READY")).toBe(true);
  });

  it("keeps discovery, late, failed, and pullback states blocked", () => {
    for (const status of [
      "EARLY_WATCH", "BREAKOUT_TRIGGERED", "WAIT_FOR_PULLBACK",
      "PRE_IGNITION", "FIRST_THRUST", "RETEST_SETUP",
      "LATE_PROFIT_BOOKING", "FAILED_BREAKOUT", "NOT_QUALIFIED",
    ]) {
      expect(isMomentumExecutionReady(status)).toBe(false);
    }
  });
});
