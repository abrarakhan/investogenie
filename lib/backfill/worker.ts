import { spawn } from "node:child_process";
import { query, queryOne } from "@/lib/db";
import { logCronRun, type CronJob } from "@/lib/ingest/cronLog";
import {
  claimNextBackfillItem,
  isBackfillRunning,
  markBackfillDone,
  markBackfillFailed,
  populateBackfillQueue,
} from "./queue";
import type { BackfillMarket, BackfillQueueItem, BackfillRunSummary, BackfillStartSummary } from "./types";

let activeBackgroundBackfill: Promise<BackfillRunSummary> | null = null;

export interface BackfillWorkerOptions {
  batchSize?: number;
  delayInMs?: number;
  delayUsMs?: number;
  historyDays?: number;
  skipDuringMarketHours?: boolean;
  maxAttempts?: number;
  populateFirst?: boolean;
  now?: Date;
}

const sleep = (ms: number) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return value !== "0" && value.toLowerCase() !== "false";
}

export function backfillWorkerOptionsFromEnv(overrides: BackfillWorkerOptions = {}): Required<BackfillWorkerOptions> {
  return {
    batchSize: overrides.batchSize ?? envNumber("BACKFILL_BATCH_SIZE", 100),
    delayInMs: overrides.delayInMs ?? envNumber("BACKFILL_DELAY_IN_MS", 1500),
    delayUsMs: overrides.delayUsMs ?? envNumber("BACKFILL_DELAY_US_MS", 1000),
    historyDays: overrides.historyDays ?? envNumber("BACKFILL_HISTORY_DAYS", 504),
    skipDuringMarketHours: overrides.skipDuringMarketHours ?? envBool("BACKFILL_SKIP_DURING_MARKET_HOURS", true),
    maxAttempts: overrides.maxAttempts ?? 3,
    populateFirst: overrides.populateFirst ?? true,
    now: overrides.now ?? new Date(),
  };
}

function pythonBin(): string {
  // Keep app-route bundles away from project-local .venv symlinks. Turbopack
  // traces fs probes during production builds and can panic when .venv points
  // outside the project root, so callers that need the venv should pass
  // PYTHON_BIN from the launcher process.
  return process.env.PYTHON_BIN ?? process.env.CAS_PDF_PYTHON ?? "python3";
}

async function barCount(assetId: string): Promise<number> {
  const row = await queryOne<{ count: string }>(
    "select count(*)::text from public.daily_ohlcv where asset_id=$1",
    [assetId],
  );
  return Number(row?.count ?? 0);
}

