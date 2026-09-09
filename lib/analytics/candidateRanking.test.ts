import { describe, expect, it } from "vitest";
import { rankStrongSwingCandidates, rankSwingCandidates } from "./candidateRanking";

describe("candidate display ranking", () => {
  it("orders swing candidates by the active strategy score", () => {
    const rows = [
      { ticker: "DEFAULT_TOP", verdict: "LONG_BREAKOUT", score: 90, strategyLevels: { SIMONS: { score: 40 } } },
      { ticker: "SIMONS_TOP", verdict: "COILED_SPRING", score: 70, strategyLevels: { SIMONS: { score: 95 } } },
    ];

    expect(rankSwingCandidates(rows).map((row) => row.ticker)).toEqual(["DEFAULT_TOP", "SIMONS_TOP"]);
    expect(rankSwingCandidates(rows, "SIMONS").map((row) => row.ticker)).toEqual(["SIMONS_TOP", "DEFAULT_TOP"]);
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
});
