import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const mode = process.argv[2];
if (mode !== "dev" && mode !== "start") {
  console.error("Usage: node scripts/run-with-nse-sync.mjs <dev|start> [next options]");
  process.exit(2);
}

const root = process.cwd();
const envFile = resolve(root, ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const nextCli = resolve(root, "node_modules/next/dist/bin/next");
const pipeline = resolve(root, "pipelines/nse_yfinance_sync.py");
const usPipeline = resolve(root, "pipelines/us_market_sync.py");
const usHistoryPipeline = resolve(root, "pipelines/us_history_sync.py");
const macroPipeline = resolve(root, "pipelines/macro_sync.py");
const pythonCandidates = [
  process.env.PYTHON_BIN,
  resolve(root, ".venv/bin/python"),
  resolve(root, ".venv/bin/python3"),
  "python3",
].filter(Boolean);
const python = pythonCandidates.find((candidate) =>
  candidate.includes("/") ? existsSync(candidate) : true,
);
if (python && !process.env.CAS_PDF_PYTHON) process.env.CAS_PDF_PYTHON = python;
if (python && !process.env.PYTHON_BIN) process.env.PYTHON_BIN = python;

const syncHour = Number(process.env.NSE_SYNC_HOUR_IST ?? 18);
const syncMinute = Number(process.env.NSE_SYNC_MINUTE_IST ?? 30);
const syncSleep = process.env.NSE_SYNC_SLEEP_SECONDS ?? "1.2";
const syncDisabled = process.env.NSE_SYNC_DISABLED === "1";
const nseSyncProvider = (process.env.NSE_SYNC_PROVIDER ?? "bhavcopy").toLowerCase();
const nseBhavcopyMaxSessions = process.env.NSE_BHAVCOPY_MAX_SESSIONS ?? "20";
const fundamentalsSleep = process.env.FUNDAMENTALS_SYNC_SLEEP_SECONDS ?? "1.5";
const fundamentalsDisabled = process.env.FUNDAMENTALS_SYNC_DISABLED === "1";
const usQuoteDisabled = process.env.US_QUOTE_SYNC_DISABLED === "1";
const usQuoteLimit = process.env.US_QUOTE_LIMIT ?? "1500";
const usQuoteBatchSize = process.env.US_QUOTE_BATCH_SIZE ?? "100";
const usGoogleFallbackLimit = process.env.US_GOOGLE_FALLBACK_LIMIT ?? "100";
const marketRefreshIntervalMinutes = Number(process.env.MARKET_REFRESH_INTERVAL_MINUTES ?? 60);
const indiaMarketQuoteRefreshIntervalMinutes = Number(process.env.INDIA_MARKET_QUOTE_REFRESH_INTERVAL_MINUTES ?? 15);
const indiaMarketQuoteRefreshDisabled = process.env.INDIA_MARKET_QUOTE_REFRESH_DISABLED === "1";
const usSyncSleep = process.env.US_SYNC_SLEEP_SECONDS ?? "0.4";
const usFundamentalsLimit = process.env.US_FUNDAMENTALS_LIMIT ?? "250";
const usFundamentalsStaleDays = process.env.US_FUNDAMENTALS_STALE_DAYS ?? "7";
const usFundamentalsDisabled = process.env.US_FUNDAMENTALS_SYNC_DISABLED === "1";
const usHistoryDisabled = process.env.US_HISTORY_SYNC_DISABLED === "1";
const usHistoryLimit = process.env.US_HISTORY_LIMIT ?? "50";
const usHistoryMinBars = process.env.US_HISTORY_MIN_BARS ?? "260";
const usHistorySleep = process.env.US_HISTORY_SLEEP_SECONDS ?? "0.25";
const macroSyncDisabled = process.env.MACRO_SYNC_DISABLED === "1";
const macroSyncYears = process.env.MACRO_SYNC_YEARS ?? "5";
const backfillDisabled =
  process.env.BACKFILL_CRON_ENABLED !== "1" ||
  process.env.BACKFILL_CRON_DISABLED === "1";
const backfillIndiaHour = Number(process.env.BACKFILL_INDIA_HOUR_IST ?? 17);
const backfillUsHour = Number(process.env.BACKFILL_US_HOUR_IST ?? 22);
const emailDigestDisabled = process.env.EMAIL_DIGEST_CRON_DISABLED === "1";
const emailDigestHour = Number(process.env.EMAIL_DIGEST_HOUR_IST ?? 7);
const emailDigestMinute = Number(process.env.EMAIL_DIGEST_MINUTE_IST ?? 0);
// A transient failure at send time (laptop waking, DNS/Wi-Fi not up yet) must not
// burn the whole day, so retry a bounded number of times before giving up.
const emailDigestMaxAttempts = Number(process.env.EMAIL_DIGEST_MAX_ATTEMPTS ?? 5);
const emailDigestRetryMs = Number(process.env.EMAIL_DIGEST_RETRY_MINUTES ?? 5) * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

let syncChild = null;
let syncPromise = null;
let fundamentalsChild = null;
let usFundamentalsChild = null;
let usHistoryChild = null;
let macroChild = null;
let marketRefreshChild = null;
let marketRefreshPromise = null;
let marketRefreshTimer = null;
let indiaMarketQuoteRefreshTimer = null;
let indiaMarketQuoteRefreshPromise = null;
let backfillTimer = null;
let dailyTimer = null;
let backfillPromise = null;
let lastBackfillIndiaDate = null;
let lastBackfillUsDate = null;
let emailDigestTimer = null;
let emailDigestPromise = null;
let lastEmailDigestDate = null;   // IST date of the last SUCCESSFUL send
let emailDigestAttemptDate = null; // IST date the current attempt run belongs to
let emailDigestAttempts = 0;
let emailDigestNextRetryAt = 0;    // epoch ms; gate for the next retry
let shuttingDown = false;

import { Client } from "pg";

const sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));

