// Differential test: the TypeScript ledger roll-up against the Decimal-native Python port.
//
// Unlike the Armed Swing port, exact equality is NOT the goal here. Moving money and the XIRR
// solver onto decimal.Decimal is meant to remove binary-float drift, so the Python answer is
// expected to be the more accurate of the two. What this test pins down is that the two agree
// to well inside a paisa on realistic books, so the migration cannot move a number materially,
// and it reports the largest drift observed so a regression is visible rather than silent.
import { describe, expect, it } from "vitest";
import { summarizeSwingTradeLedger, calculateXirr } from "@/lib/swingTradeLedger";
import { runPythonStrategyBatch } from "@/lib/pythonStrategyMath";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const iso = (dayOffset: number) =>
  new Date(Date.UTC(2025, 0, 1) + dayOffset * 86_400_000).toISOString().slice(0, 10);

/** Books with awkward quantities and prices, which is where float accumulation drifts. */
function buildBook(seed: number, tradeCount: number) {
  const random = mulberry32(seed);
  const trades = [];
  for (let index = 0; index < tradeCount; index++) {
    // Prices with long decimal tails and odd lot sizes: 1/3-style values do not sit on a
    // binary boundary, so repeated accumulation is where the two substrates diverge.
    const quantity = 1 + Math.floor(random() * 997);
    const buyPrice = Number((10 + random() * 4321.456789).toFixed(4));
    const purchaseValue = Number((quantity * buyPrice).toFixed(6));
    const boughtOn = iso(Math.floor(random() * 400));
    const closed = random() < 0.6;
    const exitPrice = Number((buyPrice * (0.7 + random() * 0.8)).toFixed(4));
    const closedOn = iso(Math.floor(random() * 300) + 420);
    const pnl = Number((exitPrice * quantity - purchaseValue).toFixed(6));
    trades.push({
      status: (closed ? "CLOSED" : "OPEN") as "OPEN" | "CLOSED",
      progress: { investedValue: purchaseValue, pnlValue: pnl },
      realizedPnlValue: closed ? pnl : undefined,
      purchaseValue,
      boughtOn,
      currentPrice: closed ? null : Number((buyPrice * (0.8 + random() * 0.6)).toFixed(4)),
      remainingQuantity: closed ? 0 : quantity,
      closedOn: closed ? closedOn : null,
      exitPrice: closed ? exitPrice : null,
      quantity,
      exits: closed && random() < 0.5
        // A scale-out: two partial exits rather than one, which is the case the user called out.
        ? [
          { id: `${index}a`, soldOn: closedOn, quantity: Math.floor(quantity / 3), exitPrice, reason: null, realizedPnlValue: 0, saleValue: Number((Math.floor(quantity / 3) * exitPrice).toFixed(6)) },
          { id: `${index}b`, soldOn: iso(Math.floor(random() * 50) + 430), quantity: quantity - Math.floor(quantity / 3), exitPrice, reason: null, realizedPnlValue: 0, saleValue: Number(((quantity - Math.floor(quantity / 3)) * exitPrice).toFixed(6)) },
        ]
        : [],
    });
  }
  return trades;
}

describe("Swing ledger TypeScript/Python parity", () => {
  it("rolls an open short position up as profit when price falls", async () => {
    const [summary] = await runPythonStrategyBatch<{ asOf: string; trades: unknown[] }, Record<string, number | null>>(
      "ledger", [{ asOf: "2026-11-14", trades: [{
        status: "OPEN", direction: "SHORT", progress: { investedValue: 1000, pnlValue: 100 },
        realizedPnlValue: 0, purchaseValue: 1000, quantity: 10, remainingQuantity: 10,
        boughtOn: "2026-11-10", currentPrice: 90, exits: [],
      }] }],
    );
    expect(summary.unrealizedPnlValue).toBe(100);
    expect(summary.currentOpenValue).toBe(1100);
    expect(summary.overallPnlValue).toBe(100);
  }, 120_000);

  it("agrees to well inside a paisa across varied books", async () => {
    const books = [1, 2, 3, 4, 5, 6].map((seed) => buildBook(seed, 12 + seed * 7));
    const asOf = new Date().toISOString().slice(0, 10);

    const tsResults = books.map((trades) => summarizeSwingTradeLedger(trades));
    const pyResults = await runPythonStrategyBatch<{ asOf: string; trades: unknown[] }, Record<string, number | null>>(
      "ledger",
      books.map((trades) => ({ asOf, trades })),
    );

    const moneyKeys = [
      "openInvestedValue", "unrealizedPnlValue", "realizedPnlValue", "overallPnlValue",
      "totalInvestedValue", "capitalEmployedValue", "currentOpenValue",
    ] as const;

    let worstMoney = 0;
    let worstRate = 0;
    for (let index = 0; index < books.length; index++) {
      const ts = tsResults[index] as unknown as Record<string, number | null>;
      const py = pyResults[index];
      expect(py.openCount).toBe(ts.openCount);
      expect(py.closedCount).toBe(ts.closedCount);
      for (const key of moneyKeys) {
        const drift = Math.abs((py[key] as number) - (ts[key] as number));
        worstMoney = Math.max(worstMoney, drift);
        // A hundredth of a paisa on a book worth lakhs: far tighter than any rounding the UI does.
        expect(drift).toBeLessThan(0.0001);
      }
      for (const key of ["roiPct", "xirrPct"] as const) {
        if (ts[key] === null || py[key] === null) {
          expect(py[key] === null).toBe(ts[key] === null);
          continue;
        }
        const drift = Math.abs((py[key] as number) - (ts[key] as number));
        worstRate = Math.max(worstRate, drift);
        expect(drift).toBeLessThan(0.0001);
      }
    }
    console.log(`  largest money drift: ${worstMoney.toExponential(3)}  largest rate drift: ${worstRate.toExponential(3)} pct`);
  }, 120_000);

  it("solves a known XIRR exactly in both runtimes", async () => {
    // A one-year doubling is 100% by definition, so this catches a solver that is merely
    // self-consistent rather than correct.
    const flows = [{ date: "2025-01-01", amount: -1000 }, { date: "2026-01-01", amount: 2000 }];
    expect(calculateXirr(flows)).toBeCloseTo(100, 4);
    const [py] = await runPythonStrategyBatch<{ asOf: string; trades: unknown[] }, Record<string, number | null>>(
      "ledger",
      [{
        asOf: "2026-01-01",
        trades: [{
          status: "CLOSED", progress: { investedValue: 1000, pnlValue: 1000 },
          realizedPnlValue: 1000, purchaseValue: 1000, quantity: 10,
          boughtOn: "2025-01-01", closedOn: "2026-01-01", exitPrice: 200, exits: [],
        }],
      }],
    );
    expect(py.xirrPct as number).toBeCloseTo(100, 6);
  }, 120_000);
});
