import { describe, expect, it } from "vitest";
import { calculateSwingTradeProgress, tradingDaysBetween } from "@/lib/swingTradeLedger";

describe("swing trade ledger progress", () => {
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
});
