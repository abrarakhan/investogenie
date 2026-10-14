import { describe, expect, it } from "vitest";
import {
  assessArmedSwing, rankArmedSwingCandidates, resultsCalendarCoverage, type ArmedSwingInput,
} from "@/lib/analytics/armedSwing";
import type { OHLCV } from "@/lib/types";

const day = (index: number) => new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10);

/**
 * 240 sessions of steady advance into a 20-session base that contracts: a wide first half
 * (range ~6) and a tight second half (range ~2) just under a 150 pivot, with volume drying up.
 */
function basingLeader(count = 260): OHLCV[] {
  const bars: OHLCV[] = [];
  for (let index = 0; index < count; index++) {
    const fromEnd = count - 1 - index;
    let close: number;
    let spread: number;
    if (fromEnd >= 20) {
      close = 80 + (index / (count - 20)) * 66; // rises to ~146
      spread = 1.2;
    } else if (fromEnd >= 10) {
      close = 145 + (index % 2 === 0 ? 2 : -2); // wide first half of the base
      spread = 1.5;
    } else {
      close = 148 + (index % 2 === 0 ? 0.6 : -0.6); // tight second half
      spread = 0.6;
    }
    bars.push({
      date: day(index), open: close - 0.2, high: Math.min(close + spread, 150), low: close - spread, close,
      volume: fromEnd < 5 ? 600_000 : 1_000_000, openInterest: null,
    });
  }
  return bars;
}

const benchmark = (count = 260): OHLCV[] => Array.from({ length: count }, (_, index) => {
  const close = 100 + index * 0.05;
  return { date: day(index), open: close, high: close + 0.3, low: close - 0.3, close, volume: 1, openInterest: null };
});

const freshExecution = (price: number) => ({
  quoteFresh: true, quoteAgeMinutes: 1,
  bestBid: price - 0.05, bestAsk: price + 0.05,
  lowerCircuit: price * 0.8, upperCircuit: price * 1.2,
});

const input = (overrides: Partial<ArmedSwingInput> = {}): ArmedSwingInput => {
  const bars = basingLeader();
  return {
    market: "IN", bars, benchmarkBars: benchmark(), currentPrice: bars.at(-1)!.close,
    rsPercentile: 92, risk: { targetRR: 2, trailAtrMult: 3 },
    execution: freshExecution(bars.at(-1)!.close),
    results: { verified: true, sessionsToNext: 30, nextDate: "2026-12-01", detail: "Next results 2026-12-01." },
    ...overrides,
  };
};

describe("assessArmedSwing", () => {
  it("arms a tight stage-2 base below its pivot with a buy-stop plan", () => {
    const result = assessArmedSwing(input());
    expect(result.status).toBe("ARMED");
    expect(result.plan.pivot).toBe(149.2); // highest high of the 20-session base
    expect(result.plan.trigger).toBeGreaterThan(149.2);
    expect(result.plan.limit).toBeGreaterThan(result.plan.trigger);
    expect(result.plan.stop).toBeLessThan(147.5); // below the last contraction low
    expect(result.plan.target).toBeCloseTo(result.plan.trigger + 2 * (result.plan.trigger - result.plan.stop), 1);
    expect(result.plan.trail).toBeGreaterThanOrEqual(result.plan.stop);
    expect(result.plan.trail).toBeLessThan(result.plan.trigger);
  });

  it("enters in the buy zone on an intraday breakout with confirming volume pace", () => {
    const base = assessArmedSwing(input());
    const result = assessArmedSwing(input({
      currentPrice: base.plan.trigger + 0.05,
      // 20-session average is 0.9M (five dry-up sessions at 0.6M): 1M / (0.9M x 0.4) = 2.78x.
      liveSession: { volume: 1_000_000, progress: 0.4 },
    }));
    expect(result.status).toBe("BUY_ZONE");
    expect(result.volumePace).toBeCloseTo(2.78, 2);
  });

  it("does not confirm a breakout on thin volume", () => {
    const base = assessArmedSwing(input());
    const result = assessArmedSwing(input({
      currentPrice: base.plan.trigger + 0.05,
      liveSession: { volume: 300_000, progress: 0.5 },
    }));
    expect(result.status).toBe("TRIGGERED_UNCONFIRMED");
  });

  it("marks a move beyond the limit as extended rather than chasing it", () => {
    const base = assessArmedSwing(input());
    expect(assessArmedSwing(input({ currentPrice: base.plan.limit + 1 })).status).toBe("EXTENDED");
  });

  it("invalidates when price breaks the structure stop", () => {
    const base = assessArmedSwing(input());
    expect(assessArmedSwing(input({ currentPrice: base.plan.stop - 0.5 })).status).toBe("INVALIDATED");
  });

  it("keeps laggards forming: relative strength must be top quintile", () => {
    const result = assessArmedSwing(input({ rsPercentile: 55 }));
    expect(result.status).toBe("FORMING");
    expect(result.gates.find((gate) => gate.key === "relative_strength")?.passed).toBe(false);
  });

  it("goes risk off on stale data against the exchange calendar", () => {
    expect(assessArmedSwing(input({ expectedSessionLag: 3 })).status).toBe("RISK_OFF");
  });

  describe("fails closed without live execution data", () => {
    const blocked = (overrides: Partial<ArmedSwingInput>) => assessArmedSwing(input(overrides)).status;
    const price = basingLeader().at(-1)!.close;

    it("blocks when the execution quote is missing", () => {
      expect(blocked({ execution: null })).toBe("UNVERIFIED");
    });
    it("blocks on a stale quote or a closed market", () => {
      expect(blocked({ execution: { ...freshExecution(price), quoteFresh: false, quoteAgeMinutes: 12 } })).toBe("UNVERIFIED");
      expect(blocked({ execution: { ...freshExecution(price), quoteFresh: false, quoteAgeMinutes: null } })).toBe("UNVERIFIED");
    });
    it("blocks when bid/ask depth or circuit bands are absent", () => {
      expect(blocked({ execution: { ...freshExecution(price), bestBid: null } })).toBe("UNVERIFIED");
      expect(blocked({ execution: { ...freshExecution(price), upperCircuit: null } })).toBe("UNVERIFIED");
    });
    it("blocks a triggered breakout too, not only armed setups", () => {
      const trigger = assessArmedSwing(input()).plan.trigger;
      expect(blocked({ currentPrice: trigger + 0.05, liveSession: { volume: 2_000_000, progress: 0.5 }, execution: null }))
        .toBe("UNVERIFIED");
    });
    it("treats a wide spread or a limit above the upper circuit as risk off", () => {
      expect(blocked({ execution: { ...freshExecution(price), bestBid: price - 2, bestAsk: price + 2 } })).toBe("RISK_OFF");
      expect(blocked({ execution: { ...freshExecution(price), upperCircuit: price * 1.005 } })).toBe("RISK_OFF");
    });
  });

  describe("results blackout", () => {
    it("blocks new entries within three sessions of results", () => {
      const result = assessArmedSwing(input({
        results: { verified: true, sessionsToNext: 2, nextDate: "2025-09-20", detail: "Next results 2025-09-20." },
      }));
      expect(result.status).toBe("RISK_OFF");
      expect(result.gates.find((gate) => gate.key === "results_blackout")?.passed).toBe(false);
    });
    it("blocks when the calendar is unverified or unavailable", () => {
      expect(assessArmedSwing(input({ results: null })).status).toBe("UNVERIFIED");
      expect(assessArmedSwing(input({
        results: { verified: false, sessionsToNext: null, nextDate: null, detail: "Unknown." },
      })).status).toBe("UNVERIFIED");
    });
  });

  it("ranks actionable statuses first", () => {
    const ranked = rankArmedSwingCandidates([
      { ticker: "B", status: "FORMING", rsPercentile: 99, distanceToTriggerAtr: 0.1, strengthScore: 90 },
      { ticker: "A", status: "ARMED", rsPercentile: 81, distanceToTriggerAtr: 1, strengthScore: 100 },
      { ticker: "C", status: "BUY_ZONE", rsPercentile: 85, distanceToTriggerAtr: -0.1, strengthScore: 100 },
    ]);
    expect(ranked.map((item) => item.ticker)).toEqual(["C", "A", "B"]);
  });
});

