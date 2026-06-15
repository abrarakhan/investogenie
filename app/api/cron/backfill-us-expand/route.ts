import { type NextRequest, NextResponse } from "next/server";
import { Client } from "pg";
import { backfillUsHistory } from "@/lib/ingest/usHistory";
import { checkCronAuth, logCronRun } from "@/lib/ingest/cronLog";

// Incremental US-history coverage job — walks the *entire* US equity universe a
// rate-limit-sized slice at a time, pulling full history only for tickers not yet
// covered, and never re-pulling. Designed to run hourly; the per-run batch and a
// monthly unique-symbol guard keep it inside the Tiingo free tier:
//   • ≤ ~50 unique symbols / hour   -> HOURLY_BATCH (45)
//   • ≤ ~500 unique symbols / month -> MONTHLY_UNIQUE_CAP (480, with headroom)
// Once the monthly budget is exhausted the job idles until the next calendar
// month. Daily freshness for already-covered names is handled by /backfill-us.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const HOURLY_BATCH = 45;
const MONTHLY_UNIQUE_CAP = 480;

/** Sum of unique tickers this expansion job has pulled in the current month. */
async function uniquesThisMonth(databaseUrl: string): Promise<number> {
  const client = new Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const { rows } = await client.query<{ used: string }>(
      `select coalesce(sum((detail->>'tickersFetched')::int), 0) used
         from public.cron_logs
        where job = 'backfill-us-expand'
          and created_at >= date_trunc('month', now())`,
    );
    return Number(rows[0]?.used ?? 0);
  } finally {
    await client.end();
  }
}

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
    await logCronRun(databaseUrl, {
      job: "backfill-us-expand",
      status: "error",
      error: "FINANCIAL_API_KEY not configured",
      durationMs: Date.now() - t0,
    });
    return NextResponse.json({ ok: false, error: "FINANCIAL_API_KEY not configured" }, { status: 500 });
  }

  try {
    // Respect the monthly unique-symbol budget before pulling anything new.
    const used = await uniquesThisMonth(databaseUrl);
    const remaining = MONTHLY_UNIQUE_CAP - used;
    const batch = Math.min(HOURLY_BATCH, Math.max(0, remaining));

    if (batch <= 0) {
      await logCronRun(databaseUrl, {
        job: "backfill-us-expand",
        status: "ok",
        detail: { skipped: "monthly unique-symbol cap reached", used, cap: MONTHLY_UNIQUE_CAP, tickersFetched: 0 },
        durationMs: Date.now() - t0,
      });
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "monthly unique-symbol cap reached",
        used,
        cap: MONTHLY_UNIQUE_CAP,
      });
    }

    const summary = await backfillUsHistory(databaseUrl, apiKey, {
      onlyMissing: true,
      batch,
      sessions: 280,
    });

    // Per-ticker 404s (delisted names) are expected on a universe walk — only the
    // whole batch failing (0 fetched) is a real error worth flagging.
    const hardFail = summary.tickersRequested > 0 && summary.tickersFetched === 0;
    await logCronRun(databaseUrl, {
      job: "backfill-us-expand",
      status: hardFail ? "error" : "ok",
      error: hardFail
        ? "no tickers fetched (auth/rate-limit/network?)"
        : summary.failures.length
          ? `${summary.failures.length} ticker(s) skipped (e.g. delisted/404)`
          : null,
      detail: {
        tickersRequested: summary.tickersRequested,
        tickersFetched: summary.tickersFetched,
        barsUpserted: summary.barsUpserted,
        remainingMissing: summary.remainingMissing,
        monthlyUsedBefore: used,
        monthlyCap: MONTHLY_UNIQUE_CAP,
        failures: summary.failures.slice(0, 25),
      },
      durationMs: summary.durationMs,
    });
    return NextResponse.json({ ok: true, monthlyUsedBefore: used, monthlyCap: MONTHLY_UNIQUE_CAP, ...summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logCronRun(databaseUrl, {
      job: "backfill-us-expand",
      status: "error",
      error: message,
      detail: { stack: err instanceof Error ? err.stack : undefined },
      durationMs: Date.now() - t0,
    });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
