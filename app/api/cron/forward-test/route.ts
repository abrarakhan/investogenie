import { type NextRequest, NextResponse } from "next/server";
import { enrollCohort, evaluateOpenPositions } from "@/lib/forwardTest";
import { checkCronAuth, logCronRun } from "@/lib/ingest/cronLog";
import type { MarketId } from "@/lib/types";

// Forward testing driver.
//   ?action=enroll&market=IN   -> freeze a new cohort (2 per method)
//   ?action=evaluate           -> grade every OPEN position against new bars
//
// Enrollment is a weekly-ish cadence; evaluation should run daily, after the
// OHLC sync, so touches are graded against fresh bars.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const t0 = Date.now();
  const auth = checkCronAuth(request.headers.get("authorization"), process.env.CRON_SECRET);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.reason }, { status: auth.status });

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return NextResponse.json({ ok: false, error: "DATABASE_URL not configured" }, { status: 500 });

  const action = request.nextUrl.searchParams.get("action") ?? "evaluate";
  const marketParam = request.nextUrl.searchParams.get("market");
  const market: MarketId = marketParam === "US" ? "US" : "IN";

  try {
    const result = action === "enroll"
      ? await enrollCohort(market)
      : await evaluateOpenPositions();
    await logCronRun(databaseUrl, {
      job: "forward-test",
      status: "ok",
      detail: { action, market, ...result },
      durationMs: Date.now() - t0,
    });
    return NextResponse.json({ ok: true, action, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logCronRun(databaseUrl, {
      job: "forward-test", status: "error", error: message, durationMs: Date.now() - t0,
    });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