describe("resultsCalendarCoverage", () => {
  const today = "2026-10-13";
  it("requires a check within seven days", () => {
    expect(resultsCalendarCoverage({ today, lastSuccessAt: "2026-10-01T02:00:00Z", nextDate: "2026-10-30", lastPastDate: null }).verified).toBe(false);
    expect(resultsCalendarCoverage({ today, lastSuccessAt: null, nextDate: "2026-10-30", lastPastDate: null }).verified).toBe(false);
  });
  it("accepts a known upcoming date, or a recent past release", () => {
    expect(resultsCalendarCoverage({ today, lastSuccessAt: "2026-10-12T02:00:00Z", nextDate: "2026-10-30", lastPastDate: null }).verified).toBe(true);
    expect(resultsCalendarCoverage({ today, lastSuccessAt: "2026-10-12T02:00:00Z", nextDate: null, lastPastDate: "2026-08-20" }).verified).toBe(true);
  });
  it("treats an empty or old calendar as unknown, not as no results", () => {
    expect(resultsCalendarCoverage({ today, lastSuccessAt: "2026-10-12T02:00:00Z", nextDate: null, lastPastDate: null }).verified).toBe(false);
    expect(resultsCalendarCoverage({ today, lastSuccessAt: "2026-10-12T02:00:00Z", nextDate: null, lastPastDate: "2026-06-01" }).verified).toBe(false);
  });
  it("accepts same-day authoritative NSE negative coverage for the full blackout window", () => {
    expect(resultsCalendarCoverage({
      today, lastSuccessAt: "2026-10-13T02:00:00Z", nextDate: null, lastPastDate: null,
      authoritativeSource: "NSE_CALENDAR", authoritativeAsOf: today,
      authoritativeCoverageFrom: "2026-10-14", authoritativeCoverageThrough: "2026-11-13",
      requiredCoverageFrom: "2026-10-14", requiredCoverageThrough: "2026-10-16",
    }).verified).toBe(true);
  });
  it("rejects stale or incomplete authoritative NSE coverage", () => {
    const base = {
      today, lastSuccessAt: "2026-10-13T02:00:00Z", nextDate: null, lastPastDate: null,
      authoritativeSource: "NSE_CALENDAR", authoritativeAsOf: "2026-10-12",
      authoritativeCoverageFrom: "2026-10-14", authoritativeCoverageThrough: "2026-11-13",
      requiredCoverageFrom: "2026-10-14", requiredCoverageThrough: "2026-10-16",
    };
    expect(resultsCalendarCoverage(base).verified).toBe(false);
    expect(resultsCalendarCoverage({ ...base, authoritativeAsOf: today, authoritativeCoverageThrough: "2026-10-15" }).verified).toBe(false);
  });
});
