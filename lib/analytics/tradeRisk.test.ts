import { describe, expect, it } from "vitest";
import { assessTradeRisk } from "./tradeRisk";

const base = {
  tradeState: "ON_TRACK" as const,
  pnlPct: 1,
  distanceToStopPct: 5,
  marketMove1dPct: 0,
  marketMove2dPct: 0,
  newsScore: { technicalScore: 70, newsAdjustment: 0, combinedScore: 70, state: "NEUTRAL" as const },
  newsFresh: true,
};

describe("trade risk assessment", () => {
  it("raises risk-off when the frozen stop is breached", () => {
    expect(assessTradeRisk({ ...base, tradeState: "STOP_BREACHED" }).state).toBe("RISK_OFF");
  });

  it("raises caution before the stop during a broad two-session selloff", () => {
    const result = assessTradeRisk({ ...base, marketMove2dPct: -2.6 });
    expect(result.state).toBe("CAUTION");
    expect(result.reasons[0]).toContain("two sessions");
  });

  it("raises risk-off for a crash-sized benchmark move", () => {
    expect(assessTradeRisk({ ...base, marketMove2dPct: -4.1 }).state).toBe("RISK_OFF");
  });

  it("raises risk-off for a sharp current-session market fall", () => {
    expect(assessTradeRisk({ ...base, marketMove1dPct: -2.8 }).state).toBe("RISK_OFF");
  });

  it("preserves an explicit warning when news cannot be assessed", () => {
    expect(assessTradeRisk({ ...base, newsFresh: false }).coverageWarning).toContain("news API key");
  });
});
