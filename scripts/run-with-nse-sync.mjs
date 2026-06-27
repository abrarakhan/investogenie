import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const mode = process.argv[2];
if (mode !== "dev" && mode !== "start") {
  console.error("Usage: node scripts/run-with-nse-sync.mjs <dev|start> [next options]");
  process.exit(2);
}

const root = process.cwd();
const nextCli = resolve(root, "node_modules/next/dist/bin/next");
const pipeline = resolve(root, "pipelines/nse_yfinance_sync.py");
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
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

let syncChild = null;
let fundamentalsChild = null;
let dailyTimer = null;
let shuttingDown = false;

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
    else if (code === 0) console.log(`[nse-sync] ${trigger} update completed`);
    else console.error(`[nse-sync] ${trigger} update failed with exit code ${code}`);
    if (!signal) runFundamentals(trigger);
  });
}

function runFundamentals(trigger) {
  if (fundamentalsDisabled) {
    console.log(`[fundamentals] ${trigger} sync disabled by FUNDAMENTALS_SYNC_DISABLED=1`);
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
  if (syncChild) syncChild.kill(signal);
  if (fundamentalsChild) fundamentalsChild.kill(signal);
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
  if (syncChild) syncChild.kill("SIGTERM");
  if (fundamentalsChild) fundamentalsChild.kill("SIGTERM");
  process.exitCode = signal ? 1 : (code ?? 1);
});

scheduleDailySync();
setTimeout(() => {
  if (syncDisabled) runFundamentals("startup");
  else runSync("startup");
}, 0);
