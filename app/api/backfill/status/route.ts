import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getBackfillStatusSummary } from "@/lib/backfill/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const status = await getBackfillStatusSummary();
  return NextResponse.json({ ok: true, status });
}
