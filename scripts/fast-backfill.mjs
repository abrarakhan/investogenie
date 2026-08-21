import { spawn } from "node:child_process";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("[fast-backfill] DATABASE_URL is not configured; local runs load it from .env.local");
  process.exit(1);
}

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: /127\.0\.0\.1|localhost/.test(databaseUrl) ? false : { rejectUnauthorized: false },
});
await client.connect();
const { rows: runningRows } = await client.query(
  `select exists(
     select 1 from public.backfill_queue
      where status='in_progress' and started_at > now() - interval '30 minutes'
   ) running`,
);
await client.end();
if (runningRows[0]?.running) {
  console.log("[fast-backfill] backfill is already running; follow progress on Data Health");
  process.exit(0);
}

const requestedWorkers = Number(process.env.FAST_BACKFILL_WORKERS ?? 3);
const workers = Math.min(6, Math.max(1, Number.isFinite(requestedWorkers) ? Math.floor(requestedWorkers) : 3));
const batchSize = process.env.BACKFILL_BATCH_SIZE ?? "1000";
const delayInMs = process.env.BACKFILL_DELAY_IN_MS ?? "300";
const delayUsMs = process.env.BACKFILL_DELAY_US_MS ?? "250";

console.log(`[fast-backfill] starting ${workers} queue workers (IN delay ${delayInMs}ms, US delay ${delayUsMs}ms)`);

const exits = await Promise.all(
  Array.from({ length: workers }, (_, index) => new Promise((resolveExit) => {
    const child = spawn(process.execPath, ["scripts/local-backfill-worker.mjs", "backfill_ohlcv"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BACKFILL_ALLOW_PARALLEL: "1",
        BACKFILL_BATCH_SIZE: batchSize,
        BACKFILL_DELAY_IN_MS: delayInMs,
        BACKFILL_DELAY_US_MS: delayUsMs,
        BACKFILL_WORKER_LANE: String(index + 1),
      },
      stdio: "inherit",
    });
    child.on("error", (error) => {
      console.error(`[fast-backfill] worker ${index + 1} failed to start: ${error.message}`);
      resolveExit(1);
    });
    child.on("close", (code, signal) => {
      if (signal) console.error(`[fast-backfill] worker ${index + 1} stopped by ${signal}`);
      resolveExit(code ?? (signal ? 1 : 0));
    });
  })),
);

const failed = exits.filter((code) => code !== 0).length;
console.log(`[fast-backfill] complete: ${workers - failed}/${workers} workers exited cleanly`);
process.exitCode = failed > 0 ? 1 : 0;
