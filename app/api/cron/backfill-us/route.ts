import { type NextRequest, NextResponse } from "next/server";
import { backfillUsHistory } from "@/lib/ingest/usHistory";
import { checkCronAuth, logCronRun } from "@/lib/ingest/cronLog";

// Scheduled US daily-EOD top-up into daily_ohlcv from the real provider
// (FINANCIAL_API_KEY). Runs incrementally — a short trailing window keeps the
// 200-day series current for the Minervini / PTJ indicators. The one-off full
// ≥250-session seed is scripts/backfill-us-history.mjs. Strictly CRON_SECRET
// gated; every run recorded to public.cron_logs.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
  const apiKey = process.env.FINANCIAL_API_KEY;
  if (!apiKey) {
    // Surface the misconfiguration AND record it, rather than silently skipping.
    await logCronRun(databaseUrl, {
      job: "backfill-us",
      status: "error",
      error: "FINANCIAL_API_KEY not configured",
      durationMs: Date.now() - t0,
    });
    return NextResponse.json({ ok: false, error: "FINANCIAL_API_KEY not configured" }, { status: 500 });
  }

  try {
    // Trailing ~15 sessions covers weekends/holidays/late corrections.
    const summary = await backfillUsHistory(databaseUrl, apiKey, { sessions: 15 });
    await logCronRun(databaseUrl, {
      job: "backfill-us",
      status: summary.failures.length ? "error" : "ok",
      error: summary.failures.length ? `${summary.failures.length} ticker failures` : null,
      detail: {
        tickersRequested: summary.tickersRequested,
        tickersFetched: summary.tickersFetched,
        barsUpserted: summary.barsUpserted,
        failures: summary.failures.slice(0, 25),
      },
      durationMs: summary.durationMs,
    });
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logCronRun(databaseUrl, {
      job: "backfill-us",
      status: "error",
      error: message,
      detail: { stack: err instanceof Error ? err.stack : undefined },
      durationMs: Date.now() - t0,
    });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
