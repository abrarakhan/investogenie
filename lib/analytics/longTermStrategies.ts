export type LongTermMarket = "US" | "IN";

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

export const LONG_TERM_STRATEGY_META: LongTermStrategyMeta[] = [
  { key: "LYNCH_GARP", label: "Growth At A Reasonable Price", investor: "Peter Lynch", tagline: "Durable growth bought at a sensible multiple.", reference: "One Up On Wall Street (1989); Beating the Street (1993)" },
  { key: "BUFFETT_MOAT", label: "Economic Moat", investor: "Warren Buffett", tagline: "Consistent returns, cash generation and restrained leverage.", reference: "Berkshire Hathaway Letters to Shareholders" },
  { key: "GRAHAM_DEFENSIVE", label: "Defensive Investor", investor: "Benjamin Graham", tagline: "Earnings stability, valuation and financial resilience.", reference: "The Intelligent Investor, Chapter 14" },
  { key: "FISHER_GROWTH", label: "Growth & Scuttlebutt", investor: "Philip Fisher", tagline: "Sustained business growth with efficient capital allocation.", reference: "Common Stocks and Uncommon Profits (1958)" },
  { key: "TEMPLETON_CONTRARIAN", label: "Global Contrarian", investor: "John Templeton", tagline: "Sound businesses priced for pessimism.", reference: "The Templeton Touch (1983)" },
  { key: "GREENBLATT_MAGIC", label: "Magic Formula (approximated)", investor: "Joel Greenblatt", tagline: "High returns on capital combined with earnings yield.", reference: "The Little Book That Beats the Market (2006)" },
];

export const LONG_TERM_STRATEGY_KEYS = LONG_TERM_STRATEGY_META.map((item) => item.key);
export const LONG_TERM_STRATEGY_BY_KEY = Object.fromEntries(
  LONG_TERM_STRATEGY_META.map((item) => [item.key, item]),
) as Record<LongTermStrategyKey, LongTermStrategyMeta>;

export interface AnnualFundamentalPoint {
  period: string;
  revenue: number | null;
  netProfit: number | null;
  roce: number | null;
  operatingCashFlow?: number | null;
  freeCashFlow?: number | null;
}

export interface HistoricalFundamentalMetrics {
  revenueCagr3y: number | null;
  revenueCagr5y: number | null;
  profitCagr3y: number | null;
  profitCagr5y: number | null;
  medianRoce5y: number | null;
  medianCashConversion5y: number | null;
  medianFcfMargin5y: number | null;
  positiveProfitYearsRatio: number | null;
  historyYears: number;
  statementPeriods: number;
}

export interface LongTermFundamentals extends HistoricalFundamentalMetrics {
  peRatio: number | null;
  roe: number | null;
  debtToEquity: number | null;
  dividendYield: number | null;
  marketCap: number | null;
  freeCashFlowYield: number | null;
  currentRatio: number | null;
  quickRatio: number | null;
  netDebtToEbitda: number | null;
  interestCoverage: number | null;
  priceToBook: number | null;
  ebitEnterpriseValueYield: number | null;
  accrualRatioPct: number | null;
  revenueGrowthYoY: number | null;
  profitGrowthYoY: number | null;
  pctFrom52wHigh: number | null;
  reportAgeDays: number | null;
  sector: string | null;
}

type CriterionDirection = "higher" | "lower";

interface Criterion {
  label: string;
  field: keyof LongTermFundamentals | "pegRatio" | "earningsYield";
  target: number;
  direction: CriterionDirection;
  weight: number;
  description: string;
}

export interface CriterionOutcome {
  label: string;
  passed: boolean;
  dataMissing: boolean;
  description: string;
  value: number | null;
  score: number;
}

