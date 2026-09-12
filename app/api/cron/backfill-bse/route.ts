import { type NextRequest, NextResponse } from "next/server";
import { backfillBseHistory } from "@/lib/ingest/nseHistory";
import { checkCronAuth, logCronRun } from "@/lib/ingest/cronLog";

// Incremental BSE daily-EOD top-up from the official BSE UDiFF bhavcopy.
// This is the primary BSE history path; Yahoo/Google repair remains available
// through the queued backfill worker for symbols/dates not covered here.
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
    const startISO = request.nextUrl.searchParams.get("startISO") ?? undefined;
    const endISO = request.nextUrl.searchParams.get("endISO") ?? undefined;
    const isoDate = /^\d{4}-\d{2}-\d{2}$/;
    if ((startISO && !isoDate.test(startISO)) || (endISO && !isoDate.test(endISO))) {
      return NextResponse.json({ ok: false, error: "startISO and endISO must use YYYY-MM-DD" }, { status: 400 });
    }
    const summary = await backfillBseHistory(databaseUrl, {
      maxSessions: Number.isFinite(maxSessions) ? Math.min(60, Math.max(1, maxSessions)) : 20,
      startISO,
      endISO,
    });
    await logCronRun(databaseUrl, {
      job: "backfill-bse",
      status: "ok",
      detail: {
        latestDateBefore: summary.latestDateBefore,
        latestDateAfter: summary.latestDateAfter,
        datesAttempted: summary.datesAttempted,
        sessionsFetched: summary.sessionsFetched,
        barsUpserted: summary.barsUpserted,
        bseAssets: summary.bseAssets ?? summary.assets,
        skipped: summary.skipped,
      },
      durationMs: summary.durationMs,
    });
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logCronRun(databaseUrl, {
      job: "backfill-bse",
      status: "error",
      error: message,
      detail: { stack: err instanceof Error ? err.stack : undefined },
      durationMs: Date.now() - t0,
    });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
