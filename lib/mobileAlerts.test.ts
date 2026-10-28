import { describe, expect, it } from "vitest";
import { shouldSendTradeAlert, tradeAlertSignature } from "@/lib/mobileAlerts";
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
