import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import pg from "pg";

const { Client } = pg;

const job = process.argv[2] === "backfill_ohlcv_cron" ? "backfill_ohlcv_cron" : "backfill_ohlcv";
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("[backfill-worker] DATABASE_URL is not configured");
  process.exit(1);
}

const root = process.cwd();
const batchSize = envNumber("BACKFILL_BATCH_SIZE", 500);
const historyDays = envNumber("BACKFILL_HISTORY_DAYS", 504);
const delayInMs = envNumber("BACKFILL_DELAY_IN_MS", 1500);
const delayUsMs = envNumber("BACKFILL_DELAY_US_MS", 1000);
const maxAttempts = envNumber("BACKFILL_MAX_ATTEMPTS", 3);
const allowParallel = envBool("BACKFILL_ALLOW_PARALLEL", false);

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function envBool(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return value !== "0" && value.toLowerCase() !== "false";
}

function pythonBin() {
  const candidates = [
    process.env.PYTHON_BIN,
    process.env.CAS_PDF_PYTHON,
    resolve(root, ".venv/bin/python"),
    resolve(root, ".venv/bin/python3"),
    "python3",
  ].filter(Boolean);
  return candidates.find((candidate) => candidate.includes("/") ? existsSync(candidate) : true) ?? "python3";
}

function pgClient() {
  return new Client({
    connectionString: databaseUrl,
    ssl: /127\.0\.0\.1|localhost/.test(databaseUrl) ? false : { rejectUnauthorized: false },
  });
}

function scriptArgs(item) {
  if (item.market === "IN") {
    const exchange = item.exchange === "BSE" ? "BSE" : "NSE";
    return [
      "pipelines/nse_yfinance_sync.py",
      "--exchange", exchange,
      "--symbols", item.symbol,
      "--limit", "1",
      "--sleep", "0",
      "--history-days", String(historyDays),
    ];
  }
  return [
    "pipelines/us_history_sync.py",
    "--symbols", item.symbol,
    "--limit", "1",
    "--sleep", "0",
    "--history-days", String(historyDays),
    "--force-full",
  ];
}

