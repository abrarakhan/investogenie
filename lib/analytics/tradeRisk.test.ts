import { describe, expect, it } from "vitest";
import { assessTradeRisk } from "./tradeRisk";

const base = {
  tradeState: "ON_TRACK" as const,
  pnlPct: 1,
  distanceToStopPct: 5,
  marketMove1dPct: 0,
  marketMove2dPct: 0,
  stockMove1dPct: 0,
  stockMove2dPct: 0,
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

  it("recommends exit when a held stock sells off sharply below entry", () => {
    const result = assessTradeRisk({ ...base, pnlPct: -4, stockMove1dPct: -5 });
    expect(result.state).toBe("RISK_OFF");
    expect(result.recommendation).toBe("EXIT");
  });

  it("recommends staying when the plan, movement, and news remain healthy", () => {
    expect(assessTradeRisk(base).recommendation).toBe("STAY");
  });

  it("recommends staying with caution when evidence is incomplete", () => {
    expect(assessTradeRisk({ ...base, newsFresh: false }).recommendation).toBe("STAY_CAUTION");
  });

  it("preserves an explicit warning when news cannot be assessed", () => {
    expect(assessTradeRisk({ ...base, newsFresh: false }).coverageWarning).toContain("news API key");
  });
});
