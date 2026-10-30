import { isMarketOpenNow } from "@/lib/market-calendar.mjs";

/**
 * Live refreshes are only valid while the selected market's regular cash
 * session is open. The shared calendar applies each exchange timezone,
 * weekends, holidays and US daylight-saving changes.
 */
export function shouldRefreshLiveQuotes(market: "IN" | "US", at = new Date()): boolean {
  return isMarketOpenNow(market, at);
}
