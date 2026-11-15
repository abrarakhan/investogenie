import { NextRequest, NextResponse } from "next/server";
import { getMobileSessionUser } from "@/lib/mobileAuth";
import { updateMobileTradeSale } from "@/lib/mobileLedgerMutations";
import { runIdempotentMobileMutation } from "@/lib/mobileMutationResponse";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, context: { params: Promise<{ tradeId: string; saleId: string }> }) {
  const user = await getMobileSessionUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const { tradeId, saleId } = await context.params;
  return runIdempotentMobileMutation(request, user.id, `UPDATE_SALE:${tradeId}:${saleId}`, body, async () => {
    await updateMobileTradeSale(user.id, tradeId, saleId, body);
    return { body: { ok: true } };
  });
}