async function logCronRun(entry) {
  const client = pgClient();
  try {
    await client.connect();
    await client.query(
      `insert into public.cron_logs (job, status, detail, error, duration_ms)
       values ($1, $2, $3::jsonb, $4, $5)`,
      [entry.job, entry.status, JSON.stringify(entry.detail ?? {}), entry.error ?? null, entry.durationMs ?? null],
    );
  } catch (error) {
    console.error(`[backfill-worker] failed to write cron log: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await client.end().catch(() => {});
  }
}

async function isRunning(client) {
  const { rows } = await client.query(
    `select exists(
       select 1 from public.backfill_queue
        where status='in_progress' and started_at > now() - interval '30 minutes'
     ) running`,
  );
  return Boolean(rows[0]?.running);
}

async function recoverStalledItems(client) {
  await client.query(
    `update public.backfill_queue
        set status='pending', started_at=null,
            last_error=coalesce(last_error, 'Recovered after worker interruption')
      where status='in_progress' and started_at <= now() - interval '30 minutes'`,
  );
}

async function claimNext(client) {
  await client.query("begin");
  try {
    const { rows } = await client.query(
      `select q.id, q.asset_id::text, q.symbol, q.market::text market, q.tier, q.attempts, a.exchange::text exchange
         from public.backfill_queue q
         join public.assets a on a.id = q.asset_id
        where q.status='pending'
          and coalesce(a.is_active, true)
          and not exists(select 1 from public.asset_tracking_exclusions x where x.asset_id=a.id)
          and a.asset_class='STOCK'
          and (
            (a.country='IN' and a.exchange in ('NSE','BSE'))
            or (a.country='US' and coalesce(a.exchange, '') in ('NASDAQ','NYSE','AMEX','NYSEARCA','NYSEAMERICAN'))
          )
          and (a.country <> 'IN' or a.ticker !~ '-RE[0-9]*$')
        order by case when q.market='IN' then 0 else 1 end, q.tier asc, q.queued_at asc
        for update skip locked
        limit 1`,
    );
    const item = rows[0] ?? null;
    if (!item) {
      await client.query("commit");
      return null;
    }
    await client.query(
      `update public.backfill_queue
          set status='in_progress', started_at=now(), last_error=null
        where id=$1`,
      [item.id],
    );
    await client.query("commit");
    return item;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  }
}

async function historyState(client, assetId) {
  const { rows } = await client.query(
    `with clock as (
       select (now() at time zone 'Asia/Kolkata')::date today,
              extract(isodow from now() at time zone 'Asia/Kolkata')::int dow,
              (now() at time zone 'Asia/Kolkata')::time local_time
     ), expected as (
       select case
         when dow=1 and local_time < time '18:00' then today-3
         when dow between 2 and 5 and local_time < time '18:00' then today-1
         when dow=6 then today-1
         when dow=7 then today-2
         else today end as market_date
       from clock
     )
     select count(*)::int count,
            coalesce(max(date) >= (select market_date - 2 from expected), false) fresh
       from public.daily_ohlcv where asset_id=$1`,
    [assetId],
  );
  return { count: Number(rows[0]?.count ?? 0), fresh: Boolean(rows[0]?.fresh) };
}

async function markDone(client, id, barsLoaded) {
  await client.query(
    `update public.backfill_queue
        set status=$2, bars_loaded=$3, completed_at=now(), last_error=null
      where id=$1`,
    [id, barsLoaded > 0 ? "done" : "skipped", barsLoaded],
  );
}

function isDefinitiveNoHistoryError(error) {
  const message = String(error).toLowerCase();
  return ["no ohlcv bars returned", "no price data found", "no financial data found", "possibly delisted", "quote not found", "404 not found"]
    .some((needle) => message.includes(needle));
}

async function markFailed(client, item, error) {
  await client.query("begin");
  try {
    const { rows } = await client.query(
    `update public.backfill_queue
        set attempts=attempts+1,
            last_error=$2,
            status=case when attempts + 1 >= $3 then 'failed' else 'pending' end,
            completed_at=case when attempts + 1 >= $3 then now() else completed_at end
      where id=$1
      returning attempts, status`,
      [item.id, String(error).slice(0, 2000), maxAttempts],
    );
    const updated = rows[0];
    if (!updated || updated.status !== "failed" || !isDefinitiveNoHistoryError(error)) {
      await client.query("commit");
      return updated?.status ?? "failed";
    }

    const protectedResult = await client.query(
      `select exists(select 1 from public.universe_members u where u.asset_id=$1 and u.universe in ('NIFTY_500','SP_500','NASDAQ_100'))
           or exists(select 1 from public.holdings h where h.asset_id=$1)
           or exists(select 1 from public.watchlist_items w where w.asset_id=$1)
           or exists(select 1 from public.forward_test_positions f where f.asset_id=$1 and f.status='OPEN')
           or exists(select 1 from public.swing_trade_ledger l where l.asset_id=$1 and l.status='OPEN') protected`,
      [item.asset_id],
    );
    if (protectedResult.rows[0]?.protected) {
      await client.query("commit");
      return "failed";
    }

    await client.query(
      `insert into public.asset_tracking_exclusions (asset_id, reason_code, reason, source, metadata)
       values ($1, 'history_unavailable', $2, 'backfill', jsonb_build_object('attempts', $3::int))
       on conflict (asset_id) do update set reason_code=excluded.reason_code, reason=excluded.reason,
         source=excluded.source, excluded_at=now(), metadata=excluded.metadata`,
      [item.asset_id, `No OHLCV history after ${updated.attempts} attempts: ${String(error).slice(0, 500)}`, updated.attempts],
    );
    await client.query("update public.assets set is_active=false where id=$1", [item.asset_id]);
    await client.query(
      `update public.backfill_queue set status='skipped', completed_at=now(),
         last_error='Retired from tracking: ' || $2 where id=$1`,
      [item.id, String(error).slice(0, 1000)],
    );
    await client.query("commit");
    return "retired";
  } catch (errorDuringRetirement) {
    await client.query("rollback").catch(() => {});
    throw errorDuringRetirement;
  }
}

async function runHistoryScript(item) {
  const bin = pythonBin();
  const args = scriptArgs(item);
  await new Promise((resolveRun, rejectRun) => {
    let output = "";
    const child = spawn(bin, args, { cwd: root, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      output += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      output += text;
      process.stderr.write(text);
    });
    child.on("error", rejectRun);
    child.on("close", (code, signal) => {
      if (signal) rejectRun(new Error(`${item.symbol} stopped by ${signal}`));
      else if (code !== 0) rejectRun(new Error(`${item.symbol} history sync failed with exit code ${code}: ${output.slice(-1000)}`));
      else resolveRun();
    });
  });
}

async function main() {
  const started = Date.now();
  const client = pgClient();
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  let barsLoaded = 0;
  try {
    await client.connect();
    await recoverStalledItems(client);
    if (!allowParallel && await isRunning(client)) {
      await logCronRun({
        job,
        status: "ok",
        detail: { alreadyRunning: true, message: "backfill already in progress" },
        durationMs: Date.now() - started,
      });
      return;
    }

    for (;;) {
      if (processed >= batchSize) break;
      const item = await claimNext(client);
      if (!item) break;
      const before = await historyState(client, item.asset_id);
      if (before.fresh) {
        await markDone(client, item.id, 0);
        skipped++;
        processed++;
        continue;
      }

      try {
        await runHistoryScript(item);
        const after = await historyState(client, item.asset_id);
        const loaded = Math.max(0, after.count - before.count);
        if (!after.fresh) {
          throw new Error("No OHLCV bars returned");
        }
        await markDone(client, item.id, Math.max(1, loaded));
        barsLoaded += loaded;
        succeeded++;
      } catch (error) {
        const status = await markFailed(client, item, error instanceof Error ? error.message : String(error));
        if (status === "retired") skipped++;
        else failed++;
      }
      processed++;
      if (processed < batchSize) await sleep(item.market === "US" ? delayUsMs : delayInMs);
    }

    await logCronRun({
      job,
      status: failed > 0 ? "error" : "ok",
      error: failed > 0 ? `${failed} symbol(s) failed` : null,
      detail: { processed, succeeded, failed, skipped, barsLoaded, alreadyRunning: false },
      durationMs: Date.now() - started,
    });
  } catch (error) {
    await logCronRun({
      job,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
      detail: { stack: error instanceof Error ? error.stack : undefined },
      durationMs: Date.now() - started,
    });
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error("[backfill-worker] fatal:", error);
  process.exit(1);
});
