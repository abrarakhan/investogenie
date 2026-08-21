import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  getQuotesByAssetIds: vi.fn(),
  getFundamentalsByAssetIds: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ query: mocks.query }));
vi.mock("@/lib/quotes", () => ({ getQuotesByAssetIds: mocks.getQuotesByAssetIds }));
vi.mock("@/lib/fundamentals", () => ({ getFundamentalsByAssetIds: mocks.getFundamentalsByAssetIds }));

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
    expect(sql).toContain("limit $3");
    expect(params).toEqual(["IN", "NSE", 20]);
  });

  it("does not exclude shorts when they are enabled", async () => {
    await runScreener("IN", { ...DEFAULT_SETTINGS, includeShort: true }, { exchange: "NSE", limit: 20 });

    const [sql] = mocks.query.mock.calls[0];
    expect(sql).not.toContain("bias <> 'SHORT'");
  });
});
