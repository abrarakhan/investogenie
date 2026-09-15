import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  getQuotesByAssetIds: vi.fn(),
  getFundamentalsByAssetIds: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ query: mocks.query }));
vi.mock("@/lib/quotes", () => ({ getQuotesByAssetIds: mocks.getQuotesByAssetIds }));
vi.mock("@/lib/fundamentals", () => ({ getFundamentalsByAssetIds: mocks.getFundamentalsByAssetIds }));
vi.mock("@/lib/market-calendar.mjs", () => ({
  isMarketOpenNow: () => true,
  latestExpectedSessionDate: () => "2026-09-15",
  refreshMarketHolidays: async () => true,
}));

import { runScreener } from "@/lib/screener";
import { DEFAULT_SETTINGS } from "@/lib/settings";

describe("runScreener selection", () => {
  beforeEach(() => {
    mocks.query.mockReset().mockResolvedValue([]);
    mocks.getQuotesByAssetIds.mockReset().mockResolvedValue(new Map());
    mocks.getFundamentalsByAssetIds.mockReset().mockResolvedValue(new Map());
  });

  it("filters shorts before applying a buy-only limit", async () => {
    await runScreener("IN", { ...DEFAULT_SETTINGS, includeShort: false }, { exchange: "NSE", limit: 20 });

    const [sql, params] = mocks.query.mock.calls[0];
    expect(sql).toContain("bias <> 'SHORT'");
    expect(sql).toContain("q.updated_at >= now() - interval '7 minutes'");
    expect(sql).toContain("limit $4");
    expect(params).toEqual(["2026-09-15", "IN", "NSE", 20]);
  });

  it("does not exclude shorts when they are enabled", async () => {
    await runScreener("IN", { ...DEFAULT_SETTINGS, includeShort: true }, { exchange: "NSE", limit: 20 });

    const [sql] = mocks.query.mock.calls[0];
    expect(sql).not.toContain("bias <> 'SHORT'");
  });
});
