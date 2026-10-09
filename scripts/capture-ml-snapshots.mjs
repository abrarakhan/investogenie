import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { getStrongSwingCandidates } from "@/lib/strongSwing";
import { DEFAULT_SETTINGS } from "@/lib/settings";

const root = process.cwd();
const market = process.argv[2] === "US" ? "US" : "IN";
const marketDate = process.argv[3];
if (!/^\d{4}-\d{2}-\d{2}$/.test(marketDate ?? "")) {
  console.error("Usage: capture-ml-snapshots.mjs <IN|US> <YYYY-MM-DD>");
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const runId = randomUUID();
const decisionTime = market === "IN" ? "18:45:00" : "17:15:00";
const featureVersion = "strong-swing-features-v1";
const calendarVersion = market === "IN" ? "NSE-calendar-v1" : "NYSE-calendar-v1";

const candidates = await getStrongSwingCandidates(market, DEFAULT_SETTINGS, {
  source: "scheduled",
  decisionTime,
  schedulerRunId: runId,
  marketDate,
  dataCutoff: new Date().toISOString(),
  featureVersion,
  calendarVersion,
});

const pythonCandidates = [
  process.env.PYTHON_BIN,
  resolve(root, ".venv/bin/python"),
  resolve(root, ".venv/bin/python3"),
  "python3",
].filter(Boolean);
const python = pythonCandidates.find((candidate) => candidate.includes("/") ? existsSync(candidate) : true);
if (!python) throw new Error("Python runtime is unavailable");

await new Promise((resolveRun, rejectRun) => {
  const child = spawn(python, [
    resolve(root, "pipelines/ml/collect_snapshots.py"),
    "--database-url", process.env.DATABASE_URL,
    "--scheduler-run-id", runId,
    "--market", market,
    "--market-date", marketDate,
  ], { cwd: root, env: process.env, stdio: "inherit" });
  child.once("error", rejectRun);
  child.once("close", (code, signal) => {
    if (code === 0 && !signal) resolveRun();
    else rejectRun(new Error(`Python feature collector exited ${signal ?? code}`));
  });
});

console.log(`[ml-snapshots] market=${market} date=${marketDate} candidates=${candidates.length} run=${runId}`);
