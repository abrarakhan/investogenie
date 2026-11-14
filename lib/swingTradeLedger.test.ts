import { describe, expect, it } from "vitest";
import { POST_ENTRY_TRAIL_FROM, usesPostEntryNextBarTrail, calculateRecommendedGttStop, calculateSwingTradeProgress, calculateXirr, ledgerDateText, summarizeSwingTradeLedger, tradingDaysBetween } from "@/lib/swingTradeLedger";

describe("swing trade ledger progress", () => {
  it("ratchets protection to break-even after the trade reaches 0.75R", () => {
    expect(calculateRecommendedGttStop({
      buyPrice: 61,
      projectedStop: 56.54,
      projectedTrailingStop: 52.09,
      trailingDistance: 8.91,
      highestHigh: 65,
      currentPrice: 64.59,
    })).toEqual({ recommendedStop: 61, breakEvenActivated: true });
  });

  it("retains the initial stop before the break-even activation threshold", () => {
    expect(calculateRecommendedGttStop({
      buyPrice: 61,
      projectedStop: 56.54,
      projectedTrailingStop: 52.09,
      trailingDistance: 8.91,
      highestHigh: 63,
      currentPrice: 62.5,
    })).toEqual({ recommendedStop: 56.54, breakEvenActivated: false });
  });

  it("advances a versioned Strong Swing trail only from completed sessions after entry", () => {
    const strict = calculateRecommendedGttStop({
      buyPrice: 100,
      projectedStop: 94,
      projectedTrailingStop: 94,
      trailingDistance: 9,
      highestHigh: 120,
      currentPrice: 121,
      postEntryCompletedHigh: 112,
      postEntryNextBarPolicy: true,
    });
    expect(strict).toEqual({ recommendedStop: 103, breakEvenActivated: true });
  });

  it("does not use the entry-day high or live price in the versioned Strong Swing trail", () => {
    const strict = calculateRecommendedGttStop({
      buyPrice: 100,
      projectedStop: 94,
      projectedTrailingStop: 94,
      trailingDistance: 9,
      highestHigh: 120,
      currentPrice: 121,
      postEntryCompletedHigh: null,
      postEntryNextBarPolicy: true,
    });
    expect(strict).toEqual({ recommendedStop: 94, breakEvenActivated: false });
  });

  it("applies the next-bar trail to every strategy's trades bought from the cutover on", () => {
    expect(usesPostEntryNextBarTrail(POST_ENTRY_TRAIL_FROM, false)).toBe(true);
    expect(usesPostEntryNextBarTrail("2026-12-01", false)).toBe(true);
  });

  it("leaves trades opened before the cutover on the stop they were already shown", () => {
    expect(usesPostEntryNextBarTrail("2026-11-13", false)).toBe(false);
    expect(usesPostEntryNextBarTrail(null, false)).toBe(false);
    expect(usesPostEntryNextBarTrail("2026-11-13", true)).toBe(true);
  });

  it("keeps PostgreSQL date values on their local calendar day", () => {
    expect(ledgerDateText(new Date(2026, 8, 11))).toBe("2026-09-11");
  });

  it("counts trading sessions rather than weekends", () => {
    expect(tradingDaysBetween("2026-08-21", "2026-08-24")).toBe(1);
    expect(tradingDaysBetween("2026-11-06", "2026-11-09", "IN")).toBe(2);
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
      totalInvestedValue: 4_250,
      capitalEmployedValue: 4_250,
      currentOpenValue: 1_600,
      roiPct: 300 / 4_250 * 100,
      xirrPct: null,
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

  it("calculates annualized XIRR from dated cash flows", () => {
    const xirr = calculateXirr([
      { date: "2025-01-01", amount: -100_000 },
      { date: "2026-01-01", amount: 110_000 },
    ]);
    expect(xirr).toBeCloseTo(10, 5);
  });

  it("uses broker purchase, sale and realized values for portfolio returns", () => {
    const summary = summarizeSwingTradeLedger([{
      status: "CLOSED",
      boughtOn: "2026-09-01",
      closedOn: "2026-09-11",
      purchaseValue: 10_050,
      quantity: 100,
      remainingQuantity: 0,
      currentPrice: null,
      progress: { investedValue: 10_000, pnlValue: 1_000 },
      realizedPnlValue: 900,
      exits: [{ id: "sale", soldOn: "2026-09-11", quantity: 100, exitPrice: 110, saleValue: 10_950, realizedPnlValue: 900, reason: null }],
    }]);
    expect(summary.realizedPnlValue).toBe(900);
    expect(summary.overallPnlValue).toBe(900);
    expect(summary.roiPct).toBeCloseTo(8.9552, 3);
    expect(summary.xirrPct).not.toBeNull();
  });

  it("funds a same-day purchase before crediting its sale proceeds", () => {
    const summary = summarizeSwingTradeLedger([{
      status: "CLOSED",
      boughtOn: "2026-10-05",
      closedOn: "2026-10-05",
      purchaseValue: 178_415,
      quantity: 850,
      remainingQuantity: 0,
      currentPrice: null,
      progress: { investedValue: 178_415, pnlValue: -2_932.50 },
      realizedPnlValue: -2_932.50,
      exits: [{ id: "same-day", soldOn: "2026-10-05", quantity: 850, exitPrice: 206.45, saleValue: 175_482.50, realizedPnlValue: -2_932.50, reason: null }],
    }]);

    expect(summary.capitalEmployedValue).toBe(178_415);
    expect(summary.roiPct).toBeCloseTo(-1.6436, 3);
    expect(summary.xirrPct).toBeNull();
  });

  it("recycles sale proceeds instead of counting every purchase as fresh capital", () => {
    const summary = summarizeSwingTradeLedger([
      {
        status: "CLOSED", boughtOn: "2026-08-18", closedOn: "2026-09-02",
        purchaseValue: 65_988.80, quantity: 620, remainingQuantity: 0, currentPrice: null,
        progress: { investedValue: 65_988.80, pnlValue: 4_724.62 }, realizedPnlValue: 4_724.62,
        exits: [{ id: "global", soldOn: "2026-09-02", quantity: 620, exitPrice: 0, saleValue: 70_713.42, realizedPnlValue: 4_724.62, reason: null }],
      },
      {
        status: "CLOSED", boughtOn: "2026-08-24", closedOn: "2026-09-02",
        purchaseValue: 99_571.15, quantity: 620, remainingQuantity: 0, currentPrice: null,
        progress: { investedValue: 99_571.15, pnlValue: -3_616.06 }, realizedPnlValue: -3_616.06,
        exits: [{ id: "fedfina", soldOn: "2026-09-02", quantity: 620, exitPrice: 0, saleValue: 95_955.09, realizedPnlValue: -3_616.06, reason: null }],
      },
      {
        status: "CLOSED", boughtOn: "2026-09-03", closedOn: "2026-09-08",
        purchaseValue: 167_239.43, quantity: 98, remainingQuantity: 0, currentPrice: null,
        progress: { investedValue: 167_239.43, pnlValue: 13_316.54 }, realizedPnlValue: 13_316.54,
        exits: [{ id: "axis", soldOn: "2026-09-08", quantity: 98, exitPrice: 0, saleValue: 180_555.97, realizedPnlValue: 13_316.54, reason: null }],
      },
    ]);
    expect(summary.totalInvestedValue).toBeCloseTo(332_799.38, 2);
    expect(summary.capitalEmployedValue).toBeCloseTo(166_130.87, 2);
    expect(summary.roiPct).toBeCloseTo(8.682, 2);
    expect(summary.xirrPct).not.toBeNull();
  });
});

describe("strategy exit line after purchase", () => {
  it("applies only to the five named strategies bought from the cut-over date", async () => {
    const { usesStrategyFollowUp } = await import("@/lib/swingTradeLedger");
    expect(usesStrategyFollowUp("PTJ", POST_ENTRY_TRAIL_FROM)).toBe(true);
    expect(usesStrategyFollowUp("QULLAMAGGIE", "2026-12-01")).toBe(true);
    // Trades already open keep the ATR trail they were shown.
    expect(usesStrategyFollowUp("PTJ", "2026-11-13")).toBe(false);
    expect(usesStrategyFollowUp("DEFAULT_SWING", "2026-12-01")).toBe(false);
    expect(usesStrategyFollowUp("STRONG_SWING", "2026-12-01")).toBe(false);
  });

  it("replaces the ATR chandelier with the strategy line, never below the frozen trail", async () => {
    const { strategyLineStopInputs } = await import("@/lib/swingTradeLedger");
    const line = (value: number | null) => ({ line: value, lineLabel: "50-day average", target: null, closeExitConfirmed: false });
    expect(strategyLineStopInputs(95, line(101))).toEqual({ projectedTrailingStop: 101, trailingDistance: null });
    expect(strategyLineStopInputs(95, line(90))).toEqual({ projectedTrailingStop: 95, trailingDistance: null });
    expect(strategyLineStopInputs(95, line(null))).toEqual({ projectedTrailingStop: 95, trailingDistance: null });
    expect(strategyLineStopInputs(105, line(101), "SHORT")).toEqual({ projectedTrailingStop: 101, trailingDistance: null });
    expect(strategyLineStopInputs(105, line(110), "SHORT")).toEqual({ projectedTrailingStop: 105, trailingDistance: null });

    // A big run no longer drags an ATR stop up: the stop is the line, plus break-even.
    const inputs = strategyLineStopInputs(95, line(101));
    expect(calculateRecommendedGttStop({
      buyPrice: 100, projectedStop: 92, ...inputs, highestHigh: null, currentPrice: 130,
      postEntryCompletedHigh: 130, postEntryNextBarPolicy: true,
    })).toEqual({ recommendedStop: 101, breakEvenActivated: true });
  });

  it("keeps moving mean targets on the profitable side for long and short reversion trades", async () => {
    const { strategyFollowUpTarget } = await import("@/lib/swingTradeLedger");
    expect(strategyFollowUpTarget("LONG", 100, 115, 110)).toBe(110);
    expect(strategyFollowUpTarget("LONG", 100, 115, 95)).toBe(115);
    expect(strategyFollowUpTarget("SHORT", 100, 85, 90)).toBe(90);
    expect(strategyFollowUpTarget("SHORT", 100, 85, 105)).toBe(85);
  });

  it("moves protective stops only upward for longs and downward for shorts", () => {
    expect(calculateRecommendedGttStop({
      buyPrice: 100, projectedStop: 92, projectedTrailingStop: 95, trailingDistance: null,
      highestHigh: 120, currentPrice: 115, direction: "LONG",
    }).recommendedStop).toBe(100);
    expect(calculateRecommendedGttStop({
      buyPrice: 100, projectedStop: 108, projectedTrailingStop: 105, trailingDistance: null,
      highestHigh: null, currentPrice: 85, direction: "SHORT",
    }).recommendedStop).toBe(100);
  });
});
