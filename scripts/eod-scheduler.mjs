import { Client } from "pg";
import { latestExpectedSessionDate, zonedMarketClock } from "../lib/market-calendar.mjs";

export function dueEodSession(market, at = new Date()) {
  // Allow time for final bars and exchange file publication. US local time
  // automatically follows daylight saving, unlike a fixed IST trigger.
  return latestExpectedSessionDate(market, at, market === "IN" ? 18 * 60 + 30 : 17 * 60);
}

// Yahoo publishes daily candles for thinner US listings (SPAC units, preferreds,
// OTC) hours after the close, so the 17:00 ET pass misses roughly a fifth of the
// universe. A second pass at 22:00 ET refetches only those still missing the bar.
export function dueLateUsSession(at = new Date()) {
  return latestExpectedSessionDate("US", at, 22 * 60);
}

export function startEodScheduler({ databaseUrl, runIndia, runUS, runUSLate, runForwardTest }) {
  let stopped = false;
  let busy = false;
  const completed = new Map();
  const retryAt = new Map();
  async function tick() {
    if (stopped || busy || !databaseUrl) return;
    busy = true;
    const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 10_000 });
    try {
      await client.connect();
      const stages = [
        { market: "IN", job: "eod-in", label: "IN", run: runIndia, due: () => dueEodSession("IN") },
        { market: "US", job: "eod-us", label: "US", run: runUS, due: () => dueEodSession("US") },
        ...(runUSLate ? [{ market: "US", job: "eod-us-late", label: "US late", run: runUSLate, due: () => dueLateUsSession(), after: "eod-us" }] : []),
        // Forward-test grading needs the session's bars, so it waits for that market's EOD job.
        ...(runForwardTest ? ["IN", "US"].map((market) => ({
          market, job: `forward-test-${market.toLowerCase()}`, label: `${market} forward test`,
          action: "grading forward-test positions",
          run: (session) => runForwardTest(market, session),
          due: () => dueEodSession(market), after: `eod-${market.toLowerCase()}`,
        })) : []),
      ];
      for (const { market, job, label, run, due, after, action } of stages) {
        if (stopped) break;
        const session = due();
        const key = `${job}:${session}`;
        if (completed.get(job) === session || Date.now() < (retryAt.get(key) ?? 0)) continue;
        const okFor = (name) => client.query(
          "select 1 from public.cron_logs where job=$1 and status='ok' and detail->>'session'=$2 limit 1",
          [name, session],
        );
        const previous = await okFor(job);
        if (previous.rowCount) { completed.set(job, session); continue; }
        // A follow-up stage waits for its main EOD job for the same session.
        if (after && !(await okFor(after)).rowCount) continue;
        const lock = await client.query("select pg_try_advisory_lock(hashtext($1)) locked", [job]);
        if (!lock.rows[0].locked) continue;
        const started = Date.now();
        try {
          console.log(`[eod] ${label} ${action ?? "updating quotes and OHLCV"} for completed session ${session}`);
          await run(session);
          await client.query("insert into public.cron_logs(job,status,detail,duration_ms) values($1,'ok',$2,$3)",
            [job, { session, clock: zonedMarketClock(market) }, Date.now() - started]);
          completed.set(job, session);
          console.log(`[eod] ${label} session ${session} jobs completed; per-asset gaps remain visible in Data Health`);
        } catch (error) {
          retryAt.set(key, Date.now() + 30 * 60_000);
          await client.query("insert into public.cron_logs(job,status,detail,error,duration_ms) values($1,'error',$2,$3,$4)",
            [job, { session }, String(error), Date.now() - started]);
          console.error(`[eod] ${label} failed; retry in 30 minutes: ${error}`);
        } finally {
          await client.query("select pg_advisory_unlock(hashtext($1))", [job]);
        }
      }
    } catch (error) { console.error(`[eod] scheduler check failed: ${error}`); }
    finally { await client.end().catch(() => {}); busy = false; }
  }
  const timer = setInterval(tick, 60_000);
  const startup = setTimeout(tick, 30_000);
  return () => { stopped = true; clearInterval(timer); clearTimeout(startup); };
}
