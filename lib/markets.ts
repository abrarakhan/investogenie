import type { MarketConfig, MarketId } from "./types";

// Curated market configuration powering the Sovereign Pivot Switch. Each market
// carries its own accent theme and instrument metadata. Prices are deliberately
// absent: every displayed quote comes from latest_quotes.

export const MARKETS: Record<MarketId, MarketConfig> = {
  US: {
    id: "US",
    label: "US Market",
    flag: "🇺🇸",
    currency: "USD",
    locale: "en-US",
    theme: {
      primary: "#3b82f6", // sovereign blue
      accent: "#22d3ee",
      glow: "rgba(59,130,246,0.45)",
    },
    benchmarks: [
      { ticker: "SPX", name: "S&P 500", currency: "USD" },
      { ticker: "IXIC", name: "Nasdaq", currency: "USD" },
      { ticker: "US10Y", name: "US 10Y Yield", currency: "USD" },
    ],
    tickers: [
      { ticker: "AAPL", name: "Apple Inc.", currency: "USD" },
      { ticker: "MSFT", name: "Microsoft", currency: "USD" },
      { ticker: "NVDA", name: "NVIDIA", currency: "USD" },
      { ticker: "SPY", name: "SPDR S&P 500", currency: "USD" },
      { ticker: "BRENT", name: "Brent Crude", currency: "USD" },
    ],
  },
  IN: {
    id: "IN",
    label: "India Market",
    flag: "🇮🇳",
    currency: "INR",
    locale: "en-IN",
    theme: {
      primary: "#f59e0b", // saffron-gold
      accent: "#34d399",
      glow: "rgba(245,158,11,0.45)",
    },
    benchmarks: [
      { ticker: "NIFTY", name: "Nifty 50", currency: "INR" },
      { ticker: "SENSEX", name: "Sensex", currency: "INR" },
      { ticker: "USDINR", name: "USD/INR", currency: "INR" },
    ],
    tickers: [
      { ticker: "RELIANCE", name: "Reliance", currency: "INR" },
      { ticker: "TCS", name: "Tata Consultancy", currency: "INR" },
      { ticker: "INFY", name: "Infosys", currency: "INR" },
      { ticker: "NIFTYFUT", name: "Nifty Fut", currency: "INR" },
      { ticker: "HDFCBANK", name: "HDFC Bank", currency: "INR" },
    ],
  },
};

export const DEFAULT_MARKET: MarketId = "US";

/** The opposite market — used by the terminal switcher. */
export const OTHER_MARKET: Record<MarketId, MarketId> = { US: "IN", IN: "US" };

/** Validate/normalize a route param ("us"/"in") into a MarketId, or null. */
export function normalizeMarket(param: string | undefined): MarketId | null {
  if (!param) return null;
  const p = param.toUpperCase();
  return p === "US" || p === "IN" ? (p as MarketId) : null;
}

/** ISO country code backing each market (matches assets.country). */
export const MARKET_COUNTRY: Record<MarketId, string> = { US: "US", IN: "IN" };

/** Locale + currency aware formatter used across the ticker feeds. */
export function formatPrice(value: number, market: MarketId): string {
  const cfg = MARKETS[market];
  return new Intl.NumberFormat(cfg.locale, {
    style: "currency",
    currency: cfg.currency,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatPct(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

/** Currency-aware money formatter independent of the active market. */
export function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}
