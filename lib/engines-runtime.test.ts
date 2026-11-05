import { describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ sql: "", params: [] as unknown[] }));

vi.mock("@/lib/db", () => ({
  query: async (sql: string, params: unknown[]) => {
    db.sql = sql;
    db.params = params;
    return [];
  },
}));

vi.mock("@/lib/market-calendar.mjs", () => ({
  refreshMarketHolidays: async () => true,
  latestSignalSessionDate: () => "2026-11-05",
  isMarketOpenNow: () => true,
}));

import { getTopSwingSetups } from "@/lib/engines-runtime";

describe("dashboard top swing setup freshness", () => {
  it("requires a recently updated quote while the market is open", async () => {
    await getTopSwingSetups("IN", undefined, 6);
    expect(db.sql).toContain("q.updated_at >= now() - interval '7 minutes'");
    expect(db.params).toEqual(["IN", 12, "2026-11-05", true]);
  });
});