/**
 * Query cron_logs to check if a upstream sync is healthy.
 * Returns true if the sync succeeded in the last run.
 */
async function isUpstreamSyncHealthy(jobName, timeWindowHours = 24) {
  try {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) return true; // Assume healthy if DB not configured

    const client = new Client({ connectionString: databaseUrl });
    await client.connect();

    try {
      const result = await client.query(
        `SELECT status FROM public.cron_logs
         WHERE job = $1 AND created_at > NOW() - INTERVAL '${timeWindowHours} hours'
         ORDER BY created_at DESC LIMIT 1`,
        [jobName]
      );

      if (result.rows.length === 0) return true; // No history = assume healthy
      return result.rows[0].status === "ok";
    } finally {
      await client.end();
    }
  } catch (error) {
    // If we can't check, assume healthy (don't block startup)
    console.debug(`[health-check] Unable to check upstream ${jobName}: ${error instanceof Error ? error.message : String(error)}`);
    return true;
  }
}

// Sync job tracking for startup summary
const syncStats = {
  attempted: 0,
  succeeded: 0,
  failed: 0,
  skipped: 0,
  jobs: [],
};

function recordSyncJob(name, status, error = null, attempts = 1, durationMs = 0) {
  syncStats.jobs.push({ name, status, error, attempts, durationMs });
  if (status === "ok") syncStats.succeeded++;
  else if (status === "error") syncStats.failed++;
  else if (status === "skipped") syncStats.skipped++;
  syncStats.attempted++;
}

function printSyncSummary() {
  console.log("\n=== Startup Sync Summary ===");
  for (const job of syncStats.jobs) {
    const emoji = job.status === "ok" ? "✓" : job.status === "error" ? "✗" : "⊘";
    const duration = job.durationMs > 0 ? ` (${Math.round(job.durationMs / 1000)}s)` : "";
    const error = job.error ? ` — ${job.error}` : "";
    console.log(`${emoji} ${job.name}${duration}${error}`);
  }
  console.log(
    `\nTotal: ${syncStats.succeeded}✓ ${syncStats.failed}✗ ${syncStats.skipped}⊘ (${syncStats.attempted} attempted)`
  );
  if (syncStats.failed > 0) {
    console.warn("\n⚠️  Some syncs failed. App is running but data may be stale.");
  }
  console.log("============================\n");
}

function runNodeScript(label, script) {
  return new Promise((resolveRun, rejectRun) => {
    console.log(`[market-refresh] ${label}`);
    marketRefreshChild = spawn(
      process.execPath,
      [resolve(root, script)],
      { cwd: root, env: process.env, stdio: "inherit" },
    );
    marketRefreshChild.once("error", rejectRun);
    marketRefreshChild.once("close", (code, signal) => {
      marketRefreshChild = null;
      if (signal) rejectRun(new Error(`${label} stopped by ${signal}`));
      else if (code !== 0) rejectRun(new Error(`${label} failed with exit code ${code}`));
      else resolveRun();
    });
  });
}

function runMarketPython(label, args) {
  return new Promise((resolveRun, rejectRun) => {
    if (!python) {
      rejectRun(new Error("no Python executable found"));
      return;
    }
    console.log(`[market-refresh] ${label}`);
    marketRefreshChild = spawn(
      python,
      args,
      { cwd: root, env: process.env, stdio: "inherit" },
    );
    marketRefreshChild.once("error", rejectRun);
    marketRefreshChild.once("close", (code, signal) => {
      marketRefreshChild = null;
      if (signal) rejectRun(new Error(`${label} stopped by ${signal}`));
      else if (code !== 0) rejectRun(new Error(`${label} failed with exit code ${code}`));
      else resolveRun();
    });
  });
}

async function waitForApp() {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch("http://127.0.0.1:3000/login");
      if (response.ok) return;
    } catch {
      // Next may still be compiling during startup.
    }
    await sleep(500);
  }
  throw new Error("Next.js did not become ready for the signal scan");
}

