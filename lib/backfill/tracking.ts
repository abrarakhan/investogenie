export const TRACKABLE_US_EXCHANGES = ["NASDAQ", "NYSE", "AMEX", "NYSEARCA", "NYSEAMERICAN"] as const;

/** Exchange suffixes used for warrants and rights, not ordinary shares. */
export function isStructurallyUnsupportedTicker(symbol: string, market: "IN" | "US"): boolean {
  const ticker = symbol.trim().toUpperCase();
  if (market === "IN") return /-RE\d*$/.test(ticker);
  return /-[WR][A-Z]*$/.test(ticker) || (/^[A-Z0-9]{4,}[WR]$/.test(ticker));
}

export function isDefinitiveNoHistoryError(error: string): boolean {
  const message = error.toLowerCase();
  return [
    "no ohlcv bars returned",
    "no price data found",
    "no financial data found",
    "possibly delisted",
    "quote not found",
    "404 not found",
  ].some((needle) => message.includes(needle));
}

export interface RetirementEligibility {
  attemptsAfterFailure: number;
  maxAttempts: number;
  error: string;
  protectedAsset: boolean;
  hasRecentQuote: boolean;
}

export function shouldRetireAfterFailure(input: RetirementEligibility): boolean {
  return !input.protectedAsset
    && !input.hasRecentQuote
    && input.attemptsAfterFailure >= input.maxAttempts
    && isDefinitiveNoHistoryError(input.error);
}
