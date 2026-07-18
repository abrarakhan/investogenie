// Predefined screens — ready-made filter/sort combinations the user can apply
// and then further edit. Purely declarative: a preset is just an initial set of
// engine filters plus a default sort, so applying one and hand-tweaking it use
// exactly the same machinery.

import type { Filter, SortSpec } from "./filterEngine";

export type PresetGroup = "Price action" | "Fundamentals";

export interface Preset {
  key: string;
  label: string;
  group: PresetGroup;
  description: string;
  filters: Filter[];
  sort?: SortSpec;
  /** Non-declarative presets the service resolves at query time (e.g. sector
   *  median). The listed filters act as a sensible fallback. */
  dynamic?: "value";
}

export const PRESETS: Preset[] = [
  // --- Price action --------------------------------------------------------
  { key: "top_gainers", label: "Top gainers", group: "Price action",
    description: "Biggest 1-day % gains", filters: [{ field: "change_pct_1d", op: "gt", value: 0 }],
    sort: { field: "change_pct_1d", dir: "desc" } },
  { key: "top_losers", label: "Top losers", group: "Price action",
    description: "Biggest 1-day % falls", filters: [{ field: "change_pct_1d", op: "lt", value: 0 }],
    sort: { field: "change_pct_1d", dir: "asc" } },
  { key: "near_52w_high", label: "Near 52W high", group: "Price action",
    description: "Within 5% of the 52-week high", filters: [{ field: "pct_from_52w_high", op: "gte", value: -5 }],
    sort: { field: "pct_from_52w_high", dir: "desc" } },
  { key: "near_52w_low", label: "Near 52W low", group: "Price action",
    description: "Within 5% of the 52-week low", filters: [{ field: "pct_from_52w_low", op: "lte", value: 5 }],
    sort: { field: "pct_from_52w_low", dir: "asc" } },
  { key: "gap_up", label: "Gap up", group: "Price action",
    description: "Opened ≥ 1% above previous close", filters: [{ field: "gap_pct", op: "gte", value: 1 }],
    sort: { field: "gap_pct", dir: "desc" } },
  { key: "gap_down", label: "Gap down", group: "Price action",
    description: "Opened ≤ 1% below previous close", filters: [{ field: "gap_pct", op: "lte", value: -1 }],
    sort: { field: "gap_pct", dir: "asc" } },
  { key: "high_volatility", label: "High volatility", group: "Price action",
    description: "Widest intraday high–low range", filters: [{ field: "intraday_vol_pct", op: "gt", value: 0 }],
    sort: { field: "intraday_vol_pct", dir: "desc" } },
  { key: "most_active_volume", label: "Most active (volume)", group: "Price action",
    description: "Highest traded volume", filters: [], sort: { field: "volume", dir: "desc" } },
  { key: "most_active_value", label: "Most active (value)", group: "Price action",
    description: "Highest traded value", filters: [], sort: { field: "trade_value", dir: "desc" } },

  // --- Fundamentals --------------------------------------------------------
  { key: "high_growth", label: "High growth", group: "Fundamentals",
    description: "Revenue & profit growth > 15% YoY",
    filters: [{ field: "revenue_growth_yoy", op: "gt", value: 15 }, { field: "profit_growth_yoy", op: "gt", value: 15 }],
    sort: { field: "profit_growth_yoy", dir: "desc" } },
  { key: "quality", label: "Quality", group: "Fundamentals",
    description: "ROE > 15% and D/E < 0.5",
    filters: [{ field: "roe", op: "gt", value: 15 }, { field: "debt_to_equity", op: "lt", value: 0.5 }],
    sort: { field: "roe", dir: "desc" } },
  { key: "value", label: "Value", group: "Fundamentals", dynamic: "value",
    description: "P/E below the sector median",
    filters: [{ field: "pe_ratio", op: "gt", value: 0 }],
    sort: { field: "pe_ratio", dir: "asc" } },
  { key: "low_debt", label: "Low debt", group: "Fundamentals",
    description: "Debt/Equity < 0.3", filters: [{ field: "debt_to_equity", op: "lt", value: 0.3 }],
    sort: { field: "debt_to_equity", dir: "asc" } },
  { key: "dividend_payers", label: "Dividend payers", group: "Fundamentals",
    description: "Dividend yield > 2%", filters: [{ field: "dividend_yield", op: "gt", value: 2 }],
    sort: { field: "dividend_yield", dir: "desc" } },
  // SEBI cap bands by market-cap rank: top 100 / 101–250 / 251+.
  { key: "large_cap", label: "Large caps", group: "Fundamentals",
    description: "Top 100 by market cap (SEBI)", filters: [{ field: "mcap_rank", op: "lte", value: 100 }],
    sort: { field: "market_cap", dir: "desc" } },
  { key: "mid_cap", label: "Mid caps", group: "Fundamentals",
    description: "Ranks 101–250 by market cap (SEBI)", filters: [{ field: "mcap_rank", op: "between", value: [101, 250] }],
    sort: { field: "market_cap", dir: "desc" } },
  { key: "small_cap", label: "Small caps", group: "Fundamentals",
    description: "Rank 251+ by market cap (SEBI)", filters: [{ field: "mcap_rank", op: "gt", value: 250 }],
    sort: { field: "market_cap", dir: "desc" } },
];

export const PRESET_BY_KEY: Record<string, Preset> = Object.fromEntries(PRESETS.map((p) => [p.key, p]));
