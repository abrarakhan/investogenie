import { describe, expect, it } from "vitest";
import { classifyBackfillTier, isMarketOpen, shouldSkipMarketForBackfill } from "./classifier";
import { filterNewQueueRows, planQueueRows, shouldContinueBatch, statusAfterFailure } from "./planner";
import type { BackfillCandidate } from "./types";

const candidate = (overrides: Partial<BackfillCandidate>): BackfillCandidate => ({
  assetId: "asset-1",
  symbol: "TEST",
  market: "IN",
  ...overrides,
});

describe("classifyBackfillTier", () => {
  it("prioritizes all Indian equities before other markets", () => {
    expect(classifyBackfillTier(candidate({ market: "IN", inNifty500: true, inPortfolio: true }))).toBe(1);
    expect(classifyBackfillTier(candidate({ market: "IN" }))).toBe(1);
    expect(classifyBackfillTier(candidate({ market: "IN", exchange: "BSE" }))).toBe(1);
  });

  it("prioritizes US screener universes as tier 2", () => {
    expect(classifyBackfillTier(candidate({ market: "US", inSp500: true }))).toBe(2);
    expect(classifyBackfillTier(candidate({ market: "US", inNasdaq100: true }))).toBe(2);
  });

  it("places user holdings before active signals, then remaining market buckets", () => {
    expect(classifyBackfillTier(candidate({ market: "US", inPortfolio: true, hasActiveSignal: true }))).toBe(3);
    expect(classifyBackfillTier(candidate({ market: "US" }))).toBe(6);
  });
});

describe("queue planning", () => {
  it("plans rows and filters duplicate asset ids idempotently", () => {
    const rows = planQueueRows([
      candidate({ assetId: "a", symbol: "A", market: "IN", inNifty500: true }),
      candidate({ assetId: "a", symbol: "A-DUP", market: "IN" }),
      candidate({ assetId: "b", symbol: "B", market: "US" }),
    ]);

    expect(filterNewQueueRows(rows, new Set(["existing"]))).toHaveLength(2);
    expect(filterNewQueueRows(rows, new Set(["a"]))).toEqual([expect.objectContaining({ assetId: "b" })]);
  });

  it("stops at batch size", () => {
    expect(shouldContinueBatch(99, 100)).toBe(true);
    expect(shouldContinueBatch(100, 100)).toBe(false);
  });

  it("retries failures until the max attempt", () => {
    expect(statusAfterFailure(0, 3)).toBe("pending");
    expect(statusAfterFailure(1, 3)).toBe("pending");
    expect(statusAfterFailure(2, 3)).toBe("failed");
  });
});

describe("market-hours skip", () => {
  it("detects Indian market hours", () => {
    expect(isMarketOpen("IN", new Date("2026-07-20T05:00:00Z"))).toBe(true); // 10:30 IST Monday
    expect(isMarketOpen("IN", new Date("2026-07-20T12:00:00Z"))).toBe(false); // 17:30 IST
  });

  it("honors skip during market hours switch", () => {
    const at = new Date("2026-07-20T14:00:00Z"); // 10:00 NY Monday
    expect(shouldSkipMarketForBackfill({ market: "US", skipDuringMarketHours: true, at })).toBe(true);
    expect(shouldSkipMarketForBackfill({ market: "US", skipDuringMarketHours: false, at })).toBe(false);
  });
});