async function runMacroSync(trigger) {
  if (macroSyncDisabled) {
    console.log(`[macro-sync] ${trigger} sync disabled by MACRO_SYNC_DISABLED=1`);
    return;
  }
  if (!python) {
    console.error("[macro-sync] no Python executable found");
    return;
  }
  if (macroChild) {
    console.log(`[macro-sync] skipping ${trigger}; sync still running`);
    return;
  }

  const args = [macroPipeline, "--years", macroSyncYears];
  if (process.env.MACRO_SYNC_SERIES) args.push("--series", process.env.MACRO_SYNC_SERIES);
  if (process.env.MACRO_SYNC_DRY_RUN === "1") args.push("--dry-run");

  await new Promise((resolveRun) => {
    console.log(`[macro-sync] starting ${trigger} macro history update`);
    macroChild = spawn(python, args, { cwd: root, env: process.env, stdio: "inherit" });
    macroChild.on("error", (error) => {
      console.error(`[macro-sync] unable to start: ${error.message}`);
      macroChild = null;
      resolveRun();
    });
    macroChild.on("close", (code, signal) => {
      macroChild = null;
      if (signal) console.log(`[macro-sync] stopped by ${signal}`);
      else if (code === 0) console.log(`[macro-sync] ${trigger} update completed`);
      else console.error(`[macro-sync] ${trigger} update failed with exit code ${code}`);
      resolveRun();
    });
  });
}

