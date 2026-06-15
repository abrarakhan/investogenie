import { type NextRequest, NextResponse } from "next/server";
import { refreshQuotes } from "@/lib/ingest/quotes";
import { checkCronAuth, logCronRun } from "@/lib/ingest/cronLog";

// Scheduled latest-price refresh. Wired to a daily cron (see vercel.json).
// Strictly gated by CRON_SECRET so only the scheduler (or an authorized caller)
// can trigger the ~12k-row ingestion. Runs on the Node runtime (uses `pg` +
// fetch). Every run — success or failure — is recorded to public.cron_logs.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const t0 = Date.now();

  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
  const auth = checkCronAuth(request.headers.get("authorization"), process.env.CRON_SECRET);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.reason }, { status: auth.status });
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return NextResponse.json({ ok: false, error: "DATABASE_URL not configured" }, { status: 500 });
  }

  try {
    const summary = await refreshQuotes(databaseUrl);
    await logCronRun(databaseUrl, {
      job: "refresh-quotes",
      status: "ok",
      detail: { matched: summary.matched, bySource: summary.bySource },
      durationMs: summary.durationMs,
    });
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    // Network dropouts, bhavcopy schema drift, DB errors — record, don't vanish.
    const message = err instanceof Error ? err.message : String(err);
    await logCronRun(databaseUrl, {
      job: "refresh-quotes",
      status: "error",
      error: message,
      detail: { stack: err instanceof Error ? err.stack : undefined },
      durationMs: Date.now() - t0,
    });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
