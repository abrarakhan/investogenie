import { describe, expect, it } from "vitest";
import { classifyCoverageGaps, classifyFreshness, worstFreshnessStatus } from "./dataHealth";

describe("classifyFreshness", () => {
  it("marks data fresh inside cadence and stale after cadence", () => {
    expect(classifyFreshness({ lastSuccessAt: "2026-07-20T09:30:00Z", cadenceHours: 1, now: "2026-07-20T10:00:00Z" })).toBe("fresh");
    expect(classifyFreshness({ lastSuccessAt: "2026-07-20T08:30:00Z", cadenceHours: 1, now: "2026-07-20T10:00:00Z" })).toBe("stale");
  });

  it("treats failed or never-synced sources as failed", () => {
    expect(classifyFreshness({ lastSuccessAt: null, cadenceHours: 24, now: "2026-07-20T10:00:00Z" })).toBe("failed");
    expect(classifyFreshness({ lastSuccessAt: "2026-07-20T09:00:00Z", failed: true, cadenceHours: 24, now: "2026-07-20T10:00:00Z" })).toBe("failed");
  });
});

describe("classifyCoverageGaps", () => {
  it("detects quote-without-history as high severity for India", () => {
    const gaps = classifyCoverageGaps({
      symbol: "AAREYDRUGS",
      market: "IN",
      hasQuote: true,
      hasHistory: false,
      now: "2026-07-20T10:00:00Z",
    });

    expect(gaps).toContainEqual(expect.objectContaining({ issueType: "Quote but no history", severity: "high" }));
  });

  it("detects active swing signals on stale history as critical", () => {
    const gaps = classifyCoverageGaps({
      symbol: "GLOSTERLTD",
      market: "IN",
      hasQuote: true,
      quoteUpdatedAt: "2026-07-20T09:30:00Z",
      hasHistory: true,
      latestHistoryDate: "2026-07-10",
      activeSwingSignal: true,
      now: "2026-07-20T10:00:00Z",
    });

    expect(gaps[0]).toEqual(expect.objectContaining({ issueType: "Swing signal on stale data", severity: "critical" }));
  });

  it("detects universe assets with missing and stale fundamentals", () => {
    const missing = classifyCoverageGaps({ symbol: "AAPL", market: "US", inUniverse: true, hasFundamentals: false, now: "2026-07-20T10:00:00Z" });
    const stale = classifyCoverageGaps({ symbol: "MSFT", market: "US", inUniverse: true, hasFundamentals: true, latestFundamentalsDate: "2025-12-01", now: "2026-07-20T10:00:00Z" });

    expect(missing).toContainEqual(expect.objectContaining({ issueType: "No fundamentals", severity: "medium" }));
    expect(stale).toContainEqual(expect.objectContaining({ issueType: "Stale fundamentals", severity: "low" }));
  });
});

describe("worstFreshnessStatus", () => {
  it("returns the most serious status", () => {
    expect(worstFreshnessStatus(["fresh", "stale", "failed"])).toBe("failed");
  });
});
