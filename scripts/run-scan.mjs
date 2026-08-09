// Standalone swing scan.
//
// The scan used to be triggered by fetching /api/cron/scan, which ran it inside the Next.js
// server process. Measured against the same database and the same background sync load, the
// identical function took ~20s in its own process and ~91s inside the server — a 4.5x penalty
// that repeatedly pushed it past its timeout and left swing_signals stale. Running it here
// keeps it off the server's event loop and connection pool.
//
// The route still exists for manual and external-cron triggers. Both paths call the same
// computeSignals(), so signals do not depend on which one ran.
//
// Usage: node --import ./scripts/ts-alias-hook.mjs scripts/run-scan.mjs
import { computeSignals } from "@/lib/ingest/signals";
import { logCronRun } from "@/lib/ingest/cronLog";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("[scan] DATABASE_URL is not configured");
  process.exit(1);
}

const startedAt = Date.now();
try {
  const summary = await computeSignals(databaseUrl);
  const durationMs = Date.now() - startedAt;
  await logCronRun(databaseUrl, {
    job: "scan",
    status: "ok",
    detail: { scanned: summary.scanned, setups: summary.setups, runner: "standalone" },
    durationMs,
  }).catch(() => null);
  console.log(`[scan] ok scanned=${summary.scanned} setups=${summary.setups} in ${(durationMs / 1000).toFixed(1)}s`);
  process.exit(0);
} catch (error) {
  const durationMs = Date.now() - startedAt;
  const message = error instanceof Error ? error.message : String(error);
  await logCronRun(databaseUrl, {
    job: "scan",
    status: "error",
    error: message,
    detail: { runner: "standalone" },
    durationMs,
  }).catch(() => null);
  console.error(`[scan] failed after ${(durationMs / 1000).toFixed(1)}s: ${message}`);
  process.exit(1);
}
