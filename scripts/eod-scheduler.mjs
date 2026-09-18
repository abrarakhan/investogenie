import { Client } from "pg";
import { latestExpectedSessionDate, zonedMarketClock } from "../lib/market-calendar.mjs";

export function dueEodSession(market, at = new Date()) {
  // Allow time for final bars and exchange file publication. US local time
  // automatically follows daylight saving, unlike a fixed IST trigger.
  return latestExpectedSessionDate(market, at, market === "IN" ? 18 * 60 + 30 : 17 * 60);
}

export function startEodScheduler({ databaseUrl, runIndia, runUS }) {
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
      for (const [market, run] of [["IN", runIndia], ["US", runUS]]) {
        if (stopped) break;
        const session = dueEodSession(market);
        const key = `${market}:${session}`;
        if (completed.get(market) === session || Date.now() < (retryAt.get(key) ?? 0)) continue;
        const job = `eod-${market.toLowerCase()}`;
        const previous = await client.query(
          "select 1 from public.cron_logs where job=$1 and status='ok' and detail->>'session'=$2 limit 1",
          [job, session],
        );
        if (previous.rowCount) { completed.set(market, session); continue; }
        const lock = await client.query("select pg_try_advisory_lock(hashtext($1)) locked", [job]);
        if (!lock.rows[0].locked) continue;
        const started = Date.now();
        try {
          console.log(`[eod] ${market} updating quotes and OHLCV for completed session ${session}`);
          await run(session);
          await client.query("insert into public.cron_logs(job,status,detail,duration_ms) values($1,'ok',$2,$3)",
            [job, { session, clock: zonedMarketClock(market) }, Date.now() - started]);
          completed.set(market, session);
          console.log(`[eod] ${market} session ${session} jobs completed; per-asset gaps remain visible in Data Health`);
        } catch (error) {
          retryAt.set(key, Date.now() + 30 * 60_000);
          await client.query("insert into public.cron_logs(job,status,detail,error,duration_ms) values($1,'error',$2,$3,$4)",
            [job, { session }, String(error), Date.now() - started]);
          console.error(`[eod] ${market} failed; retry in 30 minutes: ${error}`);
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
