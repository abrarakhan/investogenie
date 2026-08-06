// =============================================================================
// Long-Term Investment (LTI) Strategy Module
// -----------------------------------------------------------------------------
// Pure, deterministic scorers that encode the published fundamentals criteria
// of six well-known long-horizon investors, evaluated against one row of
// public.stock_snapshot (the same read model the Stock Screener and NL query
// use — see lib/screener/fields.ts, lib/screener/service.ts).
//
// Shaped after lib/analytics/legendaryStrategies.ts's registry pattern
// (Key -> Meta -> Result), but scores fundamentals rows instead of OHLCV bars.
// This file does not import from, call, or modify anything in
// legendaryStrategies.ts, swingClassifier.ts, or the probability engine.
//
// IMPORTANT — what is exact vs. approximated. This schema does not carry every
// figure each investor's original criteria need (no P/B, no balance-sheet
// current-assets/liabilities, no EBIT, no enterprise value, no multi-year
// history). Rather than fabricate those from unrelated columns, each strategy
// below either omits the unavailable criterion or substitutes the closest real
// proxy — always disclosed in that criterion's `description` and in the
// matching /help article. One classic screen, Graham's Net Current Asset
// Value ("net-net"), is not implemented at all: it fundamentally requires
// current assets minus total liabilities, which has no equivalent anywhere in
// this schema, and there is no honest proxy for it.
// =============================================================================

import type { Market } from "@/lib/screener/service";

export type LongTermStrategyKey =
  | "LYNCH_GARP"
  | "BUFFETT_MOAT"
  | "GRAHAM_DEFENSIVE"
  | "FISHER_GROWTH"
  | "TEMPLETON_CONTRARIAN"
  | "GREENBLATT_MAGIC";

export interface LongTermStrategyMeta {
  key: LongTermStrategyKey;
  label: string;
  investor: string;
  tagline: string;
  reference: string;
}

/** Display metadata — safe to import into client components (pure data). */
export const LONG_TERM_STRATEGY_META: LongTermStrategyMeta[] = [
  {
    key: "LYNCH_GARP",
    label: "Growth At A Reasonable Price",
    investor: "Peter Lynch",
    tagline: "Buy what you know. A PEG under 1 is a bargain.",
    reference: "One Up On Wall Street (1989); Beating the Street (1993)",
  },
  {
    key: "BUFFETT_MOAT",
    label: "Economic Moat",
    investor: "Warren Buffett",
    tagline: "A wonderful company at a fair price beats a fair company at a wonderful price.",
    reference: "Berkshire Hathaway Letters to Shareholders (1965–present)",
  },
  {
    key: "GRAHAM_DEFENSIVE",
    label: "Defensive Investor",
    investor: "Benjamin Graham",
    tagline: "Safety and simplicity over excitement.",
    reference: "The Intelligent Investor, Chapter 14 (1973 rev. ed.)",
  },
  {
    key: "FISHER_GROWTH",
    label: "Growth & Scuttlebutt",
    investor: "Philip Fisher",
    tagline: "Buy to own the business, not to watch the stock.",
    reference: "Common Stocks and Uncommon Profits (1958)",
  },
  {
    key: "TEMPLETON_CONTRARIAN",
    label: "Global Contrarian",
    investor: "John Templeton",
    tagline: "Buy at the point of maximum pessimism.",
    reference: "The Templeton Touch (1983)",
  },
  {
    key: "GREENBLATT_MAGIC",
    label: "Magic Formula (approximated)",
    investor: "Joel Greenblatt",
    tagline: "Rank by quality and cheapness; buy the intersection.",
    reference: "The Little Book That Beats the Market (2006)",
  },
];

export const LONG_TERM_STRATEGY_KEYS: LongTermStrategyKey[] = LONG_TERM_STRATEGY_META.map((m) => m.key);
export const LONG_TERM_STRATEGY_BY_KEY: Record<LongTermStrategyKey, LongTermStrategyMeta> =
  Object.fromEntries(LONG_TERM_STRATEGY_META.map((m) => [m.key, m])) as Record<LongTermStrategyKey, LongTermStrategyMeta>;

