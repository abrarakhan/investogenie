import { NextRequest, NextResponse } from "next/server";
import { aggregateIntradayBars } from "@/lib/intradayAggregate";
import { getIntradayBars } from "@/lib/intradayBars";
import { normalizeMarket } from "@/lib/markets";
import { getMobileSessionUser } from "@/lib/mobileAuth";
import { mobileJson } from "@/lib/mobileHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getMobileSessionUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const market = normalizeMarket(params.get("market") ?? "IN");
  const ticker = (params.get("ticker") ?? "").trim().toUpperCase();
  if (!market || !ticker) {
    return NextResponse.json({ error: "market and ticker are required" }, { status: 400 });
  }
  if (market !== "IN") {
    return mobileJson(request, { series: null });
  }

  const range = params.get("range") === "5D" ? "5D" : "1D";
  const sessions = range === "5D" ? 5 : 1;
  const interval = range === "5D" ? 15 : 5;
  const raw = await getIntradayBars(ticker, params.get("exchange"), sessions);
  if (!raw || !raw.bars.length) {
    return mobileJson(request, { series: null });
  }
  const bars = aggregateIntradayBars(raw.bars, interval);
  return mobileJson(request, {
    series: {
      ticker: raw.ticker,
      exchange: raw.exchange,
      provisional: raw.provisional,
      intervalMinutes: interval,
      bars,
    },
  });
}
