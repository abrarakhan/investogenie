import { describe, expect, it } from "vitest";
import {
  normalizePortfolioName,
  parseAmfiSchemeMaster,
  resolveSchemeFamilies,
} from "./amfiSchemeMaster.mjs";

const SAMPLE = `Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date

Open Ended Schemes(Equity Scheme - Flexi Cap Fund)

HDFC Mutual Fund

101001;INF179K01608;-;HDFC Flexi Cap Fund - Regular Plan - Growth;2043.1000;24-Jul-2026
101002;INF179K01BE2;-;HDFC Flexi Cap Fund - Direct Plan - Growth;2310.2000;24-Jul-2026
101003;INF179K01AA1;INF179K01AA2;HDFC Flexi Cap Fund - Regular Plan - IDCW;102.5000;24-Jul-2026
`;

describe("AMFI scheme-master parser", () => {
  it("retains AMC/category context and both ISIN columns", () => {
    const rows = parseAmfiSchemeMaster(SAMPLE);
    expect(rows).toHaveLength(3);
    expect(rows[2]).toMatchObject({
      amc: "HDFC Mutual Fund",
      schemeCategory: "Open Ended Schemes(Equity Scheme - Flexi Cap Fund)",
      isinPayoutOrGrowth: "INF179K01AA1",
      isinReinvestment: "INF179K01AA2",
      planType: "REGULAR",
      optionType: "IDCW",
    });
  });

  it("groups plan and option variants under one portfolio identity", () => {
    const rows = parseAmfiSchemeMaster(SAMPLE);
    expect(new Set(rows.map((row) => row.portfolioKey)).size).toBe(1);
    expect(normalizePortfolioName(rows[0].schemeName)).toBe("HDFC FLEXI CAP FUND");
  });

  it("resolves a snapshot by any plan ISIN and returns every family variant", () => {
    const rows = parseAmfiSchemeMaster(SAMPLE);
    const resolved = resolveSchemeFamilies(rows, [{
      schemeCode: "HDFC_FLEXI_CAP",
      name: "HDFC Flexi Cap Fund",
      amc: "HDFC MF",
      isin: "INF179K01BE2",
    }]);
    expect(resolved.get("HDFC_FLEXI_CAP")?.method).toBe("existing_isin");
    expect(resolved.get("HDFC_FLEXI_CAP")?.records).toHaveLength(3);
  });

  it("uses a conservative same-AMC normalized-name fallback", () => {
    const rows = parseAmfiSchemeMaster(SAMPLE);
    const resolved = resolveSchemeFamilies(rows, [{
      schemeCode: "HDFC_FLEXI_CAP",
      name: "HDFC Flexi Cap Fund",
      amc: "HDFC Mutual Fund",
      isin: null,
    }]);
    expect(resolved.get("HDFC_FLEXI_CAP")?.method).toBe("normalized_name");
  });
});