export type CriterionOp = "gte" | "lte" | "gt" | "lt" | "exists";

export interface LongTermCriterion {
  label: string;
  /** Field this criterion reads. Always a real stock_snapshot column, or one
   *  of the synthetic keys computed in fundamentalsForScoring() below. */
  field: string;
  op: CriterionOp;
  /** Threshold; ignored for "exists". Percent fields are percentage POINTS
   *  (15 means 15%), matching lib/screener/fields.ts's convention. */
  value?: number;
  unit?: string;
  description: string;
  /** 0..1 — how central this criterion is to the strategy. */
  weight: number;
}

/** Per-criterion outcome for one stock against one strategy. */
export interface CriterionOutcome {
  label: string;
  passed: boolean;
  /** True when the underlying field was null — shown distinctly from a clean fail. */
  dataMissing: boolean;
  description: string;
}

export interface LongTermScore {
  key: LongTermStrategyKey;
  /** 0..100 weighted match. */
  matchScore: number;
  matchedCriteria: number;
  totalCriteria: number;
  outcomes: CriterionOutcome[];
}

// --- Fundamentals input --------------------------------------------------

/** The subset of ScreenerStock a strategy can see, plus synthetic fields
 *  derived here (PEG, earnings yield, ROC proxy) — never persisted, computed
 *  fresh from the real columns each time a stock is scored. */
export interface LongTermFundamentals {
  pe_ratio: number | null;
  roe: number | null;
  roce: number | null;
  debt_to_equity: number | null;
  dividend_yield: number | null;
  market_cap: number | null;
  free_cash_flow: number | null;
  revenue_growth_yoy: number | null;
  profit_growth_yoy: number | null;
  pct_from_52w_high: number | null;
}

interface Synthetic {
  /** PEG = P/E ÷ profit growth (%). Undefined when growth isn't positive —
   *  PEG is meaningless (or infinite) for a shrinking or break-even business. */
  peg_ratio: number | null;
  /** 100 / P/E, as percentage points — a P/E of 10 gives 10. Crude proxy for
   *  Greenblatt's EBIT/Enterprise-Value earnings yield: it ignores debt and
   *  cash entirely, so it is a real approximation, not the formula itself. */
  earnings_yield_proxy: number | null;
}

function computeSynthetic(f: LongTermFundamentals): Synthetic {
  const peg =
    f.pe_ratio !== null && f.pe_ratio > 0 && f.profit_growth_yoy !== null && f.profit_growth_yoy > 0
      ? f.pe_ratio / f.profit_growth_yoy
      : null;
  const ey = f.pe_ratio !== null && f.pe_ratio > 0 ? 100 / f.pe_ratio : null;
  return { peg_ratio: peg, earnings_yield_proxy: ey };
}

function fieldValue(f: LongTermFundamentals, synth: Synthetic, key: string): number | null {
  if (key === "peg_ratio") return synth.peg_ratio;
  if (key === "earnings_yield_proxy") return synth.earnings_yield_proxy;
  const v = (f as unknown as Record<string, number | null>)[key];
  return v === undefined ? null : v;
}

// --- Strategy definitions --------------------------------------------------
// Market-cap floors are in the row's own unit (Rs. Crore for IN, USD millions
// for US — see lib/screener/fields.ts's note on market_cap/free_cash_flow),
// so callers must branch by market rather than share one raw number.

function grahamMarketCapFloor(market: Market): number {
  return market === "IN" ? 2000 : 200; // Rs. 2,000 Cr, or $200M
}
function greenblattLiquidityFloor(market: Market): number {
  return market === "IN" ? 500 : 50; // Rs. 500 Cr, or $50M
}

