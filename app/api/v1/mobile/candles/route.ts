import { NextRequest, NextResponse } from "next/server";
import { getMobileSessionUser } from "@/lib/mobileAuth";
import { getCandlesForTicker } from "@/lib/marketOverview";
import { normalizeMarket } from "@/lib/markets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getMobileSessionUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const market = normalizeMarket(request.nextUrl.searchParams.get("market") ?? "IN");
  const ticker = (request.nextUrl.searchParams.get("ticker") ?? "").trim().toUpperCase();
  const requestedDays = Number(request.nextUrl.searchParams.get("days") ?? 90);
  const days = Number.isFinite(requestedDays) ? Math.min(260, Math.max(20, requestedDays)) : 90;
  if (!market || !ticker) return NextResponse.json({ error: "market and ticker are required" }, { status: 400 });
  const candle = await getCandlesForTicker(market, ticker, days);
  return NextResponse.json({ candle });
}
