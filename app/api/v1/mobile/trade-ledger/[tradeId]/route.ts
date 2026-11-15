import { NextRequest, NextResponse } from "next/server";
import { getMobileSessionUser } from "@/lib/mobileAuth";
import { deleteMobileTrade, updateMobileTrade } from "@/lib/mobileLedgerMutations";
import { runIdempotentMobileMutation } from "@/lib/mobileMutationResponse";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, context: { params: Promise<{ tradeId: string }> }) {
  const user = await getMobileSessionUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const { tradeId } = await context.params;
  return runIdempotentMobileMutation(request, user.id, `UPDATE_TRADE:${tradeId}`, body, async () => {
    await updateMobileTrade(user.id, tradeId, body);
    return { body: { ok: true } };
  });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ tradeId: string }> }) {
  const user = await getMobileSessionUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { tradeId } = await context.params;
  return runIdempotentMobileMutation(request, user.id, `DELETE_TRADE:${tradeId}`, null, async () => {
    await deleteMobileTrade(user.id, tradeId);
    return { body: { ok: true } };
  });
}
