export type CalendarMarket = "IN" | "US";

export interface MarketClock {
  date: string;
  day: number;
  minutes: number;
}

export function zonedMarketClock(market: CalendarMarket, at?: Date): MarketClock;
export function isTradingDay(market: CalendarMarket, dateIso: string): boolean;
export function previousTradingDay(market: CalendarMarket, dateIso: string): string;
export function latestExpectedSessionDate(market: CalendarMarket, at?: Date, publicationMinutes?: number): string;
export function tradingSessionLag(market: CalendarMarket, observedDate: string | null | undefined, expectedDate: string): number;
export function isMarketOpenNow(market: CalendarMarket, at?: Date): boolean;
export function isMarketHoliday(market: CalendarMarket, at?: Date): boolean;
export function refreshMarketHolidays(market?: CalendarMarket, force?: boolean): Promise<boolean>;
