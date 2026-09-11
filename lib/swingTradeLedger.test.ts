import { describe, expect, it } from "vitest";
import { calculateSwingTradeProgress, ledgerDateText, summarizeSwingTradeLedger, tradingDaysBetween } from "@/lib/swingTradeLedger";

describe("swing trade ledger progress", () => {
  it("keeps PostgreSQL date values on their local calendar day", () => {
    expect(ledgerDateText(new Date(2026, 8, 11))).toBe("2026-09-11");
  });

  it("counts trading sessions rather than weekends", () => {
    expect(tradingDaysBetween("2026-08-21", "2026-08-24")).toBe(1);
  });

  it("reports target progress and projected upside remaining", () => {
    const result = calculateSwingTradeProgress({
      status: "OPEN", boughtOn: "2026-08-20", buyPrice: 100, quantity: 10,
      currentPrice: 110, target: 120, stop: 94, trailingStop: 102,
      expectedDays: 8, asOf: "2026-08-25",
    });
    expect(result.daysHeld).toBe(3);
    expect(result.pnlPct).toBeCloseTo(10);
    expect(result.targetProgressPct).toBeCloseTo(50);
    expect(result.remainingUpsidePct).toBeCloseTo(9.0909);
    expect(result.state).toBe("ON_TRACK");
  });

  it("prioritises target and risk breaches over elapsed window", () => {
    const base = { status: "OPEN" as const, boughtOn: "2026-08-01", buyPrice: 100, quantity: 1, target: 120, stop: 94, trailingStop: 105, expectedDays: 5, asOf: "2026-08-25" };
    expect(calculateSwingTradeProgress({ ...base, currentPrice: 121 }).state).toBe("TARGET_REACHED");
    expect(calculateSwingTradeProgress({ ...base, currentPrice: 93 }).state).toBe("STOP_BREACHED");
    expect(calculateSwingTradeProgress({ ...base, currentPrice: 103 }).state).toBe("TRAIL_BREACHED");
    expect(calculateSwingTradeProgress({ ...base, currentPrice: 110 }).state).toBe("WINDOW_EXPIRED");
  });

  it("includes closed realized results in overall profit and loss", () => {
    const summary = summarizeSwingTradeLedger([
      { status: "OPEN", progress: { investedValue: 1_000, pnlValue: 125 } },
      { status: "OPEN", progress: { investedValue: 500, pnlValue: -25 } },
      { status: "CLOSED", progress: { investedValue: 2_000, pnlValue: 300 } },
      { status: "CLOSED", progress: { investedValue: 750, pnlValue: -100 } },
    ]);

    expect(summary).toEqual({
      openCount: 2,
      closedCount: 2,
      openInvestedValue: 1_500,
      unrealizedPnlValue: 100,
      realizedPnlValue: 200,
      overallPnlValue: 300,
    });
  });

  it("combines partial-sale profit with unrealized profit on remaining shares", () => {
    const remaining = calculateSwingTradeProgress({
      status: "OPEN", boughtOn: "2026-09-01", buyPrice: 100, quantity: 6,
      currentPrice: 105, target: 120, stop: 94, trailingStop: 98,
      expectedDays: 10, asOf: "2026-09-03",
    });
    const summary = summarizeSwingTradeLedger([{
      status: "OPEN",
      progress: remaining,
      realizedPnlValue: 40,
    }]);

    expect(summary.openInvestedValue).toBe(600);
    expect(summary.unrealizedPnlValue).toBe(30);
    expect(summary.realizedPnlValue).toBe(40);
    expect(summary.overallPnlValue).toBe(70);
  });
});
