import { NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/apiGuards";
import { getBackfillStatusSummary } from "@/lib/backfill/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireApiAdmin();
  if (guard.response) return guard.response;
  const status = await getBackfillStatusSummary();
  return NextResponse.json({ ok: true, status });
}
