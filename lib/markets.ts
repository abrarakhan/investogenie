import type { MarketConfig, MarketId } from "./types";

// Curated market configuration powering the Sovereign Pivot Switch. Each market
// carries its own accent theme, macro benchmarks, and ticker feed so toggling
// re-renders every feed from context with zero network round-trips. The tickers
// mirror the rows seeded in supabase/migrations/0002_multi_asset.sql.

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
      { ticker: "SPX", name: "S&P 500", last: 5431.6, changePct: 0.62, currency: "USD" },
      { ticker: "IXIC", name: "Nasdaq", last: 17688.9, changePct: 0.88, currency: "USD" },
      { ticker: "US10Y", name: "US 10Y Yield", last: 4.32, changePct: -0.4, currency: "USD" },
    ],
    tickers: [
      { ticker: "AAPL", name: "Apple Inc.", last: 213.07, changePct: 1.21, currency: "USD" },
      { ticker: "MSFT", name: "Microsoft", last: 441.58, changePct: 0.74, currency: "USD" },
      { ticker: "NVDA", name: "NVIDIA", last: 131.88, changePct: 2.93, currency: "USD" },
      { ticker: "SPY", name: "SPDR S&P 500", last: 542.4, changePct: 0.61, currency: "USD" },
      { ticker: "BRENT", name: "Brent Crude", last: 79.1, changePct: -0.55, currency: "USD" },
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
      { ticker: "NIFTY", name: "Nifty 50", last: 23501.1, changePct: 0.51, currency: "INR" },
      { ticker: "SENSEX", name: "Sensex", last: 77209.9, changePct: 0.44, currency: "INR" },
      { ticker: "USDINR", name: "USD/INR", last: 83.45, changePct: 0.08, currency: "INR" },
    ],
    tickers: [
      { ticker: "RELIANCE", name: "Reliance", last: 2945.2, changePct: 1.04, currency: "INR" },
      { ticker: "TCS", name: "Tata Consultancy", last: 3870.4, changePct: 0.63, currency: "INR" },
      { ticker: "INFY", name: "Infosys", last: 1521.7, changePct: -0.32, currency: "INR" },
      { ticker: "NIFTYFUT", name: "Nifty Fut", last: 23560.0, changePct: 0.49, currency: "INR" },
      { ticker: "HDFCBANK", name: "HDFC Bank", last: 1678.9, changePct: 0.27, currency: "INR" },
    ],
  },
};

export const DEFAULT_MARKET: MarketId = "US";

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

/** Latest indicative price for a ticker across either market, or null. */
export function lastPriceFor(ticker: string): number | null {
  for (const cfg of Object.values(MARKETS)) {
    const q = [...cfg.tickers, ...cfg.benchmarks].find((t) => t.ticker === ticker);
    if (q) return q.last;
  }
  return null;
}

/** Currency-aware money formatter independent of the active market. */
export function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}
