import { type NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { startAndLogBackfillBatch } from "@/lib/backfill/worker";
import { checkCronAuth } from "@/lib/ingest/cronLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  const cron = checkCronAuth(request.headers.get("authorization"), process.env.CRON_SECRET);
  if (!user && !cron.ok) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return NextResponse.json({ ok: false, error: "DATABASE_URL not configured" }, { status: 500 });
  const job = request.nextUrl.searchParams.get("job") === "cron" ? "backfill_ohlcv_cron" : "backfill_ohlcv";
  const summary = await startAndLogBackfillBatch(databaseUrl, { populateFirst: true }, job);
  if (summary.alreadyRunning) return NextResponse.json({ ok: false, error: summary.message, summary }, { status: 409 });
  return NextResponse.json({ ok: true, summary }, { status: 202 });
}
