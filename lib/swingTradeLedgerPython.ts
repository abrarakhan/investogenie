import { runPythonStrategyBatch } from "@/lib/pythonStrategyMath";
import type { SwingTradeLedgerSummary, SwingTradeProgress } from "@/lib/swingTradeLedger";
import { marketHolidayDates, marketSpecialSessionDates } from "@/lib/market-calendar.mjs";

/**
 * Server-authoritative ledger roll-ups, computed in Python with decimal.Decimal.
 *
 * Kept out of lib/swingTradeLedger.ts on purpose: that module is imported for its types and
 * pure helpers in places that must not pull `node:child_process` into a bundle.
 *
 * Every book needed by a render goes in ONE call. The ledger page summarises the whole book
 * and then each trade separately, so a per-call boundary would spawn a Python process per
 * trade card; batching keeps it at one spawn per request regardless of how many trades there
 * are.
 */
export async function summarizeLedgerBooks(
  books: ReadonlyArray<ReadonlyArray<unknown>>,
  asOf = new Date().toISOString().slice(0, 10),
): Promise<SwingTradeLedgerSummary[]> {
  if (!books.length) return [];
  return runPythonStrategyBatch<{ asOf: string; trades: readonly unknown[] }, SwingTradeLedgerSummary>(
    "ledger",
    books.map((trades) => ({ asOf, trades })),
  );
}

/** GTT protection for a batch of trades — phase one of the ledger build. */
export async function runLedgerGttBatch(
  inputs: ReadonlyArray<Record<string, unknown>>,
): Promise<{ recommendedStop: number; breakEvenActivated: boolean; effectiveTrailingStop: number; gttUpdateRequired: boolean }[]> {
  if (!inputs.length) return [];
  return runPythonStrategyBatch("ledger_gtt", inputs);
}

/**
 * Held/P&L progress for a batch of trades — phase two.
 *
 * The resolved trading calendar travels with the request. Python must not rebuild it: NSE
 * holidays are refreshed at runtime and some dates trade despite being a weekend (Diwali
 * Muhurat), so a calendar assembled independently would disagree about how many sessions a
 * trade has been held and could flip it to WINDOW_EXPIRED.
 */
export async function runLedgerProgressBatch(
  inputs: ReadonlyArray<Record<string, unknown>>,
  market: "IN" | "US",
): Promise<SwingTradeProgress[]> {
  if (!inputs.length) return [];
  const holidays = marketHolidayDates(market);
  const specialSessions = marketSpecialSessionDates(market);
  // An open trade has no closedOn, and the TypeScript original fell back to "now". Resolve it
  // here so every trade in the batch is measured against one date rather than each runtime
  // reading its own clock.
  const today = new Date().toISOString().slice(0, 10);
  return runPythonStrategyBatch("ledger_progress", inputs.map((input) => ({
    ...input, asOf: (input as { asOf?: string }).asOf ?? today, holidays, specialSessions,
  })));
}

export async function runLedgerFollowUpBatch<T>(inputs: ReadonlyArray<Record<string, unknown>>): Promise<T[]> {
  if (!inputs.length) return [];
  return runPythonStrategyBatch("ledger_followup", inputs);
}

export async function runLedgerOverlayBatch<T>(inputs: ReadonlyArray<Record<string, unknown>>): Promise<T[]> {
  if (!inputs.length) return [];
  return runPythonStrategyBatch("ledger_overlay", inputs);
}
