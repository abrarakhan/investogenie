import type { BackfillCandidate, BackfillMarket } from "./types";
import { isStructurallyUnsupportedTicker } from "./tracking";
import { isMarketOpenNow } from "../market-calendar.mjs";

export function classifyBackfillTier(candidate: BackfillCandidate): number {
  if (candidate.market === "IN") return 1;
  if (candidate.market === "US" && (candidate.inSp500 || candidate.inNasdaq100)) return 2;
  if (candidate.inPortfolio || candidate.inWatchlist) return 3;
  if (candidate.hasActiveSignal || candidate.hasOpenForwardTest) return 4;
  return 6;
}

export function shouldTrackBackfillCandidate(candidate: BackfillCandidate): boolean {
  return !isStructurallyUnsupportedTicker(candidate.symbol, candidate.market);
}

export function isMarketOpen(market: BackfillMarket, at = new Date()): boolean {
  return isMarketOpenNow(market, at);
}

export function shouldSkipMarketForBackfill({
  market,
  skipDuringMarketHours,
  at = new Date(),
}: {
  market: BackfillMarket;
  skipDuringMarketHours: boolean;
  at?: Date;
}) {
  return skipDuringMarketHours && isMarketOpen(market, at);
}
