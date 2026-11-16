import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadStrategyRecord } from "@/lib/strategyRecord";
import { query } from "@/lib/db";

/**
 * The record is the only evidence the buy screen offers, so the arithmetic behind it
 * has to be right for the reasons that are easy to get wrong: a median is not a mean,
 * an average loss must not quietly include the break-even trades twice, and an
 * ungraded signal is not a zero-percent outcome.
 *
 * This drives the real SQL rather than a copy of it, so it needs a database, and uses
 * US so a stored India replay is never shadowed by the fixture.
 */
const MARKET = "US";
const reachable = await query("select 1").then(() => true, () => false);
if (!reachable) {
  console.warn("[strategy-record] tests skipped: no database reachable");
}

async function cleanup() {
  await query("delete from public.strong_swing_replay_runs where model_version=$1", ["test-record"]);
}

describe.skipIf(!reachable)("Strategy record", () => {
  let assetId = "";

  beforeAll(async () => {
    const [asset] = await query<{ id: string }>(
      "select id::text from public.assets where is_active order by ticker limit 1",
    );
    assetId = asset.id;
    await cleanup();
    const [run] = await query<{ id: string }>(
      `insert into public.strong_swing_replay_runs(
         market,model_version,methodology_version,results_mode,live_execution_evaluated,
         from_date,to_date,horizon_sessions,signals)
       values($1,'test-record','test','ignored',false,'2024-01-01','2025-12-31',20,6)
       returning id::text`,
      [MARKET],
    );
    // Returns -5, -5, -2, 3, 10 — a median that is not the mean, and one signal that
    // was never graded because the replay window ended before it could be entered.
    const rows: [string, string, number | null, string][] = [
      ["2024-02-01", "STOP", -5, "a"], ["2024-03-01", "STOP", -5, "b"],
      ["2024-04-01", "HORIZON", -2, "c"], ["2025-05-01", "HORIZON", 3, "d"],
      ["2025-06-01", "TARGET", 10, "e"], ["2025-07-01", "OPEN", null, "f"],
    ];
    for (const [signalDate, reason, returnPct] of rows) {
      await query(
        `insert into public.strong_swing_replay_signals(
           run_id,asset_id,ticker,signal_date,exit_reason,return_pct)
         values($1,$2,'TESTREC',$3,$4,$5)`,
        [run.id, assetId, signalDate, reason, returnPct],
      );
    }
  });

  afterAll(cleanup);

  it("counts only graded signals", async () => {
    const record = await loadStrategyRecord(MARKET);
    expect(record?.trades).toBe(5);
  });

  it("reports the win rate, expectancy and median as three different numbers", async () => {
    const record = await loadStrategyRecord(MARKET);
    expect(record?.winRatePct).toBeCloseTo(40, 6);
    expect(record?.expectancyPct).toBeCloseTo(0.2, 6);
    // The mean is positive while the median is negative: most signals lose and a tail
    // pays for them. Collapsing the two would be the most flattering possible error.
    expect(record?.medianPct).toBeCloseTo(-2, 6);
  });

  it("splits wins from losses at zero and names the exits", async () => {
    const record = await loadStrategyRecord(MARKET);
    expect(record?.averageWinPct).toBeCloseTo(6.5, 6);
    expect(record?.averageLossPct).toBeCloseTo(-4, 6);
    expect(record?.targetHits).toBe(1);
    expect(record?.stopHits).toBe(2);
  });

  it("reports the most recent year on its own, not the whole span's average", async () => {
    const record = await loadStrategyRecord(MARKET);
    expect(record?.fromYear).toBe(2024);
    expect(record?.toYear).toBe(2025);
    expect(record?.latestYear?.year).toBe(2025);
    expect(record?.latestYear?.trades).toBe(2);
    expect(record?.latestYear?.expectancyPct).toBeCloseTo(6.5, 6);
  });

  it("says which gates the replay could not judge", async () => {
    const record = await loadStrategyRecord(MARKET);
    expect(record?.resultsEvaluated).toBe(false);
    expect(record?.liveExecutionEvaluated).toBe(false);
  });

  it("returns nothing rather than a zero-trade record when no replay has run", async () => {
    await cleanup();
    expect(await loadStrategyRecord(MARKET)).toBeNull();
  });
});
