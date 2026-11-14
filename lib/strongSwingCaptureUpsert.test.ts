import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureStrongSwingSnapshot, type StrongSwingCandidate } from "@/lib/strongSwing";
import { query } from "@/lib/db";

/**
 * A capture reruns: a scheduled run retried after a provider failure writes the same canonical
 * row again, and reopening the screen inside the same quarter-hour rewrites the interactive row.
 * The rerun recalculates against whatever benchmark is current, so if the upsert does not carry
 * the benchmark identity through, the stored gates come from the second attempt while the stored
 * benchmark still points at the first — and the forward audit then replays the wrong series,
 * silently, with migration 0078 in place and apparently working.
 *
 * This drives the real SQL in lib/strongSwing.ts rather than a copy of it, so it needs a
 * database. It is skipped when none is reachable, and the skip is visible in the test output.
 */
const FEATURE_VERSION = "test-capture-upsert";
const MARKET_DATE = "1990-01-02";

const reachable = await query("select 1").then(() => true, () => false);
if (!reachable) {
  console.warn("[strong-swing] capture upsert tests skipped: no database reachable");
}

async function cleanup() {
  await query("delete from public.strong_swing_snapshots where feature_version=$1", [FEATURE_VERSION]);
}

function candidate(assetId: string): StrongSwingCandidate {
  // Only the fields the capture payload reads matter here; the rest of the screen row is not
  // part of what is under test.
  return {
    assetId, ticker: "TESTCAP", status: "WATCHLIST", strengthScore: 50, score: 40,
    lastQuote: 100, latestClose: 100, strongEntry: 101, strongTarget: 110, strongStop: 95,
    strongTrail: 96, strongExpectedDays: 8, latestDate: "1990-01-02", gates: [],
  } as unknown as StrongSwingCandidate;
}

async function stored() {
  // Cast the date in SQL: node-postgres parses a `date` into a local-midnight Date, so reading
  // it back through toISOString() would report the previous day in a positive-offset zone.
  return await query<{ benchmark_asset_id: string | null; benchmark_latest_bar_date: string | null }>(
    `select benchmark_asset_id::text,benchmark_latest_bar_date::text
       from public.strong_swing_snapshots where feature_version=$1`,
    [FEATURE_VERSION],
  );
}

describe.skipIf(!reachable)("Strong Swing capture upsert", () => {
  let stock = "";
  let firstBenchmark = "";
  let secondBenchmark = "";

  beforeAll(async () => {
    const assets = await query<{ id: string }>(
      `select id::text from public.assets
        where country='IN' and asset_class='STOCK' and is_active order by ticker limit 3`,
    );
    [stock, firstBenchmark, secondBenchmark] = assets.map((row) => row.id);
    await cleanup();
  });

  afterAll(cleanup);

  it("a scheduled retry records the benchmark the retry actually used", async () => {
    const capture = {
      source: "scheduled" as const, decisionTime: "15:40", schedulerRunId: crypto.randomUUID(),
      marketDate: MARKET_DATE, dataCutoff: "1990-01-02T10:10:00.000Z",
      featureVersion: FEATURE_VERSION, calendarVersion: "test-calendar",
    };
    await captureStrongSwingSnapshot("IN", [candidate(stock)], capture,
      { assetId: firstBenchmark, latestBarDate: "1990-01-01" });
    await captureStrongSwingSnapshot("IN", [candidate(stock)], capture,
      { assetId: secondBenchmark, latestBarDate: "1990-01-02" });

    const rows = await stored();
    // The canonical index keys a scheduled capture, so the retry must update that one row.
    expect(rows).toHaveLength(1);
    expect(rows[0].benchmark_asset_id).toBe(secondBenchmark);
    expect(rows[0].benchmark_latest_bar_date).toBe("1990-01-02");
  });

  it("rewriting an interactive capture in the same quarter-hour records the newer benchmark", async () => {
    const capture = {
      source: "interactive" as const, marketDate: MARKET_DATE, featureVersion: FEATURE_VERSION,
    };
    // Interactive captures are keyed by a 15-minute bucket. One retry covers the rare case of
    // the pair straddling a bucket boundary; two straddles in a row is not a real outcome.
    let rows: Awaited<ReturnType<typeof stored>> = [];
    for (let attempt = 0; attempt < 2 && rows.length !== 1; attempt += 1) {
      await cleanup();
      await captureStrongSwingSnapshot("IN", [candidate(stock)], capture,
        { assetId: firstBenchmark, latestBarDate: "1990-01-01" });
      await captureStrongSwingSnapshot("IN", [candidate(stock)], capture,
        { assetId: secondBenchmark, latestBarDate: "1990-01-02" });
      rows = await stored();
    }
    expect(rows).toHaveLength(1);
    expect(rows[0].benchmark_asset_id).toBe(secondBenchmark);
    expect(rows[0].benchmark_latest_bar_date).toBe("1990-01-02");
  });

  it("records no benchmark when the screen had none to compare against", async () => {
    await cleanup();
    await captureStrongSwingSnapshot("IN", [candidate(stock)],
      { source: "interactive", marketDate: MARKET_DATE, featureVersion: FEATURE_VERSION },
      { assetId: null, latestBarDate: null });

    const rows = await stored();
    expect(rows).toHaveLength(1);
    expect(rows[0].benchmark_asset_id).toBeNull();
    expect(rows[0].benchmark_latest_bar_date).toBeNull();
  });
});
