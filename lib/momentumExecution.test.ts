import { describe, expect, it } from "vitest";
import { isMomentumExecutionReady, reconcileMomentumExecutionStatus } from "@/lib/momentumExecution";

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

  it("keeps legacy execution ready only when V2 independently confirms timing", () => {
    expect(reconcileMomentumExecutionStatus("ENTRY_READY", "MOMENTUM_READY")).toEqual({
      status: "ENTRY_READY",
      vetoReason: null,
    });
  });

  it("downgrades mature or failed moves instead of allowing late entries", () => {
    expect(reconcileMomentumExecutionStatus("ENTRY_READY", "LATE_PROFIT_BOOKING").status)
      .toBe("WAIT_FOR_PULLBACK");
    expect(reconcileMomentumExecutionStatus("ENTRY_READY", "FAILED_BREAKOUT").status)
      .toBe("WAIT_FOR_PULLBACK");
  });

  it("keeps an unconfirmed first thrust visible but non-actionable", () => {
    const result = reconcileMomentumExecutionStatus("ENTRY_READY", "FIRST_THRUST");
    expect(result.status).toBe("BREAKOUT_TRIGGERED");
    expect(result.vetoReason).toContain("has not confirmed safe entry timing");
  });

  it("does not promote a non-ready legacy setup", () => {
    expect(reconcileMomentumExecutionStatus("EARLY_WATCH", "MOMENTUM_READY")).toEqual({
      status: "EARLY_WATCH",
      vetoReason: null,
    });
  });
});
