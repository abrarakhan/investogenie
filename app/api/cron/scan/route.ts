import { type NextRequest, NextResponse } from "next/server";
import { computeSignals } from "@/lib/ingest/signals";
import { checkCronAuth, logCronRun } from "@/lib/ingest/cronLog";

// Scheduled swing scan over the whole universe → swing_signals (read by the
// screener). Strictly gated by CRON_SECRET. Node runtime (uses `pg`). Every run
// is recorded to public.cron_logs.
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
    const summary = await computeSignals(databaseUrl);
    await logCronRun(databaseUrl, {
      job: "scan",
      status: "ok",
      detail: { scanned: summary.scanned, setups: summary.setups },
      durationMs: summary.durationMs,
    });
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logCronRun(databaseUrl, {
      job: "scan",
      status: "error",
      error: message,
      detail: { stack: err instanceof Error ? err.stack : undefined },
      durationMs: Date.now() - t0,
    });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
