// Screener read service. Server-side filtering, sorting and pagination over the
// public.stock_snapshot read model, driven by the composable filter engine.
// Used by the /api/screener route (results), the /screener page (initial load),
// and the dashboard widget.

import { query, queryOne } from "@/lib/db";
import {
  toSqlWhere,
  toOrderBy,
  validateFilter,
  type Filter,
  type SortSpec,
} from "./filterEngine";

export type Market = "US" | "IN";

/** One screener result row. Column names mirror stock_snapshot / the field
 *  registry so the filter engine and the UI address fields identically. */
export interface ScreenerStock {
  asset_id: string;
  symbol: string;
  name: string | null;
  sector: string | null;
  country: string;
  exchange: string;
  currency: string;
  ltp: number | null;
  change_pct_1d: number | null;
  volume: number | null;
  trade_value: number | null;
  prev_close: number | null;
  day_open: number | null;
  day_high: number | null;
  day_low: number | null;
  high_52w: number | null;
  low_52w: number | null;
  pct_from_52w_high: number | null;
  pct_from_52w_low: number | null;
  gap_pct: number | null;
  intraday_vol_pct: number | null;
  market_cap: number | null;
  mcap_rank: number | null;
  pe_ratio: number | null;
  roe: number | null;
  roce: number | null;
  debt_to_equity: number | null;
  dividend_yield: number | null;
  free_cash_flow: number | null;
  revenue_growth_yoy: number | null;
  profit_growth_yoy: number | null;
  refreshed_at: string;
}

export interface ScreenQuery {
  market: Market;
  universe?: string; // 'ALL' (default) or a universe_members key
  filters?: Filter[];
  sort?: SortSpec;
  search?: string; // symbol / name substring
  page?: number; // 1-based
  pageSize?: number; // default 50, capped at 500
  /** "Value" preset: keep only P/E below the row's own sector median. Composes
   *  with `filters` (AND). Can't be expressed as a static bound, so it's a flag. */
  valueBelowSectorMedian?: boolean;
}

export interface ScreenResult {
  rows: ScreenerStock[];
  total: number;
  page: number;
  pageSize: number;
  refreshedAt: string | null;
}

const DEFAULT_SORT: SortSpec = { field: "market_cap", dir: "desc" };
const MAX_PAGE_SIZE = 500;

// Numeric columns come back from pg as strings (numeric type); coerce for JSON.
const NUMERIC_COLS: (keyof ScreenerStock)[] = [
  "ltp", "change_pct_1d", "volume", "trade_value", "prev_close", "day_open", "day_high",
  "day_low", "high_52w", "low_52w", "pct_from_52w_high", "pct_from_52w_low", "gap_pct",
  "intraday_vol_pct", "market_cap", "mcap_rank", "pe_ratio", "roe", "roce", "debt_to_equity",
  "dividend_yield", "free_cash_flow", "revenue_growth_yoy", "profit_growth_yoy",
];

function coerce(row: Record<string, unknown>): ScreenerStock {
  const out = { ...row } as Record<string, unknown>;
  for (const col of NUMERIC_COLS) {
    const v = out[col];
    out[col] = v === null || v === undefined ? null : Number(v);
  }
  return out as unknown as ScreenerStock;
}

const SELECT_COLS = `
  s.asset_id, s.symbol, s.name, s.sector, s.country, s.exchange, s.currency,
  s.ltp, s.change_pct_1d, s.volume, s.trade_value, s.prev_close, s.day_open, s.day_high, s.day_low,
  s.high_52w, s.low_52w, s.pct_from_52w_high, s.pct_from_52w_low, s.gap_pct, s.intraday_vol_pct,
  s.market_cap, s.mcap_rank, s.pe_ratio, s.roe, s.roce, s.debt_to_equity, s.dividend_yield,
  s.free_cash_flow, s.revenue_growth_yoy, s.profit_growth_yoy, s.refreshed_at`;

/** Run a screen: filter + sort + paginate. Filters are validated up front so a
 *  malformed clause fails fast with a clear message rather than a SQL error. */
export async function getScreenerResults(q: ScreenQuery): Promise<ScreenResult> {
  const filters = q.filters ?? [];
  filters.forEach(validateFilter); // throws on unknown field / bad operator / bad value

  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, q.pageSize ?? 50));

  const params: unknown[] = [q.market];
  const conds: string[] = ["s.country = $1"];

  // Universe membership (ALL needs no join).
  let joinSql = "";
  if (q.universe && q.universe !== "ALL") {
    params.push(q.universe);
    joinSql = `join public.universe_members u on u.asset_id = s.asset_id and u.universe = $${params.length}`;
  }

  // Filter clauses continue the parameter sequence after the ones above.
  const { clauses, params: filterParams } = toSqlWhere(filters, params.length + 1);
  params.push(...filterParams);
  conds.push(...clauses);

  // Free-text search over symbol/name.
  if (q.search && q.search.trim()) {
    params.push(`%${q.search.trim()}%`);
    conds.push(`(s.symbol ilike $${params.length} or s.name ilike $${params.length})`);
  }

  // "Value" preset: P/E below the sector median. Joins a per-sector median CTE
  // computed over the same market and ANDs a relative clause the static filter
  // engine can't express.
  if (q.valueBelowSectorMedian) {
    joinSql += ` join (
      select sector, percentile_cont(0.5) within group (order by pe_ratio) as median_pe
      from public.stock_snapshot where country = $1 and pe_ratio > 0 and sector is not null
      group by sector
    ) med on med.sector = s.sector`;
    conds.push("s.pe_ratio > 0 and s.pe_ratio < med.median_pe");
  }

  const where = `where ${conds.join(" and ")}`;
  const orderBy = toOrderBy(q.sort, DEFAULT_SORT);

  const totalRow = await queryOne<{ count: string }>(
    `select count(*)::text as count from public.stock_snapshot s ${joinSql} ${where}`,
    params,
  );
  const total = Number(totalRow?.count ?? 0);

  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;
  params.push(pageSize, (page - 1) * pageSize);

  const rows = await query<Record<string, unknown>>(
    `select ${SELECT_COLS}
       from public.stock_snapshot s ${joinSql}
       ${where}
       ${orderBy}
       limit $${limitIdx} offset $${offsetIdx}`,
    params,
  );

  return {
    rows: rows.map(coerce),
    total,
    page,
    pageSize,
    refreshedAt: rows[0]?.refreshed_at ? String(rows[0].refreshed_at) : await getRefreshedAt(q.market),
  };
}

/** Distinct sector list for a market (for the sector multi-select filter). */
export async function getSectors(market: Market): Promise<string[]> {
  const rows = await query<{ sector: string }>(
    `select distinct sector from public.stock_snapshot
      where country = $1 and sector is not null order by sector`,
    [market],
  );
  return rows.map((r) => r.sector);
}

/** When the snapshot for a market was last rebuilt (for the "as of" label). */
export async function getRefreshedAt(market: Market): Promise<string | null> {
  const row = await queryOne<{ refreshed_at: string }>(
    "select max(refreshed_at)::text as refreshed_at from public.stock_snapshot where country = $1",
    [market],
  );
  return row?.refreshed_at ?? null;
}

/** Available universes for a market (those actually seeded), always incl. ALL. */
export async function getUniverses(market: Market): Promise<string[]> {
  const rows = await query<{ universe: string }>(
    "select distinct universe from public.universe_members where country = $1 order by universe",
    [market],
  );
  return ["ALL", ...rows.map((r) => r.universe)];
}
