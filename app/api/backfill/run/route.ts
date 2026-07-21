import { type NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { isBackfillRunning, populateBackfillQueue } from "@/lib/backfill/queue";
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
  if (await isBackfillRunning()) {
    const summary = { started: false, alreadyRunning: true, message: "backfill already in progress" };
    return NextResponse.json({ ok: false, error: summary.message, summary }, { status: 409 });
  }

  await populateBackfillQueue();
  const { spawn } = await import("node:child_process");
  const child = spawn(process.execPath, ["scripts/local-backfill-worker.mjs", job], {
    detached: true,
    env: process.env,
    stdio: "ignore",
  });
  child.unref();

  return NextResponse.json({
    ok: true,
    summary: { started: true, alreadyRunning: false, message: "backfill started in the background" },
  }, { status: 202 });
}