export interface LongTermScore {
  key: LongTermStrategyKey;
  matchScore: number;
  rawScore: number;
  confidence: number;
  matchedCriteria: number;
  availableCriteria: number;
  totalCriteria: number;
  eligible: boolean;
  eligibilityReason: string | null;
  outcomes: CriterionOutcome[];
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function normalizedGrowth(primary: number | null, fallback: number | null): number | null {
  const value = primary ?? fallback;
  return value === null ? null : clamp(value, -100, 100);
}

function syntheticValue(f: LongTermFundamentals, field: Criterion["field"]): number | null {
  if (field === "earningsYield") return f.peRatio !== null && f.peRatio > 0 ? 100 / f.peRatio : null;
  if (field === "pegRatio") {
    const growth = normalizedGrowth(f.profitCagr3y, f.profitGrowthYoY);
    return f.peRatio !== null && f.peRatio > 0 && growth !== null && growth > 0
      ? f.peRatio / Math.min(growth, 50)
      : null;
  }
  if (field === "revenueCagr3y") return normalizedGrowth(f.revenueCagr3y, f.revenueGrowthYoY);
  if (field === "profitCagr3y") return normalizedGrowth(f.profitCagr3y, f.profitGrowthYoY);
  return f[field] as number | null;
}

function smoothCriterionScore(value: number, target: number, direction: CriterionDirection): number {
  if (target === 0) return direction === "higher" ? (value > 0 ? 100 : 0) : (value <= 0 ? 100 : 0);
  const signedDistance = direction === "higher" ? value / target - 1 : 1 - value / target;
  return clamp(100 / (1 + Math.exp(-3.2 * signedDistance)), 0, 100);
}

function marketCapFloor(market: LongTermMarket, strategy: LongTermStrategyKey): number {
  if (strategy === "GRAHAM_DEFENSIVE") return market === "IN" ? 2000 : 200;
  return market === "IN" ? 500 : 50;
}

function criteriaFor(key: LongTermStrategyKey, market: LongTermMarket): Criterion[] {
  switch (key) {
    case "LYNCH_GARP":
      return [
        { label: "PEG ratio", field: "pegRatio", target: 1, direction: "lower", weight: 1, description: "Current P/E divided by capped three-year profit CAGR; YoY is only a fallback." },
        { label: "Three-year profit CAGR", field: "profitCagr3y", target: 15, direction: "higher", weight: 0.9, description: "Uses multi-year growth where available and caps base-effect outliers." },
        { label: "Three-year revenue CAGR", field: "revenueCagr3y", target: 10, direction: "higher", weight: 0.7, description: "Top-line durability should confirm earnings growth." },
        { label: "Debt-to-equity", field: "debtToEquity", target: 0.5, direction: "lower", weight: 0.8, description: "Lower leverage improves resilience." },
        { label: "P/E ratio", field: "peRatio", target: 25, direction: "lower", weight: 0.6, description: "Valuation discipline for a growth company." },
        { label: "Cash conversion", field: "medianCashConversion5y", target: 0.8, direction: "higher", weight: 0.6, description: "Median annual operating cash flow divided by net profit." },
      ];
    case "BUFFETT_MOAT":
      return [
        { label: "ROE", field: "roe", target: 15, direction: "higher", weight: 1, description: "Latest ROE, supported by multi-year return-on-capital evidence." },
        { label: "Five-year median ROCE", field: "medianRoce5y", target: 15, direction: "higher", weight: 1, description: "Median annual ROCE reduces single-period distortion." },
        { label: "Positive-profit history", field: "positiveProfitYearsRatio", target: 0.8, direction: "higher", weight: 0.9, description: "Share of observed annual periods with positive net profit." },
        { label: "Free-cash-flow yield", field: "freeCashFlowYield", target: 3, direction: "higher", weight: 0.8, description: "Latest free cash flow relative to current adjusted market value." },
        { label: "Debt-to-equity", field: "debtToEquity", target: 0.5, direction: "lower", weight: 0.8, description: "Restrained leverage." },
        { label: "Cash conversion", field: "medianCashConversion5y", target: 1, direction: "higher", weight: 0.9, description: "Median annual operating cash flow should support reported profit." },
        { label: "Net debt / EBITDA", field: "netDebtToEbitda", target: 2, direction: "lower", weight: 0.8, description: "Balance-sheet debt after cash relative to operating earnings." },
        { label: "Interest coverage", field: "interestCoverage", target: 5, direction: "higher", weight: 0.6, description: "EBIT should comfortably cover annual interest expense." },
      ];
    case "GRAHAM_DEFENSIVE":
      return [
        { label: "Adequate size", field: "marketCap", target: marketCapFloor(market, key), direction: "higher", weight: 0.5, description: "Modern liquidity and size floor." },
        { label: "P/E ratio", field: "peRatio", target: 15, direction: "lower", weight: 1, description: "Current price relative to TTM profit." },
        { label: "Positive-profit history", field: "positiveProfitYearsRatio", target: 1, direction: "higher", weight: 1, description: "Observed annual earnings should remain positive." },
        { label: "Debt-to-equity", field: "debtToEquity", target: 0.5, direction: "lower", weight: 0.8, description: "Conservative balance-sheet leverage." },
        { label: "Current ratio", field: "currentRatio", target: 1.5, direction: "higher", weight: 1, description: "Current assets should cover short-term liabilities with a margin of safety." },
        { label: "Price-to-book", field: "priceToBook", target: 1.5, direction: "lower", weight: 0.8, description: "Current market value relative to shareholders' equity." },
        { label: "Interest coverage", field: "interestCoverage", target: 3, direction: "higher", weight: 0.7, description: "Operating earnings should cover interest expense." },
        { label: "Dividend yield", field: "dividendYield", target: 1, direction: "higher", weight: 0.5, description: "Current yield; uninterrupted dividend history is not yet available." },
      ];
    case "FISHER_GROWTH":
      return [
        { label: "Three-year revenue CAGR", field: "revenueCagr3y", target: 15, direction: "higher", weight: 1, description: "Sustained top-line expansion." },
        { label: "Three-year profit CAGR", field: "profitCagr3y", target: 15, direction: "higher", weight: 0.9, description: "Sustained earnings expansion, not a single-quarter jump." },
        { label: "Five-year median ROCE", field: "medianRoce5y", target: 15, direction: "higher", weight: 0.9, description: "Capital efficiency across several annual periods." },
        { label: "ROE", field: "roe", target: 15, direction: "higher", weight: 0.7, description: "Current shareholder return." },
        { label: "Debt-to-equity", field: "debtToEquity", target: 0.4, direction: "lower", weight: 0.6, description: "Growth preferably financed internally." },
        { label: "Cash conversion", field: "medianCashConversion5y", target: 0.8, direction: "higher", weight: 0.7, description: "Growth in accounting profit should convert into operating cash." },
        { label: "FCF margin", field: "medianFcfMargin5y", target: 5, direction: "higher", weight: 0.6, description: "Median annual free cash flow as a share of revenue." },
      ];
    case "TEMPLETON_CONTRARIAN":
      return [
        { label: "P/E ratio", field: "peRatio", target: 12, direction: "lower", weight: 1, description: "Low current earnings multiple." },
        { label: "Below 52-week high", field: "pctFrom52wHigh", target: -30, direction: "lower", weight: 0.8, description: "Price pessimism, used only alongside financial resilience." },
        { label: "Positive-profit history", field: "positiveProfitYearsRatio", target: 0.8, direction: "higher", weight: 0.8, description: "Avoids treating structurally loss-making names as bargains." },
        { label: "Dividend yield", field: "dividendYield", target: 3, direction: "higher", weight: 0.6, description: "Income while waiting for normalization." },
        { label: "Debt-to-equity", field: "debtToEquity", target: 0.5, direction: "lower", weight: 0.7, description: "Survivability during distress." },
        { label: "Price-to-book", field: "priceToBook", target: 1.2, direction: "lower", weight: 0.8, description: "Asset-value support for a contrarian purchase." },
        { label: "Current ratio", field: "currentRatio", target: 1.2, direction: "higher", weight: 0.5, description: "Near-term liquidity while waiting for normalization." },
      ];
    case "GREENBLATT_MAGIC":
      return [
        { label: "Five-year median ROCE", field: "medianRoce5y", target: 25, direction: "higher", weight: 1, description: "Multi-year ROCE remains an approximation for Greenblatt return on capital." },
        { label: "EBIT / enterprise value", field: "ebitEnterpriseValueYield", target: 10, direction: "higher", weight: 1, description: "Annual EBIT divided by current market cap plus debt minus cash." },
        { label: "Positive-profit history", field: "positiveProfitYearsRatio", target: 0.8, direction: "higher", weight: 0.6, description: "Rejects transient or persistently loss-making businesses." },
        { label: "Market cap", field: "marketCap", target: marketCapFloor(market, key), direction: "higher", weight: 0.3, description: "Minimum liquidity floor." },
      ];
  }
}

function sectorEligibility(sector: string | null): string | null {
  const normalized = String(sector ?? "").toLowerCase();
  if (/financial|bank|insurance|reit|real estate/.test(normalized)) {
    return "Current ratios are not sector-correct for banks, insurers, financial companies, or REITs.";
  }
  return null;
}

function investabilityEligibility(fundamentals: LongTermFundamentals, market: LongTermMarket): string | null {
  const floor = marketCapFloor(market, "BUFFETT_MOAT");
  if (fundamentals.marketCap === null) return "Market capitalization is missing.";
  if (fundamentals.marketCap < floor) {
    return `Market capitalization is below the ${market === "IN" ? "INR 500 crore" : "USD 50 million"} investability floor.`;
  }
  return null;
}

export function scoreAgainstLongTermStrategy(
  fundamentals: LongTermFundamentals,
  key: LongTermStrategyKey,
  market: LongTermMarket,
): LongTermScore {
  const criteria = criteriaFor(key, market);
  const ineligibleReason = sectorEligibility(fundamentals.sector) ?? investabilityEligibility(fundamentals, market);
  let weightedScore = 0;
  let availableWeight = 0;
  let totalWeight = 0;
  let matchedCriteria = 0;
  let availableCriteria = 0;

  const outcomes = criteria.map((criterion): CriterionOutcome => {
    totalWeight += criterion.weight;
    const value = syntheticValue(fundamentals, criterion.field);
    if (value === null || !Number.isFinite(value)) {
      return { label: criterion.label, passed: false, dataMissing: true, description: criterion.description, value: null, score: 0 };
    }
    const score = smoothCriterionScore(value, criterion.target, criterion.direction);
    const passed = criterion.direction === "higher" ? value >= criterion.target : value <= criterion.target;
    availableWeight += criterion.weight;
    availableCriteria += 1;
    weightedScore += score * criterion.weight;
    if (passed) matchedCriteria += 1;
    return { label: criterion.label, passed, dataMissing: false, description: criterion.description, value, score: Math.round(score) };
  });

  const rawScore = availableWeight > 0 ? weightedScore / availableWeight : 0;
  const completeness = totalWeight > 0 ? availableWeight / totalWeight : 0;
  const ageFactor = fundamentals.reportAgeDays === null
    ? 0
    : fundamentals.reportAgeDays <= 180
      ? 1
      : fundamentals.reportAgeDays <= 365
        ? 0.75
        : 0.4;
  const historyFactor = fundamentals.historyYears >= 4 ? 1 : fundamentals.historyYears >= 2 ? 0.85 : 0.65;
  const confidence = Math.round(completeness * ageFactor * historyFactor * 100);
  const eligible = !ineligibleReason && confidence >= 60;
  const matchScore = eligible ? Math.round(rawScore * (0.7 + 0.3 * confidence / 100)) : 0;

  return {
    key,
    matchScore,
    rawScore: Math.round(rawScore),
    confidence,
    matchedCriteria,
    availableCriteria,
    totalCriteria: criteria.length,
    eligible,
    eligibilityReason: ineligibleReason ?? (confidence < 60 ? "Insufficient or stale evidence for this strategy." : null),
    outcomes,
  };
}

export function scoreAllLongTermStrategies(
  fundamentals: LongTermFundamentals,
  market: LongTermMarket,
): LongTermScore[] {
  return LONG_TERM_STRATEGY_KEYS.map((key) => scoreAgainstLongTermStrategy(fundamentals, key, market));
}
