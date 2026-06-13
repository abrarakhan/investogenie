import { type NextRequest, NextResponse } from "next/server";
import { refreshQuotes } from "@/lib/ingest/quotes";

// Scheduled latest-price refresh. Wired to a daily cron (see vercel.json).
// Protected by CRON_SECRET so only the scheduler (or an authorized caller) can
// trigger the ~12k-row ingestion. Runs on the Node runtime (uses `pg` + fetch).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 500 });
  }

  try {
    const summary = await refreshQuotes(databaseUrl);
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
