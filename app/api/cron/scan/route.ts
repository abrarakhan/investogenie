import { type NextRequest, NextResponse } from "next/server";
import { computeSignals } from "@/lib/ingest/signals";
import type { ScanSummary } from "@/lib/ingest/signals";
import { checkCronAuth, logCronRun } from "@/lib/ingest/cronLog";
import { runSyncJobWithRetry } from "@/lib/ingest/syncJobWrapper";
import { getSyncTrend } from "@/lib/ingest/syncMonitor";

// Scheduled swing scan over the whole universe → swing_signals (read by the
// screener). Strictly gated by CRON_SECRET. Node runtime (uses `pg`). Every run
// is recorded to public.cron_logs.
// Gracefully degrades if upstream (quotes/OHLCV) is stale: skips with "skipped" status.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 360;

export async function GET(request: NextRequest) {
  const t0 = Date.now();

  const auth = checkCronAuth(request.headers.get("authorization"), process.env.CRON_SECRET);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.reason }, { status: auth.status });
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return NextResponse.json({ ok: false, error: "DATABASE_URL not configured" }, { status: 500 });
  }

  // Check if upstream (quote refresh) has been successful recently (< 20% failure rate)
  const quoteTrend = await getSyncTrend("refresh-quotes", 24);
  if (quoteTrend.failureRate > 0.2) {
    const durationMs = Date.now() - t0;
    await logCronRun(databaseUrl, {
      job: "scan",
      status: "skipped",
      error: `quotes too stale (${(quoteTrend.failureRate * 100).toFixed(1)}% failure rate in 24h)`,
      detail: { quoteTrend },
      durationMs,
    }).catch(() => null);
    return NextResponse.json(
      { ok: true, skipped: true, reason: "upstream quotes too stale" },
      { status: 200 }
    );
  }

  const result = await runSyncJobWithRetry(
    "scan",
    () => computeSignals(databaseUrl),
    {
      // A full scan is ~30s on an idle database, but it runs inside the same process as the
      // sync scheduler and routinely overlaps a Python sync job, which stretches it well past
      // two minutes. The previous 110s budget failed every daytime run for that reason.
      timeoutMs: 300000,
      // No retry. runSyncJobWithRetry races the job against a timer and cannot cancel the
      // loser, so a timed-out scan keeps running; retrying started a second full scan on top
      // of the first, doubling database load and guaranteeing the retry timed out too. That
      // is what turned a slow scan into a permanent 222s failure. A missed scan is picked up
      // by the next hourly run instead.
      maxRetries: 0,
      backoffMs: 2000,
      databaseUrl,
    }
  );

  if (result.success) {
    const summary = result.detail as ScanSummary | undefined;
    return NextResponse.json({
      ok: true,
      scanned: summary?.scanned,
      setups: summary?.setups,
      attempts: result.attempts,
      durationMs: result.durationMs,
    });
  }

  // Return 503 Service Unavailable on failure
  return NextResponse.json(
    { ok: false, error: result.error, attempts: result.attempts },
    { status: 503 }
  );
}
