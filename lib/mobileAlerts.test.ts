import { describe, expect, it } from "vitest";
import { shouldSendTradeAlert, tradeAlertSignature } from "@/lib/mobileAlerts";
import type { SwingLedgerTrade } from "@/lib/swingTradeLedger";

const trade = (recommendation: "STAY" | "STAY_CAUTION" | "EXIT") => ({
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
});
