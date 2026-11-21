import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: async () => [] }));

import { compareTrendCandidates, type TrendContinuationStatus } from "@/lib/trendContinuation";

const row = (name: string, status: TrendContinuationStatus, score: number, staircase = false) => ({
  name, status, ready: status === "TREND_CONTINUATION_READY", score, metrics: { developing_staircase: staircase },
});

describe("trend continuation ordering", () => {
  it("puts entries first, then second-day staircases, and too-late stocks last", () => {
    const rows = [
      row("extended-100", "EXTENDED_RISK", 100),
      row("impulse-98", "IMPULSE_DETECTED", 98),
      row("stair-64", "IMPULSE_DETECTED", 64, true),
      row("watch-70", "CONTINUATION_WATCH", 70),
      row("ready-80", "TREND_CONTINUATION_READY", 80),
      row("stair-ready-75", "TREND_CONTINUATION_READY", 75, true),
    ].sort(compareTrendCandidates);
    expect(rows.map((item) => item.name)).toEqual([
      "stair-ready-75", "ready-80", "stair-64", "watch-70", "impulse-98", "extended-100",
    ]);
  });

  it("ranks active Mid-Way setups ahead of watch-only developing staircases so they are never truncated", () => {
    const midway = {
      name: "midway-stage2",
      status: "CONTINUATION_WATCH" as TrendContinuationStatus,
      ready: false,
      score: 60,
      metrics: { setup_variant: "STAGE2_IMPULSE", developing_staircase: false },
    };
    const rows = [
      row("stair-90", "IMPULSE_DETECTED", 90, true),
      midway,
      row("ready-80", "TREND_CONTINUATION_READY", 80),
    ].sort(compareTrendCandidates);
    expect(rows.map((item) => item.name)).toEqual(["ready-80", "midway-stage2", "stair-90"]);
  });
});
