import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { requeueFailedBackfillItems } from "@/lib/backfill/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const count = await requeueFailedBackfillItems();
  return NextResponse.json({ ok: true, count });
}