function runMarketRefresh(trigger) {
  if (marketRefreshPromise) {
    console.log(`[market-refresh] skipping ${trigger}; refresh still running`);
    return marketRefreshPromise;
  }

  const t0 = Date.now();
  marketRefreshPromise = (async () => {
    try {
      console.log(`[market-refresh] starting ${trigger}`);
      await runNodeScript("refreshing security listings", "scripts/ingest-listings.mjs");
      await runNodeScript("refreshing market quotes", "scripts/ingest-quotes.mjs");
      if (!usQuoteDisabled) {
        await runMarketPython("refreshing Yahoo/Google US quotes", [
          usPipeline,
          "--quotes-only",
          "--quote-batch-size",
          usQuoteBatchSize,
          "--quote-limit",
          usQuoteLimit,
          "--google-fallback-limit",
          usGoogleFallbackLimit,
          "--sleep",
          usSyncSleep,
        ]);
      }
      await runUSHistory(trigger);
      await runMacroSync(trigger);
      await waitForApp();
      if (!process.env.CRON_SECRET) throw new Error("CRON_SECRET is not configured");
      const response = await fetch("http://127.0.0.1:3000/api/cron/scan", {
        headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
      });
      const body = await response.text();
      if (!response.ok) throw new Error(`signal scan failed (${response.status}): ${body}`);
      console.log(`[market-refresh] ${trigger} completed: ${body}`);

      const durationMs = Date.now() - t0;
      recordSyncJob(`market-refresh/${trigger}`, "ok", null, 1, durationMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const durationMs = Date.now() - t0;
      recordSyncJob(`market-refresh/${trigger}`, "error", message, 1, durationMs);
      console.error(`[market-refresh] ${trigger} failed: ${message}`);
    }
  })()
    .finally(() => {
      marketRefreshPromise = null;
    });
  return marketRefreshPromise;
}

function scheduleRecurringMarketRefresh() {
  if (!Number.isFinite(marketRefreshIntervalMinutes) || marketRefreshIntervalMinutes <= 0) {
    console.log("[market-refresh] recurring refresh disabled");
    return;
  }
  console.log(`[market-refresh] recurring refresh every ${marketRefreshIntervalMinutes} minutes`);
  marketRefreshTimer = setInterval(
    () => runMarketRefresh("recurring"),
    marketRefreshIntervalMinutes * 60 * 1000,
  );
}

function istClock() {
  const now = new Date();
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return {
    date: ist.toISOString().slice(0, 10),
    day: ist.getUTCDay(),
    hour: ist.getUTCHours(),
    minute: ist.getUTCMinutes(),
  };
}

function isIndiaMarketOpen(clock = istClock()) {
  if (clock.day === 0 || clock.day === 6) return false;
  const minutes = clock.hour * 60 + clock.minute;
  return minutes >= 9 * 60 + 15 && minutes <= 15 * 60 + 30;
}

async function runIndiaMarketQuoteRefresh(trigger) {
  if (indiaMarketQuoteRefreshDisabled) {
    console.log(`[india-quotes] ${trigger} 15-minute refresh disabled by INDIA_MARKET_QUOTE_REFRESH_DISABLED=1`);
    return;
  }
  if (!isIndiaMarketOpen()) {
    console.log(`[india-quotes] skipping ${trigger}; Indian market is closed`);
    return;
  }
  if (indiaMarketQuoteRefreshPromise) {
    console.log(`[india-quotes] skipping ${trigger}; quote refresh still running`);
    return indiaMarketQuoteRefreshPromise;
  }

  indiaMarketQuoteRefreshPromise = (async () => {
    await waitForApp();
    if (!process.env.CRON_SECRET) throw new Error("CRON_SECRET is not configured");
    console.log(`[india-quotes] starting ${trigger} NSE/BSE market-hours quote refresh`);
    const response = await fetch("http://127.0.0.1:3000/api/cron/refresh-quotes", {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`quote refresh failed (${response.status}): ${body}`);
    console.log(`[india-quotes] ${trigger} completed: ${body}`);
  })()
    .catch((error) => console.error(`[india-quotes] ${trigger} failed: ${error.message}`))
    .finally(() => {
      indiaMarketQuoteRefreshPromise = null;
    });
  return indiaMarketQuoteRefreshPromise;
}

function scheduleIndiaMarketQuoteRefresh() {
  if (indiaMarketQuoteRefreshDisabled) {
    console.log("[india-quotes] 15-minute market-hours refresh disabled");
    return;
  }
  if (!Number.isFinite(indiaMarketQuoteRefreshIntervalMinutes) || indiaMarketQuoteRefreshIntervalMinutes <= 0) {
    console.log("[india-quotes] 15-minute market-hours refresh disabled by interval");
    return;
  }
  console.log(`[india-quotes] NSE/BSE quote refresh every ${indiaMarketQuoteRefreshIntervalMinutes} minutes during 09:15-15:30 IST`);
  indiaMarketQuoteRefreshTimer = setInterval(
    () => runIndiaMarketQuoteRefresh("market-hours"),
    indiaMarketQuoteRefreshIntervalMinutes * 60 * 1000,
  );
  setTimeout(() => runIndiaMarketQuoteRefresh("startup-market-hours"), 0);
}

async function runBackfillCron(label) {
  if (backfillDisabled) {
    console.log(`[backfill] ${label} cron disabled; set BACKFILL_CRON_ENABLED=1 to enable`);
    return;
  }
  if (backfillPromise) {
    console.log(`[backfill] skipping ${label}; backfill still running`);
    return backfillPromise;
  }
  backfillPromise = (async () => {
    await waitForApp();
    if (!process.env.CRON_SECRET) throw new Error("CRON_SECRET is not configured");
    console.log(`[backfill] starting ${label} queued OHLCV repair`);
    const response = await fetch("http://127.0.0.1:3000/api/backfill/run?job=cron", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    const body = await response.text();
    if (!response.ok && response.status !== 409) throw new Error(`backfill failed (${response.status}): ${body}`);
    console.log(`[backfill] ${label} completed: ${body}`);
  })()
    .catch((error) => console.error(`[backfill] ${label} failed: ${error.message}`))
    .finally(() => {
      backfillPromise = null;
    });
  return backfillPromise;
}

function scheduleBackfillCron() {
  if (backfillDisabled) {
    console.log("[backfill] queued OHLCV cron disabled; set BACKFILL_CRON_ENABLED=1 to enable");
    return;
  }
  const initialClock = istClock();
  if (initialClock.hour >= backfillIndiaHour) lastBackfillIndiaDate = initialClock.date;
  if (initialClock.hour >= backfillUsHour) lastBackfillUsDate = initialClock.date;
  console.log(`[backfill] queued OHLCV checks after ${backfillIndiaHour}:00 IST and ${backfillUsHour}:00 IST`);
  backfillTimer = setInterval(() => {
    const clock = istClock();
    if (clock.hour >= backfillIndiaHour && lastBackfillIndiaDate !== clock.date) {
      lastBackfillIndiaDate = clock.date;
      runBackfillCron("india-close");
    }
    if (clock.hour >= backfillUsHour && lastBackfillUsDate !== clock.date) {
      lastBackfillUsDate = clock.date;
      runBackfillCron("us-close");
    }
  }, 60 * 1000);
}

/** Run the digest. Resolves true only when the endpoint reported success, so the
 *  caller can decide whether the day is done or a retry is still owed. */
async function runEmailDigest(label) {
  if (emailDigestDisabled) {
    console.log(`[email-digest] ${label} disabled by EMAIL_DIGEST_CRON_DISABLED=1`);
    return false;
  }
  if (emailDigestPromise) {
    console.log(`[email-digest] skipping ${label}; a send is still running`);
    return emailDigestPromise;
  }
  emailDigestPromise = (async () => {
    await waitForApp();
    if (!process.env.CRON_SECRET) throw new Error("CRON_SECRET is not configured");
    console.log(`[email-digest] starting ${label} daily digest send`);
    const response = await fetch("http://127.0.0.1:3000/api/cron/send-email-digest", {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`email digest failed (${response.status}): ${body}`);
    // The route returns 200 with status "partial" when some recipients failed
    // (e.g. SMTP unreachable). Treat anything short of a clean success as a
    // failure so the retry path engages.
    let payload = null;
    try { payload = JSON.parse(body); } catch { /* non-JSON body — treat as failure below */ }
    if (!payload || payload.status !== "success") {
      throw new Error(`email digest did not fully succeed: ${body}`);
    }
    console.log(`[email-digest] ${label} completed: ${body}`);
    return true;
  })()
    .catch((error) => {
      console.error(`[email-digest] ${label} failed: ${error.message}`);
      return false;
    })
    .finally(() => {
      emailDigestPromise = null;
    });
  return emailDigestPromise;
}

function emailDigestTargetMinutes() {
  return emailDigestHour * 60 + emailDigestMinute;
}

/** IST date (YYYY-MM-DD) of the most recent successful digest send, or null. */
async function lastDigestSendDateIst() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return null;
  const client = new Client({
    connectionString: databaseUrl,
    ssl: /127\.0\.0\.1|localhost/.test(databaseUrl) ? false : { rejectUnauthorized: false },
  });
  try {
    await client.connect();
    const res = await client.query(
      `select max(last_sent_at) as last_sent from public.email_preferences where enabled = true`,
    );
    const lastSent = res.rows[0]?.last_sent;
    if (!lastSent) return null;
    return new Date(new Date(lastSent).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
  } catch (error) {
    console.error(`[email-digest] could not read last send time: ${error.message}`);
    return null;
  } finally {
    await client.end().catch(() => {});
  }
}

function scheduleEmailDigest() {
  if (emailDigestDisabled) {
    console.log("[email-digest] daily digest disabled; set EMAIL_DIGEST_CRON_DISABLED=1 to keep off");
    return;
  }
  const hh = String(emailDigestHour).padStart(2, "0");
  const mm = String(emailDigestMinute).padStart(2, "0");
  console.log(`[email-digest] daily digest scheduled for ${hh}:${mm} IST`);

  // Seed "already sent today" from the DB rather than assuming it. A machine that
  // was asleep/offline at the target time still gets its digest on the next start
  // (catch-up), while a plain restart after a successful send does not re-send.
  (async () => {
    const sentDate = await lastDigestSendDateIst();
    const clock = istClock();
    if (sentDate === clock.date) {
      lastEmailDigestDate = clock.date;
      console.log("[email-digest] already sent today; next send tomorrow");
    } else if (clock.hour * 60 + clock.minute >= emailDigestTargetMinutes()) {
      console.log("[email-digest] missed today's window — sending catch-up digest now");
    }
  })();

  emailDigestTimer = setInterval(() => {
    const clock = istClock();
    const nowMinutes = clock.hour * 60 + clock.minute;
    if (nowMinutes < emailDigestTargetMinutes()) return; // before the send time
    if (lastEmailDigestDate === clock.date) return;      // already sent today

    // New day → reset the attempt budget.
    if (emailDigestAttemptDate !== clock.date) {
      emailDigestAttemptDate = clock.date;
      emailDigestAttempts = 0;
      emailDigestNextRetryAt = 0;
    }
    if (emailDigestAttempts >= emailDigestMaxAttempts) return; // gave up for today
    if (Date.now() < emailDigestNextRetryAt) return;           // backing off

    emailDigestAttempts += 1;
    emailDigestNextRetryAt = Date.now() + emailDigestRetryMs;
    const label = emailDigestAttempts === 1 ? "daily" : `retry ${emailDigestAttempts}/${emailDigestMaxAttempts}`;
    runEmailDigest(label).then((ok) => {
      if (ok) {
        lastEmailDigestDate = clock.date; // only a clean success closes the day
      } else if (emailDigestAttempts >= emailDigestMaxAttempts) {
        console.error(`[email-digest] giving up for ${clock.date} after ${emailDigestAttempts} attempts`);
      }
    });
  }, 60 * 1000);
}

function runYahooNseSync(trigger) {
  if (syncDisabled) {
    console.log(`[nse-sync] ${trigger} sync disabled by NSE_SYNC_DISABLED=1`);
    return;
  }
  if (!python) {
    console.error("[nse-sync] no Python executable found");
    return;
  }
  if (syncChild) {
    console.log(`[nse-sync] skipping ${trigger}; another sync is still running`);
    return;
  }

  console.log(`[nse-sync] starting ${trigger} incremental update`);
  const args = [pipeline, "--sleep", syncSleep];
  if (process.env.NSE_SYNC_SYMBOLS) args.push("--symbols", process.env.NSE_SYNC_SYMBOLS);
  if (process.env.NSE_SYNC_LIMIT) args.push("--limit", process.env.NSE_SYNC_LIMIT);
  if (process.env.NSE_SYNC_DRY_RUN === "1") args.push("--dry-run");
  syncChild = spawn(
    python,
    args,
    { cwd: root, env: process.env, stdio: "inherit" },
  );
  syncChild.on("error", (error) => {
    console.error(`[nse-sync] unable to start: ${error.message}`);
  });
  syncChild.on("close", async (code, signal) => {
    syncChild = null;
    if (signal) console.log(`[nse-sync] stopped by ${signal}`);
    else if (code === 0) {
      console.log(`[nse-sync] ${trigger} update completed`);
      runMarketRefresh(`${trigger} post-sync`);
    }
    else console.error(`[nse-sync] ${trigger} update failed with exit code ${code}`);
    if (!signal) await runFundamentals(trigger);
  });
}

async function runBhavcopyNseSyncWithRetry(trigger, maxRetries = 2) {
  const t0 = Date.now();
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await waitForApp();
      if (!process.env.CRON_SECRET) throw new Error("CRON_SECRET is not configured");

      const runExchangeBhavcopy = async (exchange, path) => {
        const url = new URL(`http://127.0.0.1:3000${path}`);
        url.searchParams.set("maxSessions", nseBhavcopyMaxSessions);
        console.log(
          `[nse-sync] starting ${trigger} ${exchange} bhavcopy OHLCV update (max ${nseBhavcopyMaxSessions} sessions)`,
        );
        const response = await fetch(url, {
          headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
        });
        const body = await response.text();
        if (!response.ok) throw new Error(`${exchange} bhavcopy update failed (${response.status}): ${body}`);
        console.log(`[nse-sync] ${trigger} ${exchange} bhavcopy update completed: ${body}`);
      };

      console.log(
        `[nse-sync] ${trigger} India OHLCV standard provider: bhavcopy; Yahoo/Google remain queued repair fallback`,
      );
      await runExchangeBhavcopy("NSE", "/api/cron/backfill-nse");
      await runExchangeBhavcopy("BSE", "/api/cron/backfill-bse");

      const durationMs = Date.now() - t0;
      recordSyncJob(`nse-sync/${trigger}`, "ok", null, attempt, durationMs);
      return true;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);

      if (attempt < maxRetries) {
        const backoffMs = 1000 * Math.pow(2, attempt - 1); // 1s, 2s, 4s...
        console.warn(
          `[nse-sync] ${trigger} attempt ${attempt} failed: ${lastError}. Retrying in ${Math.round(backoffMs)}ms...`,
        );
        await sleep(backoffMs);
      }
    }
  }

  const durationMs = Date.now() - t0;
  recordSyncJob(`nse-sync/${trigger}`, "error", lastError, maxRetries, durationMs);
  console.error(`[nse-sync] ${trigger} failed after ${maxRetries} attempts: ${lastError}`);
  return false;
}

function runBhavcopyNseSync(trigger) {
  if (syncDisabled) {
    console.log(`[nse-sync] ${trigger} sync disabled by NSE_SYNC_DISABLED=1`);
    recordSyncJob(`nse-sync/${trigger}`, "skipped", "disabled");
    return syncPromise;
  }
  if (syncPromise) {
    console.log(`[nse-sync] skipping ${trigger}; another sync is still running`);
    return syncPromise;
  }

  syncPromise = (async () => {
    const success = await runBhavcopyNseSyncWithRetry(trigger, 2);
    if (success) {
      runMarketRefresh(`${trigger} post-sync`);
    }
  })()
    .catch((error) => {
      console.error(`[nse-sync] ${trigger} fatal error: ${error.message}`);
      recordSyncJob(`nse-sync/${trigger}`, "error", error.message);
    })
    .finally(async () => {
      syncPromise = null;
      await runFundamentals(trigger);
    });
  return syncPromise;
}

function runSync(trigger) {
  if (nseSyncProvider === "yahoo" || nseSyncProvider === "yfinance") {
    return runYahooNseSync(trigger);
  }
  if (nseSyncProvider !== "bhavcopy") {
    console.warn(`[nse-sync] unknown NSE_SYNC_PROVIDER=${nseSyncProvider}; using bhavcopy`);
  }
  return runBhavcopyNseSync(trigger);
}

async function runFundamentals(trigger) {
  if (fundamentalsDisabled) {
    console.log(`[fundamentals] ${trigger} sync disabled by FUNDAMENTALS_SYNC_DISABLED=1`);
    recordSyncJob(`fundamentals/${trigger}`, "skipped", "disabled");
    await runUSFundamentals(trigger);
    return;
  }
  if (!python || fundamentalsChild) {
    if (fundamentalsChild) console.log(`[fundamentals] skipping ${trigger}; sync still running`);
    return;
  }

  // Check if upstream NSE sync succeeded before running fundamentals
  // Fundamentals depends on fresh OHLCV data
  const nseHealth = await isUpstreamSyncHealthy("backfill-nse", 24);
  const bseHealth = await isUpstreamSyncHealthy("backfill-bse", 24);
  if (!nseHealth || !bseHealth) {
    console.log(
      `[fundamentals] skipping ${trigger}; upstream OHLCV sync unhealthy (NSE: ${nseHealth ? "✓" : "✗"}, BSE: ${bseHealth ? "✓" : "✗"})`
    );
    recordSyncJob(
      `fundamentals/${trigger}`,
      "skipped",
      `upstream unhealthy (NSE: ${nseHealth ? "ok" : "error"}, BSE: ${bseHealth ? "ok" : "error"})`
    );
    await runUSFundamentals(trigger);
    return;
  }
  const pipelinePath = resolve(root, "pipelines/stock_fundamentals_sync.py");
  const args = [pipelinePath, "--sleep", fundamentalsSleep];
  if (process.env.FUNDAMENTALS_SYNC_SYMBOLS) {
    args.push("--symbols", process.env.FUNDAMENTALS_SYNC_SYMBOLS);
  }
  if (process.env.FUNDAMENTALS_SYNC_LIMIT) {
    args.push("--limit", process.env.FUNDAMENTALS_SYNC_LIMIT);
  }
  if (process.env.FUNDAMENTALS_SYNC_DRY_RUN === "1") args.push("--dry-run");

  console.log(`[fundamentals] starting ${trigger} incremental update`);
  fundamentalsChild = spawn(python, args, { cwd: root, env: process.env, stdio: "inherit" });
  fundamentalsChild.on("error", (error) => {
    console.error(`[fundamentals] unable to start: ${error.message}`);
    recordSyncJob(`fundamentals/${trigger}`, "error", error.message);
  });
  fundamentalsChild.on("close", (code, signal) => {
    fundamentalsChild = null;
    if (signal) {
      console.log(`[fundamentals] stopped by ${signal}`);
      recordSyncJob(`fundamentals/${trigger}`, "error", `stopped by ${signal}`);
    } else if (code === 0) {
      console.log(`[fundamentals] ${trigger} update completed`);
      recordSyncJob(`fundamentals/${trigger}`, "ok");
    } else {
      console.error(`[fundamentals] ${trigger} update failed with exit code ${code}`);
      recordSyncJob(`fundamentals/${trigger}`, "error", `exit code ${code}`);
    }
    if (!signal) runUSFundamentals(trigger);
  });
}

function runUSHistory(trigger) {
  if (usHistoryDisabled) {
    console.log(`[us-history] ${trigger} sync disabled by US_HISTORY_SYNC_DISABLED=1`);
    return Promise.resolve();
  }
  if (!python) {
    console.error("[us-history] no Python executable found");
    return Promise.resolve();
  }
  if (usHistoryChild) {
    console.log(`[us-history] skipping ${trigger}; sync still running`);
    return Promise.resolve();
  }

  const args = [
    usHistoryPipeline,
    "--limit",
    usHistoryLimit,
    "--min-bars",
    usHistoryMinBars,
    "--sleep",
    usHistorySleep,
  ];
  if (process.env.US_HISTORY_SYMBOLS) args.push("--symbols", process.env.US_HISTORY_SYMBOLS);
  if (process.env.US_HISTORY_DRY_RUN === "1") args.push("--dry-run");
  if (process.env.US_HISTORY_FORCE_FULL === "1") args.push("--force-full");

  return new Promise((resolveRun) => {
    console.log(`[us-history] starting ${trigger} OHLCV coverage update`);
    usHistoryChild = spawn(
      python,
      args,
      { cwd: root, env: process.env, stdio: "inherit" },
    );
    usHistoryChild.on("error", (error) => {
      console.error(`[us-history] unable to start: ${error.message}`);
      usHistoryChild = null;
      resolveRun();
    });
    usHistoryChild.on("close", (code, signal) => {
      usHistoryChild = null;
      if (signal) console.log(`[us-history] stopped by ${signal}`);
      else if (code === 0) console.log(`[us-history] ${trigger} update completed`);
      else console.error(`[us-history] ${trigger} update failed with exit code ${code}`);
      resolveRun();
    });
  });
}

async function runUSFundamentals(trigger) {
  if (usFundamentalsDisabled) {
    console.log(`[us-fundamentals] ${trigger} sync disabled by US_FUNDAMENTALS_SYNC_DISABLED=1`);
    recordSyncJob(`us-fundamentals/${trigger}`, "skipped", "disabled");
    return;
  }
  if (!python || usFundamentalsChild) {
    if (usFundamentalsChild) {
      console.log(`[us-fundamentals] skipping ${trigger}; sync still running`);
    }
    return;
  }

  // Check if upstream US history sync succeeded
  // US fundamentals depends on fresh US OHLCV data
  const usHistoryHealth = await isUpstreamSyncHealthy("backfill-us", 24);
  if (!usHistoryHealth) {
    console.log(
      `[us-fundamentals] skipping ${trigger}; upstream US OHLCV sync unhealthy`
    );
    recordSyncJob(
      `us-fundamentals/${trigger}`,
      "skipped",
      "upstream US history unhealthy"
    );
    return;
  }

  const args = [
    usPipeline,
    "--fundamentals-only",
    "--fundamentals-limit",
    usFundamentalsLimit,
    "--stale-days",
    usFundamentalsStaleDays,
    "--sleep",
    usSyncSleep,
  ];
  if (process.env.US_FUNDAMENTALS_SYMBOLS) {
    args.push("--symbols", process.env.US_FUNDAMENTALS_SYMBOLS);
  }
  if (process.env.US_FUNDAMENTALS_DRY_RUN === "1") args.push("--dry-run");

  console.log(`[us-fundamentals] starting ${trigger} incremental update`);
  usFundamentalsChild = spawn(
    python,
    args,
    { cwd: root, env: process.env, stdio: "inherit" },
  );
  usFundamentalsChild.on("error", (error) => {
    console.error(`[us-fundamentals] unable to start: ${error.message}`);
  });
  usFundamentalsChild.on("close", (code, signal) => {
    usFundamentalsChild = null;
    if (signal) console.log(`[us-fundamentals] stopped by ${signal}`);
    else if (code === 0) console.log(`[us-fundamentals] ${trigger} update completed`);
    else console.error(`[us-fundamentals] ${trigger} update failed with exit code ${code}`);
  });
}

function millisecondsUntilNextIstRun() {
  const now = new Date();
  const istNow = new Date(now.getTime() + IST_OFFSET_MS);
  const targetAsUtc = Date.UTC(
    istNow.getUTCFullYear(),
    istNow.getUTCMonth(),
    istNow.getUTCDate(),
    syncHour,
    syncMinute,
  );
  let target = targetAsUtc - IST_OFFSET_MS;
  if (target <= now.getTime()) target += 24 * 60 * 60 * 1000;
  return target - now.getTime();
}

function scheduleDailySync() {
  const delay = millisecondsUntilNextIstRun();
  const nextRun = new Date(Date.now() + delay);
  console.log(
    `[nse-sync] next daily update: ${nextRun.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`,
  );
  dailyTimer = setTimeout(() => {
    runSync("daily");
    scheduleDailySync();
  }, delay);
}

const nextChild = spawn(
  process.execPath,
  [nextCli, mode, ...process.argv.slice(3)],
  { cwd: root, env: process.env, stdio: "inherit" },
);

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (dailyTimer) clearTimeout(dailyTimer);
  if (marketRefreshTimer) clearInterval(marketRefreshTimer);
  if (indiaMarketQuoteRefreshTimer) clearInterval(indiaMarketQuoteRefreshTimer);
  if (backfillTimer) clearInterval(backfillTimer);
  if (emailDigestTimer) clearInterval(emailDigestTimer);
  if (syncChild) syncChild.kill(signal);
  if (fundamentalsChild) fundamentalsChild.kill(signal);
  if (usFundamentalsChild) usFundamentalsChild.kill(signal);
  if (usHistoryChild) usHistoryChild.kill(signal);
  if (macroChild) macroChild.kill(signal);
  if (marketRefreshChild) marketRefreshChild.kill(signal);

  // Print startup summary before killing Next.js
  if (syncStats.attempted > 0) {
    printSyncSummary();
  }

  nextChild.kill(signal);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(signal));
}

