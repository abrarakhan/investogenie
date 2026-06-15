// Shared domain types for InvestoGenie. These mirror the Supabase schema in
// supabase/migrations and are reused by the analytical engines and UI so the
// data contract is identical from database -> engine -> screen.

export type AssetClass =
  | "STOCK"
  | "BOND"
  | "MUTUAL_FUND"
  | "CURRENCY"
  | "DERIVATIVE";

export type PlanType = "DIRECT" | "REGULAR";
export type MarketId = "US" | "IN";
export type CurrencyCode = "USD" | "INR";

export interface Asset {
  id: string;
  ticker: string;
  name: string | null;
  assetClass: AssetClass;
  exchange: string | null;
  country: string;
  currency: CurrencyCode;
}

/** A single end-of-day bar. open_interest is present only for derivatives. */
export interface OHLCV {
  date: string; // ISO yyyy-mm-dd
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  openInterest?: number | null;
}

export type ReportType = "QUARTERLY" | "ANNUAL" | "TTM";

/** One corporate fundamentals report period (monetary fields in Rs. Crore). */
export interface AssetFinancialReport {
  assetId: string;
  periodEndDate: string; // ISO yyyy-mm-dd
  reportType: ReportType;
  fiscalPeriod?: string | null;
  currency: string;
  revenue: number | null;
  netProfit: number | null;
  operatingProfit: number | null;
  ebit: number | null;
  capitalEmployed: number | null;
  eps: number | null;
  cmp: number | null;
  peRatio: number | null;
  marketCap: number | null; // Rs. Cr
  roce: number | null; // %
  profitVarianceYoY: number | null; // %
  salesVarianceYoY: number | null; // %
  source?: string | null;
}

/** Compact latest-quarter snapshot the screener joins onto each row. */
export interface FinancialSnapshot {
  periodEndDate: string;
  fiscalPeriod: string | null;
  peRatio: number | null;
  marketCap: number | null;
  roce: number | null;
  profitVarianceYoY: number | null;
  salesVarianceYoY: number | null;
  revenue: number | null;
  netProfit: number | null;
}

export interface MacroPoint {
  indicatorType: string;
  date: string;
  value: number;
  unit?: string | null;
}

/** A row of a user's parsed CAMS/holding statement. */
export interface UserFundHolding {
  fundTicker: string;
  fundName?: string;
  amfiCode?: string;
  units: number;
  navValue: number; // current NAV in fund currency
  planType?: PlanType;
}

/** Look-through: a fund's underlying stock weight (0-100). */
export interface FundStockWeight {
  fundTicker: string;
  stockTicker: string;
  weightPercentage: number;
}

// ---- Landing-page presentation types -------------------------------------

export interface TickerQuote {
  ticker: string;
  name: string;
  last: number;
  changePct: number;
  currency: CurrencyCode;
}

export interface MarketTheme {
  /** Tailwind-independent raw values pushed into CSS custom properties. */
  primary: string;
  accent: string;
  glow: string;
}

export interface MarketConfig {
  id: MarketId;
  label: string;
  flag: string;
  currency: CurrencyCode;
  locale: string;
  theme: MarketTheme;
  benchmarks: TickerQuote[];
  tickers: TickerQuote[];
}
