import { describe, expect, it } from "vitest";
import { FIELD_BY_KEY } from "./fields";

describe("screener historical field registry", () => {
  it("allows one-day close change in point-in-time backtests", () => {
    expect(FIELD_BY_KEY.change_pct_1d).toMatchObject({
      column: "change_pct_1d",
      historical: true,
    });
  });

  it("exposes multi-year fundamentals and filed promoter changes", () => {
    expect(FIELD_BY_KEY.profit_cagr_3y?.label).toBe("Profit CAGR (3Y)");
    expect(FIELD_BY_KEY.revenue_cagr_5y?.label).toBe("Revenue CAGR (5Y)");
    expect(FIELD_BY_KEY.positive_profit_years_pct?.format).toBe("percent");
    expect(FIELD_BY_KEY.promoter_holding_change_qoq).toMatchObject({
      format: "percent",
      unit: "pp",
    });
  });
});
