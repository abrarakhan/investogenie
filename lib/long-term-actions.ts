"use server";

// Long-Term Investment (LTI) candidates — server-side scoring.
//
// Deliberately reuses getScreenerResults() rather than hand-building SQL: that
// path already validates every clause through the field registry, so this
// feature inherits the same injection-safe guarantees and cannot drift from the
// Stock Screener's read model. Nothing here touches the swing or probability
// engines.

import {
  getScreenerResults,
  type Market,
  type ScreenerStock,
} from "@/lib/screener/service";
import {
  scoreAllLongTermStrategies,
  LONG_TERM_STRATEGY_KEYS,
  type LongTermFundamentals,
  type LongTermScore,
  type LongTermStrategyKey,
} from "@/lib/analytics/longTermStrategies";

/** One LTI candidate: the stock's display fields plus its per-strategy scores. */
export interface LongTermCandidate {
  assetId: string;
  symbol: string;
  name: string | null;
  sector: string | null;
  currency: string;
  ltp: number | null;
  changePct1d: number | null;
  marketCap: number | null;
  peRatio: number | null;
  roe: number | null;
  roce: number | null;
  debtToEquity: number | null;
  dividendYield: number | null;
  revenueGrowthYoY: number | null;
  profitGrowthYoY: number | null;
  /** Every strategy's score, best first. */
  scores: LongTermScore[];
  /** Highest matchScore across the strategies in scope for this query. */
  bestScore: number;
}

export interface LongTermResult {
  candidates: LongTermCandidate[];
  /** How many snapshot rows were scored before filtering by score. */
  scanned: number;
  refreshedAt: string | null;
}

/** How many snapshot rows to score per request. The whole universe is far
 *  larger, but scoring is pure CPU over already-fetched rows, so this bounds
 *  the page's work; rows are pre-ranked by market cap so the most significant
 *  companies are always in scope. */
const SCAN_LIMIT = 500;

function toFundamentals(row: ScreenerStock): LongTermFundamentals {
  return {
    pe_ratio: row.pe_ratio,
    roe: row.roe,
    roce: row.roce,
    debt_to_equity: row.debt_to_equity,
    dividend_yield: row.dividend_yield,
    market_cap: row.market_cap,
    free_cash_flow: row.free_cash_flow,
    revenue_growth_yoy: row.revenue_growth_yoy,
    profit_growth_yoy: row.profit_growth_yoy,
    pct_from_52w_high: row.pct_from_52w_high,
  };
}

export interface LongTermQuery {
  market: Market;
  /** Restrict scoring to these strategies; empty/omitted = all of them. */
  strategies?: LongTermStrategyKey[];
  /** Drop candidates whose best in-scope score is below this (0–100). */
  minScore?: number;
  /** Max candidates returned after filtering. */
  limit?: number;
}

/**
 * Score the market's most significant stocks against the long-term strategies
 * and return the best matches. Read-only and public — mirrors the Stock
 * Screener, which is also viewable without signing in.
 */
export async function getLongTermCandidates(q: LongTermQuery): Promise<LongTermResult> {
  const inScope: LongTermStrategyKey[] =
    q.strategies && q.strategies.length > 0 ? q.strategies : LONG_TERM_STRATEGY_KEYS;
  const minScore = Math.min(100, Math.max(0, q.minScore ?? 0));
  const limit = Math.min(200, Math.max(1, q.limit ?? 50));

  // Rank by market cap so the scan window covers the most significant names.
  const screened = await getScreenerResults({
    market: q.market,
    filters: [],
    sort: { field: "market_cap", dir: "desc" },
    pageSize: SCAN_LIMIT,
    page: 1,
  });

  const scoreSet = new Set<LongTermStrategyKey>(inScope);
  const candidates: LongTermCandidate[] = [];

  for (const row of screened.rows) {
    const all = scoreAllLongTermStrategies(toFundamentals(row), q.market);
    const relevant = all.filter((s) => scoreSet.has(s.key));
    const bestScore = relevant.reduce((max, s) => Math.max(max, s.matchScore), 0);
    if (bestScore < minScore) continue;

    candidates.push({
      assetId: row.asset_id,
      symbol: row.symbol,
      name: row.name,
      sector: row.sector,
      currency: row.currency,
      ltp: row.ltp,
      changePct1d: row.change_pct_1d,
      marketCap: row.market_cap,
      peRatio: row.pe_ratio,
      roe: row.roe,
      roce: row.roce,
      debtToEquity: row.debt_to_equity,
      dividendYield: row.dividend_yield,
      revenueGrowthYoY: row.revenue_growth_yoy,
      profitGrowthYoY: row.profit_growth_yoy,
      scores: [...relevant].sort((a, b) => b.matchScore - a.matchScore),
      bestScore,
    });
  }

  candidates.sort((a, b) => b.bestScore - a.bestScore || a.symbol.localeCompare(b.symbol));

  return {
    candidates: candidates.slice(0, limit),
    scanned: screened.rows.length,
    refreshedAt: screened.refreshedAt,
  };
}