function scriptArgs(item: BackfillQueueItem, historyDays: number): string[] {
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

async function runHistoryScript(item: BackfillQueueItem, historyDays: number): Promise<void> {
  const args = scriptArgs(item, historyDays);
  const bin = pythonBin();
  await new Promise<void>((resolveRun, rejectRun) => {
    let output = "";
    const child = spawn(bin, args, { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
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

export async function processBackfillItem(item: BackfillQueueItem, opts: Required<BackfillWorkerOptions>): Promise<{ status: "done" | "failed" | "skipped"; barsLoaded: number; error?: string }> {
  const before = await barCount(item.assetId);
  if (before > 0) {
    await markBackfillDone(item.id, 0);
    return { status: "skipped", barsLoaded: 0 };
  }

  try {
    await runHistoryScript(item, opts.historyDays);
    const after = await barCount(item.assetId);
    const loaded = Math.max(0, after - before);
    if (loaded === 0) {
      await markBackfillFailed(item.id, "No OHLCV bars returned", opts.maxAttempts);
      return { status: "failed", barsLoaded: 0, error: "No OHLCV bars returned" };
    }
    await markBackfillDone(item.id, loaded);
    return { status: "done", barsLoaded: loaded };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markBackfillFailed(item.id, message, opts.maxAttempts);
    return { status: "failed", barsLoaded: 0, error: message };
  }
}

function delayForMarket(market: BackfillMarket, opts: Required<BackfillWorkerOptions>) {
  return market === "US" ? opts.delayUsMs : opts.delayInMs;
}

export async function runBackfillBatch(options: BackfillWorkerOptions = {}): Promise<BackfillRunSummary> {
  const opts = backfillWorkerOptionsFromEnv(options);
  const t0 = Date.now();
  if (await isBackfillRunning()) {
    return { processed: 0, succeeded: 0, failed: 0, skipped: 0, barsLoaded: 0, durationMs: Date.now() - t0, alreadyRunning: true, message: "backfill already in progress" };
  }

  if (opts.populateFirst) await populateBackfillQueue();

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  let barsLoaded = 0;

  for (;;) {
    if (processed >= opts.batchSize) break;
    const item = await claimNextBackfillItem({ skipDuringMarketHours: opts.skipDuringMarketHours, now: opts.now });
    if (!item) break;
    const label = `[T${item.tier} ${processed + 1}/${opts.batchSize}] ${item.symbol}${item.exchange ? `@${item.exchange}` : ""}`;
    const result = await processBackfillItem(item, opts);
    processed++;
    barsLoaded += result.barsLoaded;
    if (result.status === "done") {
      succeeded++;
      console.log(`${label} — ${result.barsLoaded} bars ✓`);
    } else if (result.status === "skipped") {
      skipped++;
      console.log(`${label} — skipped (history already present)`);
    } else {
      failed++;
      console.log(`${label} — failed: ${result.error}`);
    }
    if (processed < opts.batchSize) await sleep(delayForMarket(item.market, opts));
  }

  return {
    processed,
    succeeded,
    failed,
    skipped,
    barsLoaded,
    durationMs: Date.now() - t0,
    alreadyRunning: false,
    message: opts.batchSize <= 0
      ? "batch size is 0 — queue populated only"
      : processed === 0
        ? "backfill complete — no pending items"
        : undefined,
  };
}

export async function runAndLogBackfillBatch(
  databaseUrl: string,
  options: BackfillWorkerOptions = {},
  job: Extract<CronJob, "backfill_ohlcv" | "backfill_ohlcv_cron"> = "backfill_ohlcv",
): Promise<BackfillRunSummary> {
  const started = Date.now();
  try {
    const summary = await runBackfillBatch(options);
    await logCronRun(databaseUrl, {
      job,
      status: summary.failed > 0 ? "error" : "ok",
      error: summary.failed > 0 ? `${summary.failed} symbol(s) failed` : null,
      detail: {
        processed: summary.processed,
        succeeded: summary.succeeded,
        failed: summary.failed,
        skipped: summary.skipped,
        barsLoaded: summary.barsLoaded,
        alreadyRunning: summary.alreadyRunning,
        message: summary.message,
      },
      durationMs: summary.durationMs || Date.now() - started,
    });
    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logCronRun(databaseUrl, {
      job,
      status: "error",
      error: message,
      detail: { stack: error instanceof Error ? error.stack : undefined },
      durationMs: Date.now() - started,
    });
    throw error;
  }
}

export async function startAndLogBackfillBatch(
  databaseUrl: string,
  options: BackfillWorkerOptions = {},
  job: Extract<CronJob, "backfill_ohlcv" | "backfill_ohlcv_cron"> = "backfill_ohlcv",
): Promise<BackfillStartSummary> {
  if (activeBackgroundBackfill || await isBackfillRunning()) {
    return { started: false, alreadyRunning: true, message: "backfill already in progress" };
  }

  activeBackgroundBackfill = runAndLogBackfillBatch(databaseUrl, options, job)
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[backfill] background run failed: ${message}`);
      return { processed: 0, succeeded: 0, failed: 1, skipped: 0, barsLoaded: 0, durationMs: 0, alreadyRunning: false, message };
    })
    .finally(() => {
      activeBackgroundBackfill = null;
    });

  return { started: true, alreadyRunning: false, message: "backfill started in the background" };
}

export async function resetStaleInProgressBackfillItems(): Promise<number> {
  const rows = await query<{ id: number }>(
    `update public.backfill_queue
        set status='pending', last_error='stale in_progress lock reset'
      where status='in_progress' and started_at <= now() - interval '30 minutes'
      returning id`,
  );
  return rows.length;
}
