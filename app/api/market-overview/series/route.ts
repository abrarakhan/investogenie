import { type NextRequest, NextResponse } from "next/server";
import { getSeriesForTickers } from "@/lib/marketOverview";
import type { MarketId } from "@/lib/types";

// Close-price history for arbitrary tickers, so the market-overview performance
// chart can swap in any symbol the user clicks from the gainer / decliner /
// fundamental-leader panels.
//
//   GET /api/market-overview/series?market=IN&tickers=RELIANCE,TCS
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const market: MarketId = params.get("market") === "US" ? "US" : "IN";
  const tickers = (params.get("tickers") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  if (!tickers.length) {
    return NextResponse.json({ series: [] });
  }

  try {
    const series = await getSeriesForTickers(market, tickers);
    return NextResponse.json({ series });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
