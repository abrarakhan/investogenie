import { describe, expect, it } from "vitest";
import { buildLeaderboard, isEstablished, strategyKey, verdictFor, type BacktestStats, type EvidenceStats, type ForwardStats } from "@/lib/strategyLeaderboard";


const fwd = (avg: number, trades: number, sessions = trades): ForwardStats => ({ trades, avgReturnPct: avg, medianReturnPct: avg, winRatePct: 50, targetHits: 0, stopHits: 0, live: 0, stocks: trades, sessions });
const bt = (avg: number, trades: number, horizonSessions = 5): BacktestStats => ({ trades, avgReturnPct: avg, medianReturnPct: avg, winRatePct: 50, horizonSessions });
const own = (avg: number, trades: number): EvidenceStats => ({ trades, avgReturnPct: avg, medianReturnPct: avg, winRatePct: 50 });

describe("strategy leaderboard", () => {
  it("normalises forward-test method names", () => {
    expect(strategyKey("SWING:DARVAS")).toBe("DARVAS");
    expect(strategyKey("ENGINE:MOMENTUM_IGNITION_V2")).toBe("MOMENTUM_IGNITION_V2");
    expect(strategyKey("PROBABILITY")).toBe("PROBABILITY");
  });

  it("classifies by average return and sample size", () => {
    expect(verdictFor(2, 10)).toBe("PROFITABLE");
    expect(verdictFor(0.2, 10)).toBe("NEAR_BREAKEVEN");
    expect(verdictFor(-0.9, 10)).toBe("NEAR_BREAKEVEN");
    expect(verdictFor(-1, 10)).toBe("LOSING");
    expect(verdictFor(9, 4)).toBe("NOT_ENOUGH_DATA");
  });

  it("prefers the forward test, then the largest backtest, then the user's trades", () => {
    const rows = buildLeaderboard(
      new Map([["DARVAS", fwd(-3, 8)], ["MOMENTUM_IGNITION", fwd(5, 2)]]),
      new Map([["MOMENTUM_IGNITION", [bt(8.8, 7, 10), bt(1.7, 51, 5)]]]),
      new Map([["DEFAULT_SWING", own(2.8, 9)], ["PTJ", own(4, 1)]]),
    );
    expect(rows.map((r) => [r.strategy, r.primary?.source ?? null, r.verdict])).toEqual([
      ["DEFAULT_SWING", "ledger", "PROFITABLE"],
      ["MOMENTUM_IGNITION", "backtest", "PROFITABLE"],
      ["DARVAS", "forward", "LOSING"],
      ["PTJ", null, "NOT_ENOUGH_DATA"],
    ]);
    expect(rows[1].primary?.label).toBe("Backtest, 5 sessions");
    expect(rows[1].backtest.map((b) => b.horizonSessions)).toEqual([5, 10]);
  });

  it("treats a verdict as established only on a larger sample from enough separate days", () => {
    expect(isEstablished(29, 29)).toBe(false);
    expect(isEstablished(30, 9)).toBe(false);
    expect(isEstablished(30, 10)).toBe(true);
    expect(isEstablished(30, null)).toBe(true);
    const rows = buildLeaderboard(
      new Map([["A", fwd(3, 6)], ["B", fwd(2, 40, 4)], ["C", fwd(1, 40, 12)]]),
      new Map([["D", [bt(1.5, 51)]]]),
      new Map(),
    );
    expect(rows.map((r) => [r.strategy, r.verdict, r.established])).toEqual([
      ["A", "PROFITABLE", false],
      ["B", "PROFITABLE", false],
      ["D", "PROFITABLE", true],
      ["C", "PROFITABLE", true],
    ]);
  });
});
