import { NextRequest, NextResponse } from "next/server";
import { getMobileSessionUser } from "@/lib/mobileAuth";
import { updateMobileTradeSale } from "@/lib/mobileLedgerMutations";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, context: { params: Promise<{ tradeId: string; saleId: string }> }) {
  const user = await getMobileSessionUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  try {
    const { tradeId, saleId } = await context.params;
    await updateMobileTradeSale(user.id, tradeId, saleId, body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sale could not be updated" }, { status: 400 });
  }
}
