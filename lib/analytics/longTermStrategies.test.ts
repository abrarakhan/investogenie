import { describe, expect, it } from "vitest";
import {
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
