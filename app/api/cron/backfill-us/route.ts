import { type NextRequest, NextResponse } from "next/server";
import { backfillUsHistory } from "@/lib/ingest/usHistory";
import { checkCronAuth, logCronRun } from "@/lib/ingest/cronLog";
import { runSyncJobWithRetry } from "@/lib/ingest/syncJobWrapper";

// Scheduled US daily-EOD top-up into daily_ohlcv from the real provider
// (FINANCIAL_API_KEY). Runs incrementally — a short trailing window keeps the
// 200-day series current for the Minervini / PTJ indicators. The one-off full
// ≥250-session seed is scripts/backfill-us-history.mjs. Strictly CRON_SECRET
// gated; every run recorded to public.cron_logs.
// Retries on transient failures (network, timeouts) up to 2x with backoff.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request.headers.get("authorization"), process.env.CRON_SECRET);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.reason }, { status: auth.status });
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return NextResponse.json({ ok: false, error: "DATABASE_URL not configured" }, { status: 500 });
  }
  const apiKey = process.env.FINANCIAL_API_KEY;
  if (!apiKey) {
    // Surface the misconfiguration AND record it, rather than silently skipping.
    const message = "FINANCIAL_API_KEY not configured";
    await logCronRun(databaseUrl, {
      job: "backfill-us",
      status: "error",
      error: message,
      durationMs: 0,
    });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  const result = await runSyncJobWithRetry(
    "backfill-us",
    () => backfillUsHistory(databaseUrl, apiKey, { sessions: 15 }),
    {
      maxRetries: 2,
      backoffMs: 3000,
      timeoutMs: 110000, // 110s timeout for backfill (less than maxDuration 120s)
      databaseUrl,
    }
  );

  if (result.success) {
    const summary = result.detail as any;
    return NextResponse.json({
      ok: true,
      tickersRequested: summary?.tickersRequested,
      tickersFetched: summary?.tickersFetched,
      barsUpserted: summary?.barsUpserted,
      failures: summary?.failures?.slice(0, 25),
      attempts: result.attempts,
      durationMs: result.durationMs,
    });
  }

  // Return 503 Service Unavailable on failure (signals to Vercel to retry)
  return NextResponse.json(
    { ok: false, error: result.error, attempts: result.attempts },
    { status: 503 }
  );
}