function criteriaFor(key: LongTermStrategyKey, market: Market): LongTermCriterion[] {
  switch (key) {
    case "LYNCH_GARP":
      return [
        { label: "PEG Ratio", field: "peg_ratio", op: "lte", value: 1.0, unit: "×",
          description: "P/E ÷ profit growth (YoY). Lynch's sweet spot is under 1.0. Not scored when profit growth isn't positive — PEG is meaningless for a shrinking business.",
          weight: 1.0 },
        { label: "Debt-to-Equity", field: "debt_to_equity", op: "lte", value: 0.5, unit: "×",
          description: "Lynch avoided heavily indebted growers. Under 0.5× is comfortable.",
          weight: 0.8 },
        { label: "Profit Growth (YoY)", field: "profit_growth_yoy", op: "gte", value: 15, unit: "%",
          description: "Fast-grower territory. Lynch's original test used 5-year growth; only a single year (YoY) is available here.",
          weight: 0.9 },
        { label: "P/E Ratio", field: "pe_ratio", op: "lte", value: 25, unit: "×",
          description: "Lynch rarely paid more than a mid-20s multiple for a grower.",
          weight: 0.6 },
        { label: "Revenue Growth (YoY)", field: "revenue_growth_yoy", op: "gte", value: 10, unit: "%",
          description: "Top-line growth should confirm the bottom-line growth.",
          weight: 0.5 },
      ];
    case "BUFFETT_MOAT":
      return [
        { label: "ROE", field: "roe", op: "gte", value: 15, unit: "%",
          description: "Buffett wants 15%+ return on equity. His own test looks for this sustained 5–10 years; only the latest reported figure is available here.",
          weight: 1.0 },
        { label: "ROCE", field: "roce", op: "gte", value: 15, unit: "%",
          description: "Return on capital employed — businesses that don't need much capital to grow.",
          weight: 0.9 },
        { label: "Debt-to-Equity", field: "debt_to_equity", op: "lte", value: 0.5, unit: "×",
          description: "Buffett dislikes leverage. Many of his best holdings carry little or no debt.",
          weight: 0.8 },
        { label: "Free Cash Flow", field: "free_cash_flow", op: "gt", value: 0,
          description: "Positive free cash flow — a stand-in for Buffett's \"owner earnings\" (net income adjusted for capex and working capital). Gross margin and a literal 10-year earnings CAGR aren't in this dataset.",
          weight: 0.8 },
        { label: "Profit Growth (YoY)", field: "profit_growth_yoy", op: "gte", value: 10, unit: "%",
          description: "A one-year proxy for Buffett's decade-long consistent-compounding test.",
          weight: 0.6 },
      ];
    case "GRAHAM_DEFENSIVE":
      return [
        { label: "Adequate Size", field: "market_cap", op: "gte", value: grahamMarketCapFloor(market),
          unit: market === "IN" ? "₹ Cr" : "$ Mn",
          description: `Graham's size floor, scaled to a modern small-cap cutoff (${market === "IN" ? "₹2,000 Cr" : "$200M"}).`,
          weight: 0.6 },
        { label: "Moderate P/E", field: "pe_ratio", op: "lte", value: 15, unit: "×",
          description: "No more than 15× earnings. Graham's original test averaged 3 years of earnings; only the current P/E is available here.",
          weight: 0.9 },
        { label: "Debt-to-Equity", field: "debt_to_equity", op: "lte", value: 0.5, unit: "×",
          description: "Proxy for Graham's literal \"current ratio ≥ 2×\" test, which needs a balance sheet this dataset doesn't carry.",
          weight: 0.7 },
        { label: "Pays a Dividend", field: "dividend_yield", op: "gt", value: 0, unit: "%",
          description: "Proxy for Graham's \"uninterrupted dividends for 20 years\" — only the current yield is available, not a payment history.",
          weight: 0.5 },
      ];
    case "FISHER_GROWTH":
      return [
        { label: "Revenue Growth (YoY)", field: "revenue_growth_yoy", op: "gte", value: 15, unit: "%",
          description: "Fisher wanted substantial growth potential for years ahead. His test used a 5-year trend; only YoY is available here.",
          weight: 1.0 },
        { label: "Debt-to-Equity", field: "debt_to_equity", op: "lte", value: 0.4, unit: "×",
          description: "Fisher preferred growth financed internally, not through leverage.",
          weight: 0.7 },
        { label: "ROE", field: "roe", op: "gte", value: 15, unit: "%",
          description: "High returns without excessive leverage.",
          weight: 0.8 },
        { label: "P/E Ratio", field: "pe_ratio", op: "lte", value: 40, unit: "×",
          description: "Fisher paid up for quality, but not without limit. Margin trend and R&D/revenue aren't in this dataset.",
          weight: 0.4 },
      ];
    case "TEMPLETON_CONTRARIAN":
      return [
        { label: "P/E Ratio", field: "pe_ratio", op: "lte", value: 12, unit: "×",
          description: "Low multiples, especially bought during panics.",
          weight: 1.0 },
        { label: "Dividend Yield", field: "dividend_yield", op: "gte", value: 3, unit: "%",
          description: "Income while waiting for mean reversion.",
          weight: 0.7 },
        { label: "Debt-to-Equity", field: "debt_to_equity", op: "lte", value: 0.5, unit: "×",
          description: "Survivability matters when buying into trouble.",
          weight: 0.6 },
        { label: "Below 52-Week High", field: "pct_from_52w_high", op: "lte", value: -30, unit: "%",
          description: "At least 30% below its 52-week high — a direct read of pessimism (price-to-book isn't in this dataset, so this replaces it).",
          weight: 0.8 },
      ];
    case "GREENBLATT_MAGIC":
      return [
        { label: "Return on Capital (proxy)", field: "roce", op: "gte", value: 25, unit: "%",
          description: "ROCE stands in for Greenblatt's literal Return on Capital, EBIT ÷ (Net Working Capital + Net Fixed Assets) — a related but different ratio; this dataset has no NWC/fixed-asset breakdown.",
          weight: 1.0 },
        { label: "Earnings Yield (proxy)", field: "earnings_yield_proxy", op: "gte", value: 10, unit: "%",
          description: "100 ÷ P/E stands in for Greenblatt's EBIT ÷ Enterprise Value. This ignores debt and cash entirely, so it is a real approximation, not his formula.",
          weight: 1.0 },
        { label: "Market Cap", field: "market_cap", op: "gte", value: greenblattLiquidityFloor(market),
          unit: market === "IN" ? "₹ Cr" : "$ Mn",
          description: "Liquidity floor — Greenblatt excluded tiny, illiquid names.",
          weight: 0.3 },
        { label: "Positive P/E", field: "pe_ratio", op: "gt", value: 0,
          description: "Positive earnings only.",
          weight: 0.3 },
      ];
  }
}

