import { describe, expect, it } from "vitest";
import { suggestFundMapping, type SnapshotSchemeForMapping, type UserFundForMapping } from "./fundMapping";

const fund = (overrides: Partial<UserFundForMapping>): UserFundForMapping => ({
  holdingId: "h1",
  assetId: "a1",
  fundName: "HDFC Flexi Cap Fund Direct Growth",
  isin: "INF179K01BE2",
  amc: "HDFC MF",
  currentValue: 100000,
  mappedSchemeCode: null,
  mappingStatus: null,
  ...overrides,
});

const snapshot = (overrides: Partial<SnapshotSchemeForMapping>): SnapshotSchemeForMapping => ({
  schemeCode: "HDFC_FLEXI_CAP",
  name: "HDFC Flexi Cap Fund",
  isin: "INF179K01BE2",
  amc: "HDFC MF",
  category: "Flexi Cap",
  snapshotMonth: "2026-06-01",
  holdingCount: 72,
  ...overrides,
});

describe("suggestFundMapping", () => {
  it("suggests a single exact ISIN match with highest confidence", () => {
    const result = suggestFundMapping(fund({}), [snapshot({})]);

    expect(result.status).toBe("pending");
    expect(result.method).toBe("isin_exact");
    expect(result.schemeCode).toBe("HDFC_FLEXI_CAP");
    expect(result.confidence).toBe(1);
  });

  it("marks exact ISIN matches ambiguous when multiple schemes match", () => {
    const result = suggestFundMapping(fund({}), [
      snapshot({ schemeCode: "A" }),
      snapshot({ schemeCode: "B" }),
    ]);

    expect(result.status).toBe("ambiguous");
    expect(result.method).toBe("ambiguous_isin");
    expect(result.candidates).toHaveLength(2);
  });

  it("suggests high-confidence name similarity within the same AMC", () => {
    const result = suggestFundMapping(
      fund({ isin: null, fundName: "Parag Parikh Flexi Cap Fund Growth", amc: "PPFAS" }),
      [
        snapshot({ schemeCode: "PPFAS_FLEXI", name: "Parag Parikh Flexi Cap Fund", isin: null, amc: "PPFAS Mutual Fund" }),
        snapshot({ schemeCode: "HDFC_SMALL", name: "HDFC Small Cap Fund", isin: null, amc: "HDFC MF" }),
      ],
    );

    expect(result.status).toBe("pending");
    expect(result.method).toBe("name_similarity");
    expect(result.schemeCode).toBe("PPFAS_FLEXI");
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("returns no-snapshot when the AMC has no loaded disclosure", () => {
    const result = suggestFundMapping(
      fund({ isin: null, fundName: "DSP Small Cap Fund", amc: "DSP MF" }),
      [snapshot({ schemeCode: "HDFC", name: "HDFC Flexi Cap Fund", isin: null, amc: "HDFC MF" })],
    );

    expect(result.status).toBe("no_snapshot");
    expect(result.schemeCode).toBeNull();
  });
});
