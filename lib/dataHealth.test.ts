import { describe, expect, it } from "vitest";
import {
  classifyCoverageGaps, classifyFreshness, classifySourceFreshness, worstFreshnessStatus,
  type SourceRow,
} from "./dataHealth";

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

  it("does not call Friday's NSE/BSE history stale over the weekend", () => {
    // Friday 2026-07-24 is the last trading session before the weekend.
    const fridayBar = "2026-07-24";
    const saturday = classifyCoverageGaps({
      symbol: "RELIANCE", market: "IN", hasHistory: true, latestHistoryDate: fridayBar,
      now: "2026-07-25T04:30:00Z", // Saturday 10:00 IST
    });
    const sunday = classifyCoverageGaps({
      symbol: "RELIANCE", market: "IN", hasHistory: true, latestHistoryDate: fridayBar,
      now: "2026-07-26T04:30:00Z", // Sunday 10:00 IST
    });
    const mondayMorning = classifyCoverageGaps({
      symbol: "RELIANCE", market: "IN", hasHistory: true, latestHistoryDate: fridayBar,
      now: "2026-07-27T04:30:00Z", // Monday 10:00 IST, before market close/bhavcopy
    });

    expect(saturday).not.toContainEqual(expect.objectContaining({ issueType: "History stale" }));
    expect(sunday).not.toContainEqual(expect.objectContaining({ issueType: "History stale" }));
    expect(mondayMorning).not.toContainEqual(expect.objectContaining({ issueType: "History stale" }));
  });

  it("calls Friday's NSE/BSE history stale once Monday's own session has closed", () => {
    const gaps = classifyCoverageGaps({
      symbol: "RELIANCE", market: "IN", hasHistory: true, latestHistoryDate: "2026-07-24",
      now: "2026-07-27T13:30:00Z", // Monday 19:00 IST, after the bhavcopy publication window
    });

    expect(gaps).toContainEqual(expect.objectContaining({ issueType: "History stale" }));
  });

  it("detects universe assets with missing and stale fundamentals", () => {
    const missing = classifyCoverageGaps({ symbol: "AAPL", market: "US", inUniverse: true, hasFundamentals: false, now: "2026-07-20T10:00:00Z" });
    const stale = classifyCoverageGaps({ symbol: "MSFT", market: "US", inUniverse: true, hasFundamentals: true, latestFundamentalsDate: "2025-12-01", now: "2026-07-20T10:00:00Z" });

    expect(missing).toContainEqual(expect.objectContaining({ issueType: "No fundamentals", severity: "medium" }));
    expect(stale).toContainEqual(expect.objectContaining({ issueType: "Stale fundamentals", severity: "low" }));
  });
});

describe("classifySourceFreshness — NSE/BSE OHLCV History source cards", () => {
  // quote_as_of carries the OHLCV bar date as a plain 'YYYY-MM-DD' text cast
  // (see getDataHealthSummary) — deliberately NOT derived from last_success_at,
  // which round-trips through a JS Date and can shift by a day depending on
  // the host's local timezone. last_success_at is included here only because
  // the row shape requires it; classifySourceFreshness must ignore it for
  // these two sources.
  const fridayRow: SourceRow = {
    source: "NSE OHLCV History",
    last_success_at: "2026-07-23T18:30:00.000Z", // deliberately the "wrong" shifted value
    quote_as_of: "2026-07-24", // the correct IST calendar date (Friday)
    record_count: 2416,
    failed: false,
    cadence_hours: 24,
    detail: "NSE assets with OHLCV bars",
  };

  it("stays fresh through the weekend", () => {
    expect(classifySourceFreshness(fridayRow, new Date("2026-07-25T04:30:00Z"), "")).toBe("fresh"); // Sat 10:00 IST
    expect(classifySourceFreshness(fridayRow, new Date("2026-07-26T04:30:00Z"), "")).toBe("fresh"); // Sun 10:00 IST
    expect(classifySourceFreshness(fridayRow, new Date("2026-07-27T04:30:00Z"), "")).toBe("fresh"); // Mon 10:00 IST, before close
  });

  it("degrades to stale (not straight to failed) once Monday's own session closes", () => {
    expect(classifySourceFreshness(fridayRow, new Date("2026-07-27T13:30:00Z"), "")).toBe("stale"); // Mon 19:00 IST
  });

  it("only fails after a genuinely stuck multi-day gap", () => {
    const staleRow: SourceRow = { ...fridayRow, quote_as_of: "2026-07-10" };
    expect(classifySourceFreshness(staleRow, new Date("2026-07-27T13:30:00Z"), "")).toBe("failed");
  });
});

describe("worstFreshnessStatus", () => {
  it("returns the most serious status", () => {
    expect(worstFreshnessStatus(["fresh", "stale", "failed"])).toBe("failed");
  });
});
