import { type NextRequest, NextResponse } from "next/server";
import { refreshQuotes } from "@/lib/ingest/quotes";
import { checkCronAuth, logCronRun } from "@/lib/ingest/cronLog";
import { runSyncJobWithRetry } from "@/lib/ingest/syncJobWrapper";

// Scheduled latest-price refresh. Wired to a daily cron (see vercel.json).
// Strictly gated by CRON_SECRET so only the scheduler (or an authorized caller)
// can trigger the ~12k-row ingestion. Runs on the Node runtime (uses `pg` +
// fetch). Every run — success or failure — is recorded to public.cron_logs.
// Retries on transient failures (network, timeouts) up to 2x with backoff.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
  const auth = checkCronAuth(request.headers.get("authorization"), process.env.CRON_SECRET);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.reason }, { status: auth.status });
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return NextResponse.json({ ok: false, error: "DATABASE_URL not configured" }, { status: 500 });
  }

  const result = await runSyncJobWithRetry(
    "refresh-quotes",
    () => refreshQuotes(databaseUrl),
    {
      maxRetries: 2,
      backoffMs: 2000,
      timeoutMs: 50000, // 50s timeout for quote refresh
      databaseUrl,
    }
  );

  if (result.success) {
    return NextResponse.json({
      ok: true,
      detail: result.detail,
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
