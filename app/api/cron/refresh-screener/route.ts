import { type NextRequest, NextResponse } from "next/server";
import { refreshStockSnapshot } from "@/lib/screener/snapshot";
import { checkCronAuth, logCronRun } from "@/lib/ingest/cronLog";

// Scheduled rebuild of the screener snapshot (public.stock_snapshot). Intended
// cadence: every 15 min during IST market hours (9:15–15:30 Mon–Fri) — configure
// the schedule in the platform cron / vercel.json. Strictly CRON_SECRET-gated.
// Optional ?market=US|IN rebuilds a single market; default rebuilds both.
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

  const marketParam = request.nextUrl.searchParams.get("market");
  const market = marketParam === "US" || marketParam === "IN" ? marketParam : undefined;

  try {
    const { count, durationMs } = await refreshStockSnapshot(market);
    await logCronRun(databaseUrl, {
      job: "refresh-screener",
      status: "ok",
      detail: { market: market ?? "ALL", rows: count },
      durationMs,
    });
    return NextResponse.json({ ok: true, market: market ?? "ALL", rows: count, durationMs });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logCronRun(databaseUrl, {
      job: "refresh-screener",
      status: "error",
      error: message,
      durationMs: Date.now() - t0,
    });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
