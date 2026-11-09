import { NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/apiGuards";
import { requeueFailedBackfillItems } from "@/lib/backfill/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const guard = await requireApiAdmin();
  if (guard.response) return guard.response;
  const count = await requeueFailedBackfillItems();
  return NextResponse.json({ ok: true, count });
}
