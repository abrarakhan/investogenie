import type { BackfillCandidate, BackfillMarket } from "./types";

export function classifyBackfillTier(candidate: BackfillCandidate): number {
  if (candidate.market === "IN") return 1;
  if (candidate.market === "US" && (candidate.inSp500 || candidate.inNasdaq100)) return 2;
  if (candidate.inPortfolio || candidate.inWatchlist) return 3;
  if (candidate.hasActiveSignal || candidate.hasOpenForwardTest) return 4;
  return 6;
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "0";
  return {
    weekday: get("weekday"),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

function minutes(hour: number, minute: number): number {
  return hour * 60 + minute;
}

export function isMarketOpen(market: BackfillMarket, at = new Date()): boolean {
  const zone = market === "IN" ? "Asia/Kolkata" : "America/New_York";
  const local = zonedParts(at, zone);
  if (local.weekday === "Sat" || local.weekday === "Sun") return false;
  const now = minutes(local.hour, local.minute);
  if (market === "IN") return now >= minutes(9, 15) && now <= minutes(15, 30);
  return now >= minutes(9, 30) && now <= minutes(16, 0);
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
