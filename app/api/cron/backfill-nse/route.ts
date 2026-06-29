import { type NextRequest, NextResponse } from "next/server";
import { backfillNseHistory } from "@/lib/ingest/nseHistory";
import { checkCronAuth, logCronRun } from "@/lib/ingest/cronLog";

// Incremental NSE daily-EOD top-up. After a one-off historical CSV import, this
// job keeps all NSE stock OHLCV current by fetching only missing bhavcopy dates
// after the latest stored NSE bar. Re-runs are safe: rows upsert on
// (asset_id,date), so exchange corrections overwrite old values.
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

  try {
    const maxSessions = Number(request.nextUrl.searchParams.get("maxSessions") ?? 20);
    const summary = await backfillNseHistory(databaseUrl, {
      maxSessions: Number.isFinite(maxSessions) ? Math.min(60, Math.max(1, maxSessions)) : 20,
    });
    await logCronRun(databaseUrl, {
      job: "backfill-nse",
      status: "ok",
      detail: {
        latestDateBefore: summary.latestDateBefore,
        latestDateAfter: summary.latestDateAfter,
        datesAttempted: summary.datesAttempted,
        sessionsFetched: summary.sessionsFetched,
        barsUpserted: summary.barsUpserted,
        nseAssets: summary.nseAssets,
        skipped: summary.skipped,
      },
      durationMs: summary.durationMs,
    });
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logCronRun(databaseUrl, {
      job: "backfill-nse",
      status: "error",
      error: message,
      detail: { stack: err instanceof Error ? err.stack : undefined },
      durationMs: Date.now() - t0,
    });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