nextChild.on("error", (error) => {
  console.error(`Unable to start Next.js: ${error.message}`);
  shutdown("SIGTERM");
});
nextChild.on("close", (code, signal) => {
  if (dailyTimer) clearTimeout(dailyTimer);
  if (marketRefreshTimer) clearInterval(marketRefreshTimer);
  if (indiaMarketQuoteRefreshTimer) clearInterval(indiaMarketQuoteRefreshTimer);
  if (backfillTimer) clearInterval(backfillTimer);
  if (emailDigestTimer) clearInterval(emailDigestTimer);
  if (syncChild) syncChild.kill("SIGTERM");
  if (fundamentalsChild) fundamentalsChild.kill("SIGTERM");
  if (usFundamentalsChild) usFundamentalsChild.kill("SIGTERM");
  if (usHistoryChild) usHistoryChild.kill("SIGTERM");
  if (macroChild) macroChild.kill("SIGTERM");
  if (marketRefreshChild) marketRefreshChild.kill("SIGTERM");
  process.exitCode = signal ? 1 : (code ?? 1);
});

scheduleDailySync();
scheduleRecurringMarketRefresh();
scheduleIndiaMarketQuoteRefresh();
scheduleBackfillCron();
scheduleEmailDigest();
setTimeout(() => {
  if (syncDisabled) {
    runMarketRefresh("startup");
    runFundamentals("startup");
  } else {
    runSync("startup");
  }
  // Print summary after startup syncs have time to complete (10 seconds)
  setTimeout(() => {
    if (syncStats.attempted > 0) {
      printSyncSummary();
    }
  }, 10000);
}, 0);
