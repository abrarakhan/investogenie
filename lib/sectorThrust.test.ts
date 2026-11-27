import { afterEach, describe, expect, it, vi } from "vitest";
import { getSectorThrustSnapshot, isSectorThrustRunStale } from "./sectorThrust";

vi.mock("@/lib/db", () => ({
  query: vi.fn(),
}));

import { query } from "@/lib/db";
const mockedQuery = vi.mocked(query);

afterEach(() => {
  vi.clearAllMocks();
});

describe("isSectorThrustRunStale", () => {
  it("marks a LIVE run stale after 10 minutes during open India market hours", () => {
    const now = new Date("2026-11-25T05:45:00Z"); // 11:15 IST (open)
    const oldCheckpoint = "2026-11-25T05:30:00Z"; // 15 min ago
    const freshCheckpoint = "2026-11-25T05:41:00Z"; // 4 min ago
    expect(isSectorThrustRunStale(oldCheckpoint, "IN", "LIVE", now)).toBe(true);
    expect(isSectorThrustRunStale(freshCheckpoint, "IN", "LIVE", now)).toBe(false);
  });

  it("does not mark an EOD run or closed-market run stale", () => {
    const afterHours = new Date("2026-11-25T13:00:00Z"); // 18:30 IST (closed)
    expect(isSectorThrustRunStale("2026-11-25T09:55:00Z", "IN", "LIVE", afterHours)).toBe(false);
    expect(isSectorThrustRunStale("2026-11-25T09:55:00Z", "IN", "EOD", new Date("2026-11-25T05:45:00Z"))).toBe(false);
  });
});

describe("getSectorThrustSnapshot", () => {
  it("returns explicit UNVERIFIED snapshot when no persisted run exists (e.g. US before soak)", async () => {
    mockedQuery.mockResolvedValueOnce([] as never);
    const snap = await getSectorThrustSnapshot("US");
    expect(snap.status).toBe("UNVERIFIED");
    expect(snap.unverifiedReason).toMatch(/US live Sector Thrust/i);
    expect(snap.groups).toEqual([]);
  });

  it("maps persisted run, groups, and Leaders/Catch-Up members cleanly", async () => {
    mockedQuery
      .mockResolvedValueOnce([{
        id: 42,
        session_date: "2026-11-26",
        checkpoint_at: "2026-11-26T10:00:00Z",
        mode: "EOD",
        rule_version: "sector_thrust_v1",
        taxonomy_version: "v1",
        curve_version: "in-v1",
        status: "EOD",
        unverified_reason: null,
        eligible_universe_count: 1350,
        unclassified_count: 40,
        scan_duration_ms: 1850,
      }] as never)
      .mockResolvedValueOnce([{
        id: 101,
        group_level: "INDUSTRY",
        group_key: "sugar_ethanol",
        group_label: "Sugar & Ethanol",
        parent_sector: "Consumer Defensive",
        status: "ACTIVE",
        unverified_reason: null,
        eligible_count: 10,
        price_fresh_count: 10,
        volume_fresh_count: 10,
        qualifying_count: 7,
        median_return_pct: "8.4",
        median_rvol: "2.3",
        volume_confirmation_route: "MEDIAN_PACE",
        first_triggered_at: "2026-11-26T04:30:00Z",
        related_news: [{ title: "ISMA cuts sugar forecast 15%", source: "Reuters", publishedAt: "2026-11-26T04:10:00Z", url: null }],
      }] as never)
      .mockResolvedValueOnce([
        {
          group_id: 101,
          asset_id: "a1",
          ticker: "DHAMPURSUG",
          name: "Dhampur Sugar Mills",
          role: "LEADER",
          price: "181.8",
          return_pct: "14.1",
          rvol: "4.2",
          avg_traded_value_20d: "45000000",
          atr_pct: "4.8",
          atr_extension: "2.94",
          first_seen_at: "2026-11-26T04:30:00Z",
          reason: "Leader: +14.1% (>= +3.5%) · 4.2x pace",
          reference_entry: "181.8",
          invalidation_stop: "168.7",
          target_zone: "208.0",
        },
        {
          group_id: 101,
          asset_id: "a2",
          ticker: "TRIVENI",
          name: "Triveni Engineering",
          role: "CATCH_UP",
          price: "410.0",
          return_pct: "2.1",
          rvol: "1.6",
          avg_traded_value_20d: "80000000",
          atr_pct: "3.2",
          atr_extension: "0.66",
          first_seen_at: "2026-11-26T04:35:00Z",
          reason: "Catch-Up: +2.1% (0.66 ATR) · 1.6x pace",
          reference_entry: "410.0",
          invalidation_stop: "390.3",
          target_zone: "449.4",
        },
      ] as never);

    const snap = await getSectorThrustSnapshot("IN");
    expect(snap.status).toBe("EOD");
    expect(snap.activeGroupCount).toBe(1);
    expect(snap.groups[0].groupLabel).toBe("Sugar & Ethanol");
    expect(snap.groups[0].leaders.map((m) => m.ticker)).toEqual(["DHAMPURSUG"]);
    expect(snap.groups[0].catchUp[0].atrExtension).toBe(0.66);
  });
});
