import { describe, expect, it } from "vitest";
import { isEodFeaturesFresh, nextCalendarDate } from "@/lib/eodAssetFeatures";

describe("eodAssetFeatures freshness contract", () => {
  it("computes next calendar date in UTC without local-timezone drift", () => {
    expect(nextCalendarDate("2026-11-19")).toBe("2026-11-20");
    expect(nextCalendarDate("2026-12-31")).toBe("2027-01-01");
  });

  it("accepts prior-evening EOD materialization during the next live session", () => {
    // Materialized on Thursday 18:35 IST (cutoff Friday 2026-11-20, latest Thursday 2026-11-19).
    const meta = { cutoffDate: "2026-11-20", latestBarDate: "2026-11-19", rowCount: 2366 };
    expect(isEodFeaturesFresh(meta, {
      marketOpen: true,
      sessionDate: "2026-11-20",
      expectedSession: "2026-11-19",
    })).toBe(true);
  });

  it("carries Friday EOD cleanly across the weekend into Monday live session", () => {
    const meta = { cutoffDate: "2026-11-21", latestBarDate: "2026-11-20", rowCount: 2366 };
    expect(isEodFeaturesFresh(meta, {
      marketOpen: true,
      sessionDate: "2026-11-23",
      expectedSession: "2026-11-20",
    })).toBe(true);
  });

  it("accepts a pre-market refresh whose newest bar is still strictly before today's session", () => {
    const meta = { cutoffDate: "2026-11-21", latestBarDate: "2026-11-19", rowCount: 2366 };
    expect(isEodFeaturesFresh(meta, {
      marketOpen: true,
      sessionDate: "2026-11-20",
      expectedSession: "2026-11-19",
    })).toBe(true);
  });

  it("rejects a snapshot whose cutoff could include today's in-progress candle while market is open", () => {
    const meta = { cutoffDate: "2026-11-21", latestBarDate: "2026-11-20", rowCount: 2366 };
    expect(isEodFeaturesFresh(meta, {
      marketOpen: true,
      sessionDate: "2026-11-20",
      expectedSession: "2026-11-19",
    })).toBe(false);
  });

  it("rejects empty or lagging snapshots", () => {
    expect(isEodFeaturesFresh(null, {
      marketOpen: false,
      sessionDate: "2026-11-20",
      expectedSession: "2026-11-20",
    })).toBe(false);
    expect(isEodFeaturesFresh(
      { cutoffDate: "2026-11-20", latestBarDate: "2026-11-19", rowCount: 0 },
      { marketOpen: true, sessionDate: "2026-11-20", expectedSession: "2026-11-19" },
    )).toBe(false);
    expect(isEodFeaturesFresh(
      { cutoffDate: "2026-11-20", latestBarDate: "2026-11-19", rowCount: 2366 },
      { marketOpen: false, sessionDate: "2026-11-20", expectedSession: "2026-11-20" },
    )).toBe(false);
  });
});
