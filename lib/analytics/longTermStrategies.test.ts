import { describe, expect, it } from "vitest";
import {
  deriveHistoricalMetrics,
  scoreAgainstLongTermStrategy,
  type LongTermFundamentals,
} from "./longTermStrategies";

const fundamentals = (overrides: Partial<LongTermFundamentals> = {}): LongTermFundamentals => ({
  peRatio: 18,
  roe: 20,
  debtToEquity: 0.2,
  dividendYield: 1.5,
  marketCap: 10_000,
  freeCashFlowYield: 4,
  currentRatio: 2,
  quickRatio: 1.4,
  netDebtToEbitda: 1,
  interestCoverage: 8,
  priceToBook: 1.2,
  ebitEnterpriseValueYield: 12,
  accrualRatioPct: 2,
  revenueGrowthYoY: 20,
  profitGrowthYoY: 25,
  pctFrom52wHigh: -10,
  reportAgeDays: 90,
  sector: "Industrials",
  revenueCagr3y: 16,
  revenueCagr5y: 14,
  profitCagr3y: 18,
  profitCagr5y: 16,
  medianRoce5y: 22,
  medianCashConversion5y: 1.1,
  medianFcfMargin5y: 8,
  positiveProfitYearsRatio: 1,
  historyYears: 5,
  statementPeriods: 5,
  ...overrides,
});

describe("deriveHistoricalMetrics", () => {
  it("derives multi-year CAGR, median ROCE, and earnings consistency", () => {
    const result = deriveHistoricalMetrics([
      { period: "2025-03-31", revenue: 160, netProfit: 32, roce: 24, operatingCashFlow: 36, freeCashFlow: 20 },
      { period: "2024-03-31", revenue: 145, netProfit: 27, roce: 20, operatingCashFlow: 29, freeCashFlow: 17 },
      { period: "2023-03-31", revenue: 125, netProfit: 22, roce: 18, operatingCashFlow: 24, freeCashFlow: 14 },
      { period: "2022-03-31", revenue: 100, netProfit: 16, roce: 16, operatingCashFlow: 18, freeCashFlow: 10 },
      { period: "2021-03-31", revenue: 90, netProfit: 14, roce: 14, operatingCashFlow: 15, freeCashFlow: 9 },
      { period: "2020-03-31", revenue: 80, netProfit: 10, roce: 12, operatingCashFlow: 11, freeCashFlow: 8 },
    ]);
    expect(result.revenueCagr3y).toBeCloseTo(16.96, 1);
    expect(result.profitCagr5y).toBeCloseTo(26.18, 1);
    expect(result.medianRoce5y).toBe(17);
    expect(result.medianCashConversion5y).toBeCloseTo(1.09, 1);
    expect(result.medianFcfMargin5y).toBeCloseTo(10.6, 1);
    expect(result.statementPeriods).toBe(6);
    expect(result.positiveProfitYearsRatio).toBe(1);
    expect(result.historyYears).toBe(5);
  });

  it("does not manufacture CAGR from losses or insufficient history", () => {
    const result = deriveHistoricalMetrics([
      { period: "2025-03-31", revenue: 100, netProfit: 10, roce: 12 },
      { period: "2024-03-31", revenue: 90, netProfit: -2, roce: 8 },
    ]);
    expect(result.revenueCagr3y).toBeNull();
    expect(result.profitCagr3y).toBeNull();
    expect(result.positiveProfitYearsRatio).toBeNull();
  });

  it("keeps missing statement values null instead of treating them as zero", () => {
    const result = deriveHistoricalMetrics([
      { period: "2025-03-31", revenue: 100, netProfit: 10, roce: 12, operatingCashFlow: null, freeCashFlow: null },
      { period: "2024-03-31", revenue: 90, netProfit: 9, roce: 11 },
      { period: "2023-03-31", revenue: 80, netProfit: 8, roce: 10 },
    ]);
    expect(result.medianCashConversion5y).toBeNull();
    expect(result.medianFcfMargin5y).toBeNull();
    expect(result.statementPeriods).toBe(0);
  });
});

describe("long-term strategy scoring", () => {
  it("uses continuous scores rather than saturating every passing criterion at 100", () => {
    const adequate = scoreAgainstLongTermStrategy(fundamentals(), "BUFFETT_MOAT", "IN");
    const excellent = scoreAgainstLongTermStrategy(
      fundamentals({ roe: 35, medianRoce5y: 35, freeCashFlowYield: 8, debtToEquity: 0.05 }),
      "BUFFETT_MOAT",
      "IN",
    );
    expect(adequate.matchScore).toBeLessThan(excellent.matchScore);
    expect(excellent.matchScore).toBeLessThanOrEqual(100);
  });

  it("reduces confidence when required evidence is missing", () => {
    const score = scoreAgainstLongTermStrategy(
      fundamentals({ medianRoce5y: null, freeCashFlowYield: null, historyYears: 1 }),
      "BUFFETT_MOAT",
      "IN",
    );
    expect(score.confidence).toBeLessThan(60);
    expect(score.eligible).toBe(false);
  });

  it("does not grant a Graham match without balance-sheet evidence", () => {
    const score = scoreAgainstLongTermStrategy(
      fundamentals({ currentRatio: null, priceToBook: null, interestCoverage: null }),
      "GRAHAM_DEFENSIVE",
      "IN",
    );
    expect(score.confidence).toBeLessThan(70);
    expect(score.outcomes.find((outcome) => outcome.label === "Current ratio")?.dataMissing).toBe(true);
  });

  it("rejects stale evidence", () => {
    const score = scoreAgainstLongTermStrategy(
      fundamentals({ reportAgeDays: 500 }),
      "LYNCH_GARP",
      "US",
    );
    expect(score.confidence).toBeLessThan(60);
    expect(score.eligible).toBe(false);
  });

  it("excludes financial companies until sector-correct ratios are available", () => {
    const score = scoreAgainstLongTermStrategy(
      fundamentals({ sector: "Financial Services" }),
      "GRAHAM_DEFENSIVE",
      "IN",
    );
    expect(score.eligible).toBe(false);
    expect(score.eligibilityReason).toContain("sector-correct");
  });

  it("excludes companies below the market investability floor", () => {
    const score = scoreAgainstLongTermStrategy(
      fundamentals({ marketCap: 100 }),
      "BUFFETT_MOAT",
      "IN",
    );
    expect(score.eligible).toBe(false);
    expect(score.eligibilityReason).toContain("investability floor");
  });

  it("caps one-year growth fallback so base effects cannot create an absurd PEG", () => {
    const score = scoreAgainstLongTermStrategy(
      fundamentals({ profitCagr3y: null, profitGrowthYoY: 1000 }),
      "LYNCH_GARP",
      "IN",
    );
    const peg = score.outcomes.find((outcome) => outcome.label === "PEG ratio");
    expect(peg?.value).toBeCloseTo(0.36, 2);
    expect(Number.isFinite(peg?.score)).toBe(true);
  });
});
