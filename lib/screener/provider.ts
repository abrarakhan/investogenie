// DataProvider seam + field provenance.
//
// The screener reads from one materialised table (stock_snapshot), but the
// fields in it come from several sources with different reliability. This module
// makes that provenance explicit so the UI can badge a field's origin and the
// README can be generated from a single source of truth. It also defines the
// FundamentalsProvider interface that the ingestion layer implements — today the
// yfinance pipelines (pipelines/stock_fundamentals_sync.py, us_market_sync.py);
// swapping in a paid vendor (e.g. Financial Modeling Prep) means writing one more
// implementation, not touching the screener.

export type Provenance = "derived" | "quote" | "yfinance" | "todo";

export interface FieldProvenance {
  field: string;
  source: Provenance;
  /** Where the value ultimately comes from, human-readable. */
  note: string;
}

// derived  = computed here from OHLC history (always available where bars exist)
// quote    = live/EOD quote feed (latest_quotes)
// yfinance = company fundamentals from Yahoo Finance via the sync pipelines
// todo     = not yet wired to a production source for a given market
export const FIELD_PROVENANCE: FieldProvenance[] = [
  { field: "ltp", source: "quote", note: "latest_quotes (EOD/live), falls back to last OHLC close" },
  { field: "change_pct_1d", source: "quote", note: "latest_quotes change %, falls back to close-vs-prev-close" },
  { field: "volume", source: "derived", note: "latest daily_ohlcv bar" },
  { field: "trade_value", source: "derived", note: "ltp × volume" },
  { field: "high_52w", source: "derived", note: "max(high) over trailing 1y of daily_ohlcv" },
  { field: "low_52w", source: "derived", note: "min(low) over trailing 1y of daily_ohlcv" },
  { field: "pct_from_52w_high", source: "derived", note: "computed from ltp and 52w high" },
  { field: "pct_from_52w_low", source: "derived", note: "computed from ltp and 52w low" },
  { field: "gap_pct", source: "derived", note: "(open − prev close) / prev close" },
  { field: "intraday_vol_pct", source: "derived", note: "(high − low) / prev close" },
  { field: "market_cap", source: "yfinance", note: "yfinance .info marketCap (Rs. Cr / USD mn)" },
  { field: "mcap_rank", source: "derived", note: "rank of market_cap within the market (SEBI cap bands)" },
  { field: "pe_ratio", source: "yfinance", note: "yfinance trailing P/E" },
  { field: "roe", source: "yfinance", note: "yfinance .info returnOnEquity" },
  { field: "roce", source: "yfinance", note: "derived from EBIT / capital employed in the reports pipeline" },
  { field: "debt_to_equity", source: "yfinance", note: "yfinance .info debtToEquity (÷100 → ratio)" },
  { field: "dividend_yield", source: "yfinance", note: "yfinance .info dividendYield (%)" },
  { field: "free_cash_flow", source: "yfinance", note: "yfinance .info freeCashflow (Rs. Cr / USD mn)" },
  { field: "revenue_growth_yoy", source: "yfinance", note: "sales variance YoY from the reports pipeline" },
  { field: "profit_growth_yoy", source: "yfinance", note: "profit variance YoY from the reports pipeline" },
  { field: "sector", source: "yfinance", note: "yfinance .info sector" },
];

export const PROVENANCE_BY_FIELD: Record<string, FieldProvenance> = Object.fromEntries(
  FIELD_PROVENANCE.map((p) => [p.field, p]),
);

/** A source of company fundamentals for a batch of symbols. The production
 *  implementation is the Python yfinance pipeline; this interface documents the
 *  contract and leaves room for a drop-in paid vendor. */
export interface FundamentalRecord {
  symbol: string;
  sector: string | null;
  marketCap: number | null;
  peRatio: number | null;
  roe: number | null;
  debtToEquity: number | null;
  dividendYield: number | null;
  freeCashFlow: number | null;
}

export interface FundamentalsProvider {
  readonly name: string;
  /** Fetch fundamentals for the given exchange symbols. Missing fields come back
   *  as null (never fabricated / zero-filled). */
  fetch(symbols: string[], market: "US" | "IN"): Promise<FundamentalRecord[]>;
}
