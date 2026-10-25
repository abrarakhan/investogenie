// Screener field registry — the single source of truth for what is screenable,
// how it is labelled/formatted in the UI, and which stock_snapshot column backs
// it. The filter engine (filterEngine.ts) only ever references fields from this
// registry, so the SQL builder can trust the column names (no injection surface)
// and the UI can render inputs from the field metadata.

export type FieldType = "number" | "enum" | "text";

/** How to render a numeric value: plain number, percent, price, big money, or
 *  an integer rank. Purely presentational — the engine ignores it. */
export type FieldFormat = "number" | "percent" | "price" | "money" | "integer" | "text";

export interface FieldDef {
  /** Stable key used in saved filters and the API. */
  key: string;
  /** Human label for the column header / filter builder. */
  label: string;
  /** Backing column in public.stock_snapshot. */
  column: string;
  type: FieldType;
  format: FieldFormat;
  /** Short unit shown next to inputs (e.g. "%", "₹ Cr"). */
  unit?: string;
  /** Whether the results table can sort on it. */
  sortable: boolean;
  /** Whether it shows as a default column in the results table. */
  defaultColumn?: boolean;
  /** One-line help shown in the filter builder. */
  help?: string;
  /** Available point-in-time in screener_technical_daily and safe to backtest. */
  historical?: boolean;
}