function evaluateCriterion(value: number | null, c: LongTermCriterion): CriterionOutcome {
  if (value === null) {
    return { label: c.label, passed: false, dataMissing: true, description: c.description };
  }
  let passed: boolean;
  switch (c.op) {
    case "exists": passed = true; break;
    case "gte": passed = value >= (c.value as number); break;
    case "lte": passed = value <= (c.value as number); break;
    case "gt": passed = value > (c.value as number); break;
    case "lt": passed = value < (c.value as number); break;
  }
  return { label: c.label, passed, dataMissing: false, description: c.description };
}

/** Score one stock's fundamentals against one long-term strategy. */
export function scoreAgainstLongTermStrategy(
  fundamentals: LongTermFundamentals,
  key: LongTermStrategyKey,
  market: Market,
): LongTermScore {
  const synth = computeSynthetic(fundamentals);
  const criteria = criteriaFor(key, market);

  let totalWeight = 0;
  let matchedWeight = 0;
  let matched = 0;
  const outcomes: CriterionOutcome[] = [];

  for (const c of criteria) {
    const value = fieldValue(fundamentals, synth, c.field);
    const outcome = evaluateCriterion(value, c);
    outcomes.push(outcome);
    totalWeight += c.weight;
    if (outcome.passed) {
      matched++;
      matchedWeight += c.weight;
    }
  }

  return {
    key,
    matchScore: totalWeight > 0 ? Math.round((matchedWeight / totalWeight) * 100) : 0,
    matchedCriteria: matched,
    totalCriteria: criteria.length,
    outcomes,
  };
}

/** Score one stock against every long-term strategy. */
export function scoreAllLongTermStrategies(
  fundamentals: LongTermFundamentals,
  market: Market,
): LongTermScore[] {
  return LONG_TERM_STRATEGY_KEYS.map((key) => scoreAgainstLongTermStrategy(fundamentals, key, market));
}
