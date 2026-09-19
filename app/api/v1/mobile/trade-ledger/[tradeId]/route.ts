import { NextRequest, NextResponse } from "next/server";
import { getMobileSessionUser } from "@/lib/mobileAuth";
import { deleteMobileTrade, updateMobileTrade } from "@/lib/mobileLedgerMutations";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, context: { params: Promise<{ tradeId: string }> }) {
  const user = await getMobileSessionUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  try {
    await updateMobileTrade(user.id, (await context.params).tradeId, body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Trade could not be updated" }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ tradeId: string }> }) {
  const user = await getMobileSessionUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await deleteMobileTrade(user.id, (await context.params).tradeId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Trade could not be deleted" }, { status: 400 });
  }
}
