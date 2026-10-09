import { Client } from "pg";
import { latestExpectedSessionDate } from "../lib/market-calendar.mjs";

export function startMlSnapshotScheduler({ databaseUrl, runIndia }) {
  let stopped = false;
  let busy = false;
  let completedSession = null;
  let retryAfter = 0;

  async function tick() {
    if (stopped || busy || !databaseUrl || Date.now() < retryAfter) return;
    const session = latestExpectedSessionDate("IN", new Date(), 18 * 60 + 45);
    if (session === completedSession) return;
    busy = true;
    const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 10_000 });
    const job = "ml-snapshot-in";
    const started = Date.now();
    try {
      await client.connect();
      const existing = await client.query(
        "select 1 from public.cron_logs where job=$1 and status='ok' and detail->>'session'=$2 limit 1",
        [job, session],
      );
      if (existing.rowCount) { completedSession = session; return; }
      const upstream = await client.query(
        "select 1 from public.cron_logs where job='eod-in' and status='ok' and detail->>'session'=$1 limit 1",
        [session],
      );
      if (!upstream.rowCount) return;
      const lock = await client.query("select pg_try_advisory_lock(hashtext($1)) locked", [job]);
      if (!lock.rows[0].locked) return;
      try {
        await runIndia(session);
        await client.query(
          "insert into public.cron_logs(job,status,detail,duration_ms) values($1,'ok',$2,$3)",
          [job, { session, featureVersion: "strong-swing-features-v1" }, Date.now() - started],
        );
        completedSession = session;
      } catch (error) {
        retryAfter = Date.now() + 15 * 60_000;
        await client.query(
          "insert into public.cron_logs(job,status,detail,error,duration_ms) values($1,'error',$2,$3,$4)",
          [job, { session }, String(error), Date.now() - started],
        );
        console.error(`[ml-snapshots] ${session} failed; retry in 15 minutes: ${error}`);
      } finally {
        await client.query("select pg_advisory_unlock(hashtext($1))", [job]);
      }
    } catch (error) {
      console.error(`[ml-snapshots] scheduler check failed: ${error}`);
    } finally {
      await client.end().catch(() => {});
      busy = false;
    }
  }

  const timer = setInterval(tick, 60_000);
  const startup = setTimeout(tick, 45_000);
  return () => { stopped = true; clearInterval(timer); clearTimeout(startup); };
}
