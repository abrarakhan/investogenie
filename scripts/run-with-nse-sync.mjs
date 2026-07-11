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
const pythonCandidates = [
  process.env.PYTHON_BIN,
  resolve(root, ".venv/bin/python"),
  resolve(root, ".venv/bin/python3"),
  "python3",
].filter(Boolean);
const python = pythonCandidates.find((candidate) =>
  candidate.includes("/") ? existsSync(candidate) : true,
);

const syncHour = Number(process.env.NSE_SYNC_HOUR_IST ?? 18);
const syncMinute = Number(process.env.NSE_SYNC_MINUTE_IST ?? 30);
const syncSleep = process.env.NSE_SYNC_SLEEP_SECONDS ?? "1.2";
const syncDisabled = process.env.NSE_SYNC_DISABLED === "1";
const fundamentalsSleep = process.env.FUNDAMENTALS_SYNC_SLEEP_SECONDS ?? "1.5";
const fundamentalsDisabled = process.env.FUNDAMENTALS_SYNC_DISABLED === "1";
const usQuoteDisabled = process.env.US_QUOTE_SYNC_DISABLED === "1";
const usQuoteLimit = process.env.US_QUOTE_LIMIT ?? "1500";
const usQuoteBatchSize = process.env.US_QUOTE_BATCH_SIZE ?? "100";
const usGoogleFallbackLimit = process.env.US_GOOGLE_FALLBACK_LIMIT ?? "100";
const marketRefreshIntervalMinutes = Number(process.env.MARKET_REFRESH_INTERVAL_MINUTES ?? 60);
const usSyncSleep = process.env.US_SYNC_SLEEP_SECONDS ?? "0.4";
const usFundamentalsLimit = process.env.US_FUNDAMENTALS_LIMIT ?? "250";
const usFundamentalsStaleDays = process.env.US_FUNDAMENTALS_STALE_DAYS ?? "7";
const usFundamentalsDisabled = process.env.US_FUNDAMENTALS_SYNC_DISABLED === "1";
const usHistoryDisabled = process.env.US_HISTORY_SYNC_DISABLED === "1";
const usHistoryLimit = process.env.US_HISTORY_LIMIT ?? "50";
const usHistoryMinBars = process.env.US_HISTORY_MIN_BARS ?? "260";
const usHistorySleep = process.env.US_HISTORY_SLEEP_SECONDS ?? "0.25";
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

let syncChild = null;
let fundamentalsChild = null;
let usFundamentalsChild = null;
let usHistoryChild = null;
let marketRefreshChild = null;
let marketRefreshPromise = null;
let marketRefreshTimer = null;
let dailyTimer = null;
let shuttingDown = false;

const sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));

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

function runMarketRefresh(trigger) {
  if (marketRefreshPromise) {
    console.log(`[market-refresh] skipping ${trigger}; refresh still running`);
    return marketRefreshPromise;
  }

  marketRefreshPromise = (async () => {
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
    await waitForApp();
    if (!process.env.CRON_SECRET) throw new Error("CRON_SECRET is not configured");
    const response = await fetch("http://127.0.0.1:3000/api/cron/scan", {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`signal scan failed (${response.status}): ${body}`);
    console.log(`[market-refresh] ${trigger} completed: ${body}`);
  })()
    .catch((error) => {
      console.error(`[market-refresh] ${trigger} failed: ${error.message}`);
    })
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

function runSync(trigger) {
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
  syncChild.on("close", (code, signal) => {
    syncChild = null;
    if (signal) console.log(`[nse-sync] stopped by ${signal}`);
    else if (code === 0) {
      console.log(`[nse-sync] ${trigger} update completed`);
      runMarketRefresh(`${trigger} post-sync`);
    }
    else console.error(`[nse-sync] ${trigger} update failed with exit code ${code}`);
    if (!signal) runFundamentals(trigger);
  });
}

function runFundamentals(trigger) {
  if (fundamentalsDisabled) {
    console.log(`[fundamentals] ${trigger} sync disabled by FUNDAMENTALS_SYNC_DISABLED=1`);
    runUSFundamentals(trigger);
    return;
  }
  if (!python || fundamentalsChild) {
    if (fundamentalsChild) console.log(`[fundamentals] skipping ${trigger}; sync still running`);
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
  });
  fundamentalsChild.on("close", (code, signal) => {
    fundamentalsChild = null;
    if (signal) console.log(`[fundamentals] stopped by ${signal}`);
    else if (code === 0) console.log(`[fundamentals] ${trigger} update completed`);
    else console.error(`[fundamentals] ${trigger} update failed with exit code ${code}`);
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

function runUSFundamentals(trigger) {
  if (usFundamentalsDisabled) {
    console.log(`[us-fundamentals] ${trigger} sync disabled by US_FUNDAMENTALS_SYNC_DISABLED=1`);
    return;
  }
  if (!python || usFundamentalsChild) {
    if (usFundamentalsChild) {
      console.log(`[us-fundamentals] skipping ${trigger}; sync still running`);
    }
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
  if (syncChild) syncChild.kill(signal);
  if (fundamentalsChild) fundamentalsChild.kill(signal);
  if (usFundamentalsChild) usFundamentalsChild.kill(signal);
  if (usHistoryChild) usHistoryChild.kill(signal);
  if (marketRefreshChild) marketRefreshChild.kill(signal);
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
  if (syncChild) syncChild.kill("SIGTERM");
  if (fundamentalsChild) fundamentalsChild.kill("SIGTERM");
  if (usFundamentalsChild) usFundamentalsChild.kill("SIGTERM");
  if (usHistoryChild) usHistoryChild.kill("SIGTERM");
  if (marketRefreshChild) marketRefreshChild.kill("SIGTERM");
  process.exitCode = signal ? 1 : (code ?? 1);
});

scheduleDailySync();
scheduleRecurringMarketRefresh();
setTimeout(() => {
  runMarketRefresh("startup");
  if (syncDisabled) runFundamentals("startup");
  else runSync("startup");
}, 0);
