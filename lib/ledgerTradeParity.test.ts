// Differential for the per-trade ledger projection: GTT protection and held/P&L progress.
// These were the last calculations still owned by TypeScript. Randomised across both
// directions, missing quotes, next-bar policy and every terminal state.
import { describe, expect, it } from "vitest";
import { calculateRecommendedGttStop, calculateSwingTradeProgress, tradingDaysBetween } from "@/lib/swingTradeLedger";
import { marketHolidayDates, marketSpecialSessionDates } from "@/lib/market-calendar.mjs";
import { runPythonStrategyBatch } from "@/lib/pythonStrategyMath";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const iso = (d: number) => new Date(Date.UTC(2026, 0, 1) + d * 86_400_000).toISOString().slice(0, 10);

describe("Ledger per-trade projection parity", () => {
  it("matches TypeScript across randomised trades", async () => {
    const random = mulberry32(99);
    const holidays = marketHolidayDates("IN") as string[];
    const specialSessions = marketSpecialSessionDates("IN") as string[];
    const cases = Array.from({ length: 120 }, () => {
      const buyPrice = Number((20 + random() * 3000).toFixed(4));
      const quantity = 1 + Math.floor(random() * 500);
      const projectedStop = Number((buyPrice * (0.8 + random() * 0.15)).toFixed(4));
      const hasQuote = random() > 0.15;
      const short = random() < 0.25;
      const gtt = {
        buyPrice,
        projectedStop: short ? Number((buyPrice * (1.05 + random() * 0.1)).toFixed(4)) : projectedStop,
        projectedTrailingStop: random() < 0.5 ? Number((buyPrice * 0.9).toFixed(4)) : null,
        trailingDistance: random() < 0.6 ? Number((buyPrice * 0.05).toFixed(4)) : null,
        highestHigh: random() < 0.7 ? Number((buyPrice * (1 + random() * 0.4)).toFixed(4)) : null,
        currentPrice: hasQuote ? Number((buyPrice * (0.7 + random() * 0.7)).toFixed(4)) : null,
        postEntryCompletedHigh: random() < 0.5 ? Number((buyPrice * (1 + random() * 0.3)).toFixed(4)) : null,
        postEntryNextBarPolicy: random() < 0.5,
        direction: (short ? "SHORT" : "LONG") as "LONG" | "SHORT",
      };
      const progress = {
        boughtOn: iso(Math.floor(random() * 250)),
        asOf: iso(260 + Math.floor(random() * 60)),
        status: (random() < 0.4 ? "CLOSED" : "OPEN") as "OPEN" | "CLOSED",
        buyPrice, quantity,
        currentPrice: hasQuote ? Number((buyPrice * (0.6 + random() * 0.9)).toFixed(4)) : null,
        exitPrice: random() < 0.5 ? Number((buyPrice * (0.7 + random() * 0.8)).toFixed(4)) : null,
        target: Number((buyPrice * (short ? 0.65 + random() * 0.25 : 1.05 + random() * 0.4)).toFixed(4)),
        stop: short ? gtt.projectedStop : projectedStop,
        trailingStop: random() < 0.5 ? Number((buyPrice * (short ? 1.08 : 0.92)).toFixed(4)) : null,
        expectedDays: 1 + Math.floor(random() * 40),
        market: "IN" as const,
        direction: (short ? "SHORT" : "LONG") as "LONG" | "SHORT",
      };
      return { gtt, progress, holidays, specialSessions };
    });

    const pyResults = await runPythonStrategyBatch<typeof cases[number], { gtt: { recommendedStop: number; breakEvenActivated: boolean }; progress: Record<string, unknown> }>(
      "ledger_trades", cases);

    const states = new Set<string>();
    let worst = 0;
    for (let i = 0; i < cases.length; i++) {
      const tsGtt = calculateRecommendedGttStop(cases[i].gtt);
      // The legacy TypeScript oracle is long-only. Compare it only for long trades; shorts
      // have independent assertions below because mirroring the old defect would bless it.
      const tsProg = calculateSwingTradeProgress(cases[i].progress);
      const py = pyResults[i];
      states.add(tsProg.state);
      expect(py.gtt.breakEvenActivated).toBe(tsGtt.breakEvenActivated);
      worst = Math.max(worst, Math.abs(py.gtt.recommendedStop - tsGtt.recommendedStop));
      expect(Math.abs(py.gtt.recommendedStop - tsGtt.recommendedStop)).toBeLessThan(1e-9);
      if (cases[i].progress.direction === "LONG") expect(py.progress.state).toBe(tsProg.state);
      expect(py.progress.daysHeld).toBe(tsProg.daysHeld);
      expect(py.progress.calendarDaysHeld).toBe(tsProg.calendarDaysHeld);
      expect(py.progress.daysRemaining).toBe(tsProg.daysRemaining);
      for (const key of ["currentValue", "investedValue", "pnlValue", "pnlPct", "targetProgressPct", "remainingUpsidePct"] as const) {
        if (cases[i].progress.direction === "SHORT" && ["pnlValue", "pnlPct", "targetProgressPct", "remainingUpsidePct"].includes(key)) continue;
        const t = tsProg[key] as number | null;
        const p = py.progress[key] as number | null;
        if (t === null || p === null) { expect(p === null).toBe(t === null); continue; }
        worst = Math.max(worst, Math.abs(p - t));
        expect(Math.abs(p - t)).toBeLessThan(Math.abs(t) * 1e-12 + 1e-9);
      }
    }
    console.log(`  states covered: ${[...states].sort().join(", ")}  largest drift: ${worst.toExponential(3)}`);
    expect(states.size).toBeGreaterThanOrEqual(4);
  }, 120_000);

  it("uses reversed target, stop, trail and P&L geometry for short trades", async () => {
    const holidays = marketHolidayDates("IN") as string[];
    const specialSessions = marketSpecialSessionDates("IN") as string[];
    const base = {
      boughtOn: "2026-11-02", asOf: "2026-11-03", status: "OPEN" as const,
      buyPrice: 100, quantity: 10, target: 90, stop: 108, trailingStop: 105,
      expectedDays: 10, market: "IN" as const, direction: "SHORT" as const, exitPrice: null,
    };
    const cases = [
      { ...base, currentPrice: 89 },
      { ...base, currentPrice: 109 },
      { ...base, currentPrice: 104 },
    ].map((progress) => ({
      gtt: { buyPrice: 100, projectedStop: 108, projectedTrailingStop: 105, trailingDistance: null, highestHigh: null, currentPrice: progress.currentPrice, postEntryCompletedHigh: null, postEntryNextBarPolicy: false, direction: "SHORT" as const },
      progress, holidays, specialSessions,
    }));
    const result = await runPythonStrategyBatch<typeof cases[number], { progress: Record<string, number | string | null> }>("ledger_trades", cases);
    expect(result[0].progress.state).toBe("TARGET_REACHED");
    expect(result[0].progress.pnlValue).toBe(110);
    expect(result[1].progress.state).toBe("STOP_BREACHED");
    expect(result[2].progress.state).toBe("ON_TRACK");
    expect(result[2].progress.pnlValue).toBe(-40);
  }, 120_000);

  it("counts trading sessions identically, holidays included", async () => {
    const holidays = marketHolidayDates("IN") as string[];
    const pairs = [["2026-11-09", "2026-11-13"], ["2026-01-01", "2026-03-01"], ["2026-05-01", "2026-05-01"]];
    const cases = pairs.map(([from, to]) => ({
      gtt: { buyPrice: 100, projectedStop: 90, projectedTrailingStop: null, trailingDistance: null, highestHigh: null, currentPrice: null, postEntryCompletedHigh: null, postEntryNextBarPolicy: false, direction: "LONG" as const },
      progress: { boughtOn: from, asOf: to, status: "OPEN" as const, buyPrice: 100, quantity: 1, currentPrice: 100, exitPrice: null, target: 120, stop: 90, trailingStop: null, expectedDays: 10, market: "IN" as const },
      holidays, specialSessions: marketSpecialSessionDates("IN") as string[],
    }));
    const py = await runPythonStrategyBatch<typeof cases[number], { progress: { daysHeld: number } }>("ledger_trades", cases);
    pairs.forEach(([from, to], i) => {
      expect(py[i].progress.daysHeld).toBe(tradingDaysBetween(from, to, "IN"));
    });
  }, 120_000);
});
