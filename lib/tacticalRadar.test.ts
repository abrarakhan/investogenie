import { describe, expect, it } from "vitest";
import {
  classifyMarketRegime,
  computeAtrLevels,
  evaluateStrongSwingNearTrigger,
} from "./tacticalRadar";

describe("classifyMarketRegime", () => {
  it("detects TREND_BREAKOUT when benchmark is above 50DMA and breadth >= 55%", () => {
    const res = classifyMarketRegime({
      benchmarkAboveSma50: true,
      benchmarkChangePct: 0.45,
      advancers: 1200,
      decliners: 800,
    });
    expect(res.regime).toBe("TREND_BREAKOUT");
    expect(res.favoredBucket).toBe("NEAR_TRIGGER");
    expect(res.breadthPct).toBe(60);
  });

  it("detects SNAPBACK_REVERSAL when benchmark rebounds from weak breadth", () => {
    const res = classifyMarketRegime({
      benchmarkAboveSma50: false,
      benchmarkChangePct: 0.7,
      advancers: 750,
      decliners: 1250,
    });
    expect(res.regime).toBe("SNAPBACK_REVERSAL");
    expect(res.favoredBucket).toBe("OVERSOLD_SNAPBACK");
  });

  it("detects DEFENSIVE when benchmark is below 50DMA and negative with weak breadth", () => {
    const res = classifyMarketRegime({
      benchmarkAboveSma50: false,
      benchmarkChangePct: -0.6,
      advancers: 600,
      decliners: 1400,
    });
    expect(res.regime).toBe("DEFENSIVE");
  });

  it("falls back to CHOPPY_ROTATION on mixed tape", () => {
    const res = classifyMarketRegime({
      benchmarkAboveSma50: true,
      benchmarkChangePct: 0.1,
      advancers: 950,
      decliners: 1050,
    });
    expect(res.regime).toBe("CHOPPY_ROTATION");
    expect(res.favoredBucket).toBe("MID_TREND_PULLBACK");
  });
});

describe("evaluateStrongSwingNearTrigger", () => {
  it("accepts a setup failing only timing/intraday gates", () => {
    const res = evaluateStrongSwingNearTrigger([
      { key: "price", passed: true, blocking: true },
      { key: "liquidity", passed: true, blocking: true },
      { key: "follow_through", passed: false, blocking: true },
      { key: "session_reversal", passed: false, blocking: true },
      { key: "live_spread", passed: false, blocking: true },
    ]);
    expect(res.eligible).toBe(true);
    expect(res.failedTimingGates).toEqual(["follow_through", "session_reversal", "live_spread"]);
  });

  it("rejects a setup failing a hard risk gate like liquidity or results_blackout", () => {
    const res = evaluateStrongSwingNearTrigger([
      { key: "liquidity", passed: false, blocking: true },
      { key: "follow_through", passed: false, blocking: true },
    ]);
    expect(res.eligible).toBe(false);
    expect(res.failedOtherGates).toEqual(["liquidity"]);
  });

  it("rejects a setup failing multiple non-timing technical gates", () => {
    const res = evaluateStrongSwingNearTrigger([
      { key: "trend", passed: false, blocking: true },
      { key: "volume", passed: false, blocking: true },
      { key: "follow_through", passed: false, blocking: true },
    ]);
    expect(res.eligible).toBe(false);
  });
});

describe("computeAtrLevels", () => {
  it("computes tighter invalidation stops for snapbacks than trend setups", () => {
    const trend = computeAtrLevels(200, 4.0, "TREND");
    const snap = computeAtrLevels(200, 4.0, "SNAPBACK", 225);
    expect(snap.riskPct).toBeLessThan(trend.riskPct);
    expect(snap.invalidationStop).toBeGreaterThan(trend.invalidationStop);
    expect(snap.targetZone).toBeGreaterThanOrEqual(225);
  });
});
