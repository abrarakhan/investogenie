import { NextRequest, NextResponse } from "next/server";
import { getMobileSessionUser } from "@/lib/mobileAuth";
import { recordMobileTradeSale } from "@/lib/mobileLedgerMutations";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ tradeId: string }> }) {
  const user = await getMobileSessionUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  try {
    await recordMobileTradeSale(user.id, (await context.params).tradeId, body);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sale could not be recorded" }, { status: 400 });
  }
}
