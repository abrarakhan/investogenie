import { NextRequest, NextResponse } from "next/server";
import { getMobileSessionUser } from "@/lib/mobileAuth";
import { recordMobileTradeSale } from "@/lib/mobileLedgerMutations";
import { runIdempotentMobileMutation } from "@/lib/mobileMutationResponse";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ tradeId: string }> }) {
  const user = await getMobileSessionUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const { tradeId } = await context.params;
  return runIdempotentMobileMutation(request, user.id, `CREATE_SALE:${tradeId}`, body, async () => {
    await recordMobileTradeSale(user.id, tradeId, body);
    return { status: 201, body: { ok: true } };
  });
}
