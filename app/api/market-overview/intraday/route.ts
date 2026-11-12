import { type NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/apiGuards";
import { RATE_LIMITS } from "@/lib/rateLimit";
import { getIntradayBars } from "@/lib/intradayBars";

// Stored one-minute candles for an India stock's most recent sessions.
//   GET /api/market-overview/intraday?ticker=RELIANCE&exchange=NSE&sessions=1
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const guard = await requireApiUser(["market-data", RATE_LIMITS.marketData]);
  if (guard.response) return guard.response;
  const params = request.nextUrl.searchParams;
  const ticker = (params.get("ticker") ?? "").trim();
  if (!ticker) return NextResponse.json({ series: null });
  try {
    const series = await getIntradayBars(ticker, params.get("exchange"), Number(params.get("sessions") ?? 1));
    return NextResponse.json({ series });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
