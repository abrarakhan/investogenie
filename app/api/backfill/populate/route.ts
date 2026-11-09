import { NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/apiGuards";
import { populateBackfillQueue } from "@/lib/backfill/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const guard = await requireApiAdmin();
  if (guard.response) return guard.response;
  const summary = await populateBackfillQueue();
  return NextResponse.json({ ok: true, summary });
}
