import { NextRequest, NextResponse } from "next/server";
import { getMobileSessionUser } from "@/lib/mobileAuth";
import { getSwingTradeLedger } from "@/lib/swingTradeLedger";
import { summarizeLedgerBooks } from "@/lib/swingTradeLedgerPython";
import { normalizeMarket } from "@/lib/markets";
import { createMobileTrade } from "@/lib/mobileLedgerMutations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getMobileSessionUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const market = normalizeMarket(request.nextUrl.searchParams.get("market") ?? "IN");
  if (!market) return NextResponse.json({ error: "market must be IN or US" }, { status: 400 });
  const trades = await getSwingTradeLedger(user.id, market);
  // Mobile consumes the server's figures; it must not recompute them on device.
  const [summary] = await summarizeLedgerBooks([trades]);
  return NextResponse.json({
    market,
    generatedAt: new Date().toISOString(),
    summary,
    trades,
  });
}

export async function POST(request: NextRequest) {
  const user = await getMobileSessionUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  try {
    const id = await createMobileTrade(user.id, body);
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Trade could not be recorded" }, { status: 400 });
  }
}
