import { describe, expect, it } from "vitest";
import { rankStrongSwingCandidates, rankSwingCandidates, swingTieBreakScore } from "./candidateRanking";

describe("candidate display ranking", () => {
  it("orders swing candidates by the active strategy score", () => {
    const rows = [
      { ticker: "DEFAULT_TOP", verdict: "LONG_BREAKOUT", score: 90, strategyLevels: { SIMONS: { score: 40 } } },
      { ticker: "SIMONS_TOP", verdict: "COILED_SPRING", score: 70, strategyLevels: { SIMONS: { score: 95 } } },
    ];

    expect(rankSwingCandidates(rows).map((row) => row.ticker)).toEqual(["DEFAULT_TOP", "SIMONS_TOP"]);
    expect(rankSwingCandidates(rows, "SIMONS").map((row) => row.ticker)).toEqual(["SIMONS_TOP", "DEFAULT_TOP"]);
  });

  it("ranks a strategy view on the strategy score even without a default setup", () => {
    const rows = [
      { ticker: "SETUP", verdict: "LONG_BREAKOUT", score: 90, strategyLevels: { DARVAS: { score: 0.5 } } },
      { ticker: "NO_SETUP", verdict: "NO_SETUP", score: 10, strategyLevels: { DARVAS: { score: 1 } } },
    ];

    expect(rankSwingCandidates(rows).map((row) => row.ticker)).toEqual(["SETUP", "NO_SETUP"]);
    expect(rankSwingCandidates(rows, "DARVAS").map((row) => row.ticker)).toEqual(["NO_SETUP", "SETUP"]);
  });

  it("orders strong swing states by actionability then strength", () => {
    const rows = [
      { ticker: "WATCH_HIGH", status: "WATCHLIST" as const, strengthScore: 95, score: 90 },
      { ticker: "READY_LOW", status: "EXECUTION_READY" as const, strengthScore: 75, score: 70 },
      { ticker: "READY_HIGH", status: "EXECUTION_READY" as const, strengthScore: 92, score: 85 },
      { ticker: "WAIT_ENTRY", status: "WAIT_FOR_ENTRY" as const, strengthScore: 98, score: 95 },
      { ticker: "RISK_OFF", status: "RISK_OFF" as const, strengthScore: 100, score: 99 },
      { ticker: "INVALID", status: "INVALIDATED" as const, strengthScore: 100, score: 99 },
    ];

    expect(rankStrongSwingCandidates(rows).map((row) => row.ticker)).toEqual([
      "READY_HIGH", "READY_LOW", "WAIT_ENTRY", "WATCH_HIGH", "RISK_OFF", "INVALID",
    ]);
  });

  it("breaks equal swing scores on breakout quality, not ticker name", () => {
    const rows = [
      { ticker: "AAA", verdict: "BREAKOUT_UNCONFIRMED", score: 0.45, rankScore: 0.2, strategyLevels: {} },
      { ticker: "ZZZ", verdict: "BREAKOUT_UNCONFIRMED", score: 0.45, rankScore: 0.8, strategyLevels: {} },
      { ticker: "MMM", verdict: "BREAKOUT_UNCONFIRMED", score: 0.45, rankScore: null, strategyLevels: {} },
      { ticker: "TOP", verdict: "LONG_BREAKOUT", score: 0.75, rankScore: 0.1, strategyLevels: {} },
    ];
    expect(rankSwingCandidates(rows).map((row) => row.ticker)).toEqual(["TOP", "ZZZ", "AAA", "MMM"]);
  });

  it("breaks equal strong swing strength on breakout quality", () => {
    const rows = [
      { ticker: "AAA", status: "WATCHLIST" as const, strengthScore: 80, score: 0.45, rankScore: 0.3 },
      { ticker: "ZZZ", status: "WATCHLIST" as const, strengthScore: 80, score: 0.45, rankScore: 0.6 },
    ];
    expect(rankStrongSwingCandidates(rows).map((row) => row.ticker)).toEqual(["ZZZ", "AAA"]);
  });
});

describe("swingTieBreakScore", () => {
  const base = { isBreakout: true, close: 110, donchianHigh: 106, upperBand: 108, atr: 2, volumeExpansion: 1.5, rsRating: 50 };

  it("averages clearance, volume and relative strength into 0..1", () => {
    const result = swingTieBreakScore(base);
    expect(result.breakoutClearanceAtr).toBe(2); // (110 - 106) / 2, measured from the Donchian high
    expect(result.rankScore).toBeCloseTo((1 + 0.5 + 49 / 98) / 3, 4);
  });

  it("measures an upper-band-only breakout from the band and saturates each input", () => {
    const result = swingTieBreakScore({ ...base, close: 109, donchianHigh: 112, volumeExpansion: 9, rsRating: 99 });
    expect(result.breakoutClearanceAtr).toBe(0.5);
    expect(result.rankScore).toBeCloseTo((0.25 + 1 + 1) / 3, 4);
  });

  it("gives no clearance credit without a breakout and no strength credit when unrated", () => {
    const result = swingTieBreakScore({ ...base, isBreakout: false, rsRating: null, volumeExpansion: 0 });
    expect(result).toEqual({ rankScore: 0, breakoutClearanceAtr: 0 });
  });
});
