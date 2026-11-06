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
    detail: {
      scanned: summary.scanned,
      setups: summary.setups,
      retired: summary.retired,
      retirementSkippedMarkets: summary.retirementSkippedMarkets,
      coverageByMarket: summary.coverageByMarket,
      coverageGaps: summary.coverageGaps,
      runner: "standalone",
    },
    durationMs,
  }).catch(() => null);
  const skipped = summary.retirementSkippedMarkets?.length
    ? ` retirement-skipped=${summary.retirementSkippedMarkets.join(",")}`
    : "";
  const coverage = Object.entries(summary.coverageByMarket ?? {})
    .map(([market, ratio]) => `${market}=${(ratio * 100).toFixed(1)}%`).join(",");
  for (const [market, gap] of Object.entries(summary.coverageGaps ?? {})) {
    if (!gap.lagging && !gap.shortHistory) continue;
    const sample = gap.laggingSample?.length ? ` e.g. ${gap.laggingSample.join(",")}` : "";
    console.log(`[scan] ${market} coverage gap: lagging=${gap.lagging} short-history=${gap.shortHistory}${sample}`);
  }
  console.log(`[scan] ok scanned=${summary.scanned} setups=${summary.setups} retired=${summary.retired}${skipped} coverage=${coverage} in ${(durationMs / 1000).toFixed(1)}s`);
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