// NOTE: `market_cap` and `free_cash_flow` are in Rs. Crore for IN rows and USD
// millions for US rows (see migration 0012); the UI formats them per-row using
// the row currency, so the registry unit is deliberately generic.
export const FIELDS: FieldDef[] = [
  { key: "symbol", label: "Symbol", column: "symbol", type: "text", format: "text", sortable: true, defaultColumn: true },
  { key: "sector", label: "Sector", column: "sector", type: "enum", format: "text", sortable: true, defaultColumn: true, help: "Filter to one or more sectors" },

  { key: "ltp", label: "LTP", column: "ltp", type: "number", format: "price", sortable: true, defaultColumn: true, help: "Last traded price" },
  { key: "change_pct_1d", label: "% Chg (1D)", column: "change_pct_1d", type: "number", format: "percent", unit: "%", sortable: true, defaultColumn: true },
  { key: "volume", label: "Volume", column: "volume", type: "number", format: "integer", sortable: true },
  { key: "trade_value", label: "Trade Value", column: "trade_value", type: "number", format: "money", sortable: true, help: "LTP × volume" },
  { key: "market_cap", label: "Market Cap", column: "market_cap", type: "number", format: "money", sortable: true, defaultColumn: true },
  { key: "mcap_rank", label: "Mkt-cap Rank", column: "mcap_rank", type: "number", format: "integer", sortable: true, help: "1 = largest in market; SEBI cap bands" },

  { key: "pe_ratio", label: "P/E", column: "pe_ratio", type: "number", format: "number", sortable: true, defaultColumn: true },
  { key: "roe", label: "ROE", column: "roe", type: "number", format: "percent", unit: "%", sortable: true, help: "Return on equity" },
  { key: "roce", label: "ROCE", column: "roce", type: "number", format: "percent", unit: "%", sortable: true },
  { key: "debt_to_equity", label: "Debt/Equity", column: "debt_to_equity", type: "number", format: "number", sortable: true },
  { key: "dividend_yield", label: "Div Yield", column: "dividend_yield", type: "number", format: "percent", unit: "%", sortable: true },
  { key: "free_cash_flow", label: "Free Cash Flow", column: "free_cash_flow", type: "number", format: "money", sortable: true },
  { key: "revenue_growth_yoy", label: "Rev Growth (YoY)", column: "revenue_growth_yoy", type: "number", format: "percent", unit: "%", sortable: true, defaultColumn: true },
  { key: "profit_growth_yoy", label: "Profit Growth (YoY)", column: "profit_growth_yoy", type: "number", format: "percent", unit: "%", sortable: true, defaultColumn: true },

  { key: "high_52w", label: "52W High", column: "high_52w", type: "number", format: "price", sortable: true },
  { key: "low_52w", label: "52W Low", column: "low_52w", type: "number", format: "price", sortable: true },
  { key: "pct_from_52w_high", label: "% From 52W High", column: "pct_from_52w_high", type: "number", format: "percent", unit: "%", sortable: true, help: "≤ 0; how far below the 52-week high" },
  { key: "pct_from_52w_low", label: "% From 52W Low", column: "pct_from_52w_low", type: "number", format: "percent", unit: "%", sortable: true, help: "≥ 0; how far above the 52-week low" },
  { key: "gap_pct", label: "Gap %", column: "gap_pct", type: "number", format: "percent", unit: "%", sortable: true, help: "Open vs previous close" },
  { key: "intraday_vol_pct", label: "Intraday Vol %", column: "intraday_vol_pct", type: "number", format: "percent", unit: "%", sortable: true, help: "(High − Low) / prev close" },

  { key: "sma_20", label: "SMA 20", column: "sma_20", type: "number", format: "price", sortable: true, historical: true },
  { key: "sma_50", label: "SMA 50", column: "sma_50", type: "number", format: "price", sortable: true, historical: true },
  { key: "sma_100", label: "SMA 100", column: "sma_100", type: "number", format: "price", sortable: true, historical: true },
  { key: "sma_150", label: "SMA 150", column: "sma_150", type: "number", format: "price", sortable: true, historical: true },
  { key: "sma_200", label: "SMA 200", column: "sma_200", type: "number", format: "price", sortable: true, historical: true },
  { key: "ema_20", label: "EMA 20", column: "ema_20", type: "number", format: "price", sortable: true, historical: true },
  { key: "ema_50", label: "EMA 50", column: "ema_50", type: "number", format: "price", sortable: true, historical: true },
  { key: "distance_sma_20_pct", label: "% vs SMA 20", column: "distance_sma_20_pct", type: "number", format: "percent", unit: "%", sortable: true, historical: true, help: "Positive means price is above its 20-day average" },
  { key: "distance_sma_50_pct", label: "% vs SMA 50", column: "distance_sma_50_pct", type: "number", format: "percent", unit: "%", sortable: true, historical: true, help: "Positive means price is above its 50-day average" },
  { key: "distance_sma_100_pct", label: "% vs SMA 100", column: "distance_sma_100_pct", type: "number", format: "percent", unit: "%", sortable: true, historical: true, help: "Positive means price is above its 100-day average" },
  { key: "distance_sma_150_pct", label: "% vs SMA 150", column: "distance_sma_150_pct", type: "number", format: "percent", unit: "%", sortable: true, historical: true, help: "Positive means price is above its 150-day average" },
  { key: "distance_sma_200_pct", label: "% vs SMA 200", column: "distance_sma_200_pct", type: "number", format: "percent", unit: "%", sortable: true, historical: true, help: "Positive means price is above its 200-day average" },
  { key: "distance_ema_20_pct", label: "% vs EMA 20", column: "distance_ema_20_pct", type: "number", format: "percent", unit: "%", sortable: true, historical: true, help: "Positive means price is above its 20-day exponential average" },
  { key: "distance_ema_50_pct", label: "% vs EMA 50", column: "distance_ema_50_pct", type: "number", format: "percent", unit: "%", sortable: true, historical: true, help: "Positive means price is above its 50-day exponential average" },
  { key: "sma_20_vs_50_pct", label: "SMA 20 vs 50 %", column: "sma_20_vs_50_pct", type: "number", format: "percent", unit: "%", sortable: true, historical: true, help: "Positive means SMA 20 is above SMA 50" },
  { key: "sma_20_vs_100_pct", label: "SMA 20 vs 100 %", column: "sma_20_vs_100_pct", type: "number", format: "percent", unit: "%", sortable: true, historical: true },
  { key: "sma_20_vs_150_pct", label: "SMA 20 vs 150 %", column: "sma_20_vs_150_pct", type: "number", format: "percent", unit: "%", sortable: true, historical: true },
  { key: "sma_20_vs_200_pct", label: "SMA 20 vs 200 %", column: "sma_20_vs_200_pct", type: "number", format: "percent", unit: "%", sortable: true, historical: true },
  { key: "sma_50_vs_100_pct", label: "SMA 50 vs 100 %", column: "sma_50_vs_100_pct", type: "number", format: "percent", unit: "%", sortable: true, historical: true },
  { key: "sma_50_vs_150_pct", label: "SMA 50 vs 150 %", column: "sma_50_vs_150_pct", type: "number", format: "percent", unit: "%", sortable: true, historical: true },
  { key: "sma_50_vs_200_pct", label: "SMA 50 vs 200 %", column: "sma_50_vs_200_pct", type: "number", format: "percent", unit: "%", sortable: true, historical: true, help: "Positive means SMA 50 is above SMA 200" },
  { key: "sma_100_vs_150_pct", label: "SMA 100 vs 150 %", column: "sma_100_vs_150_pct", type: "number", format: "percent", unit: "%", sortable: true, historical: true },
  { key: "sma_100_vs_200_pct", label: "SMA 100 vs 200 %", column: "sma_100_vs_200_pct", type: "number", format: "percent", unit: "%", sortable: true, historical: true },
  { key: "sma_150_vs_200_pct", label: "SMA 150 vs 200 %", column: "sma_150_vs_200_pct", type: "number", format: "percent", unit: "%", sortable: true, historical: true },
  { key: "rsi_14", label: "RSI 14", column: "rsi_14", type: "number", format: "number", sortable: true, historical: true },
  { key: "atr_pct_14", label: "ATR 14 %", column: "atr_pct_14", type: "number", format: "percent", unit: "%", sortable: true, historical: true },
  { key: "volume_ratio_20", label: "Volume / 20D Avg", column: "volume_ratio_20", type: "number", format: "number", sortable: true, historical: true },
  { key: "return_5d", label: "Return 5D", column: "return_5d", type: "number", format: "percent", unit: "%", sortable: true, historical: true },
  { key: "return_20d", label: "Return 20D", column: "return_20d", type: "number", format: "percent", unit: "%", sortable: true, historical: true },
  { key: "return_63d", label: "Return 3M", column: "return_63d", type: "number", format: "percent", unit: "%", sortable: true, historical: true },
];

export const FIELD_BY_KEY: Record<string, FieldDef> = Object.fromEntries(
  FIELDS.map((f) => [f.key, f]),
);

/** Keys safe to sort by (whitelist for the ORDER BY builder). */
export const SORTABLE_KEYS = new Set(FIELDS.filter((f) => f.sortable).map((f) => f.key));

export const DEFAULT_COLUMNS = FIELDS.filter((f) => f.defaultColumn).map((f) => f.key);

export const NUMERIC_FIELDS = FIELDS.filter((f) => f.type === "number");
