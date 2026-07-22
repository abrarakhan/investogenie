import { type NextRequest, NextResponse } from "next/server";
import { getCandlesForTicker } from "@/lib/marketOverview";
import type { MarketId } from "@/lib/types";

// OHLCV history for the market overview candle chart.
//   GET /api/market-overview/candles?market=IN&ticker=RELIANCE&days=260
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const market: MarketId = params.get("market") === "US" ? "US" : "IN";
  const ticker = (params.get("ticker") ?? "").trim();
  const days = Number(params.get("days") ?? 260);

  if (!ticker) {
    return NextResponse.json({ candle: null });
  }

  try {
    const candle = await getCandlesForTicker(market, ticker, Number.isFinite(days) ? days : 260);
    return NextResponse.json({ candle });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
