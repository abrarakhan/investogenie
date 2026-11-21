import { describe, expect, it } from "vitest";
import { candidateAlertAllowed, shouldSendTradeAlert, tradeAlertAllowed, tradeAlertSignature } from "@/lib/mobileAlerts";
import { DEFAULT_MOBILE_ALERT_PREFERENCES } from "@/lib/mobileAlertPreferences";
import type { SwingLedgerTrade } from "@/lib/swingTradeLedger";

const trade = (recommendation: "STAY" | "STAY_CAUTION" | "EXIT") => ({
  id: "trade-1",
  status: "OPEN",
  progress: { state: "ON_TRACK" },
  risk: { recommendation, state: recommendation === "EXIT" ? "RISK_OFF" : "CAUTION", reasons: ["Existing server reason"] },
}) as SwingLedgerTrade;

describe("mobile trade alert safety", () => {
  it("does not alert for the existing STAY state", () => {
    expect(tradeAlertSignature(trade("STAY"))).toBeNull();
  });

  it("alerts when the existing engine changes to caution or exit", () => {
    expect(tradeAlertSignature(trade("STAY_CAUTION"))).toContain("STAY_CAUTION");
    expect(tradeAlertSignature(trade("EXIT"))).toContain("EXIT");
  });

  it("suppresses an unchanged state signature", () => {
    const signature = tradeAlertSignature(trade("EXIT"))!;
    expect(shouldSendTradeAlert(signature, signature)).toBe(false);
    expect(shouldSendTradeAlert(null, signature)).toBe(true);
  });

  it("does not treat changing live-price explanation text as a new alert", () => {
    const first = trade("STAY_CAUTION");
    first.risk.reasons = ["The open trade is down 2.47% from its recorded buy price."];
    const second = trade("STAY_CAUTION");
    second.risk.reasons = ["The open trade is down 2.53% from its recorded buy price."];
    expect(tradeAlertSignature(first)).toBe(tradeAlertSignature(second));
  });

  it("keeps otherwise identical alerts separate for different trades", () => {
    const first = trade("STAY_CAUTION");
    const second = { ...trade("STAY_CAUTION"), id: "trade-2" } as SwingLedgerTrade;
    expect(tradeAlertSignature(first)).not.toBe(tradeAlertSignature(second));
  });
});

describe("per-user mobile alert preferences", () => {
  it("separates execution, Mid-Way and ledger delivery switches", () => {
    const preferences = {
      ...DEFAULT_MOBILE_ALERT_PREFERENCES,
      executionReady: false,
      midwaySetups: true,
      ledgerRiskAlerts: false,
    };
    expect(candidateAlertAllowed(preferences, { midway: false }, true)).toBe(false);
    expect(candidateAlertAllowed(preferences, { midway: true }, true)).toBe(true);
    expect(tradeAlertAllowed(preferences)).toBe(false);
  });

  it("mutes candidate delivery outside market hours when quiet hours are enabled", () => {
    const preferences = { ...DEFAULT_MOBILE_ALERT_PREFERENCES, quietHoursEnabled: true };
    expect(candidateAlertAllowed(preferences, { midway: false }, false)).toBe(false);
    expect(candidateAlertAllowed(preferences, { midway: false }, true)).toBe(true);
    // Risk alerts are controlled independently and remain available as critical alerts.
    expect(tradeAlertAllowed(preferences)).toBe(true);
  });
});
