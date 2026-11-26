import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearTacticalRadarCache,
  computeTacticalRadarInPython,
  getTacticalRadar,
  tacticalQuoteSessionCutoff,
  type PythonTacticalRadarInput,
} from "./tacticalRadar";
import { shutdownPythonStrategyWorkers } from "./pythonStrategyMath";

vi.mock("@/lib/db", () => ({
  query: vi.fn(),
  tenantQuery: vi.fn(),
}));

import { query, tenantQuery } from "@/lib/db";

const mockedQuery = vi.mocked(query);
const mockedTenantQuery = vi.mocked(tenantQuery);

afterEach(() => {
  clearTacticalRadarCache();
  vi.clearAllMocks();
});

describe("tacticalQuoteSessionCutoff (shared market calendar)", () => {
  it("uses previous expected trading session on India exchange holiday (2026-11-24)", () => {
    const holidayMiddayIst = new Date("2026-11-24T06:30:00Z"); // 12:00 IST on Guru Nanak Jayanti
    const cutoff = tacticalQuoteSessionCutoff("IN", holidayMiddayIst);
    expect(cutoff.marketOpen).toBe(false);
    expect(cutoff.expectedSession).toBe("2026-11-23");
    expect(cutoff.requiredQuoteDate).toBe("2026-11-23");
    expect(cutoff.timeZone).toBe("Asia/Kolkata");
  });

  it("requires current live session during India market hours", () => {
    const liveIst = new Date("2026-11-25T05:30:00Z"); // 11:00 IST regular session
    const cutoff = tacticalQuoteSessionCutoff("IN", liveIst);
    expect(cutoff.marketOpen).toBe(true);
    expect(cutoff.requiredQuoteDate).toBe("2026-11-25");
  });

  it("uses previous expected session on US Thanksgiving holiday (2026-11-26)", () => {
    const usHoliday = new Date("2026-11-26T16:00:00Z"); // 11:00 ET Thanksgiving
    const cutoff = tacticalQuoteSessionCutoff("US", usHoliday);
    expect(cutoff.marketOpen).toBe(false);
    expect(cutoff.expectedSession).toBe("2026-11-25");
    expect(cutoff.requiredQuoteDate).toBe("2026-11-25");
  });
});

describe("computeTacticalRadarInPython (Python-authoritative engine)", () => {
  const baseInput: PythonTacticalRadarInput = {
    market: "IN",
    priceFloor: 20,
    limitPerBucket: 10,
    breadth: { advancers: 1200, decliners: 800, asOfDate: "2026-11-26" },
    benchmark: { ticker: "NIFTY", price: 25884.5, changePct: 0.45, aboveSma50: true },
    excludedAssetIds: [],
    excludedCounts: { adverseNews: 0, resultsBlackout: 0 },
    newsNotes: {},
    strongRows: [],
    obsRows: [],
    trendRows: [],
    swingRows: [],
    pullbackRows: [
      {
        assetId: "a-ace",
        ticker: "ACE",
        name: "Action Construction",
        exchange: "NSE",
        close: 1200,
        livePrice: 1200,
        rsi14: 60.4,
        atrPct: 4.0,
        volumeRatio: 1.07,
        return20d: 14.8,
        distanceSma20Pct: 2.1,
        distanceSma200Pct: 18.0,
        asOfDate: "2026-11-26",
      },
    ],
    snapbackRows: [
      {
        assetId: "a-shaily",
        ticker: "SHAILY",
        name: "Shaily Engineering",
        exchange: "NSE",
        close: 2905,
        sma20: 3150,
        livePrice: 2905,
        liveChangePct: 1.2,
        rsi14: 36.6,
        atrPct: 4.0,
        volumeRatio: 2.66,
        return5d: -5.9,
        distanceSma20Pct: -7.8,
        distanceSma200Pct: 6.5,
        asOfDate: "2026-11-26",
      },
    ],
  };

  it("returns UNVERIFIED when benchmark 50DMA is unknown even with strong breadth", async () => {
    const res = await computeTacticalRadarInPython({
      ...baseInput,
      benchmark: { ...baseInput.benchmark, aboveSma50: null },
    });
    expect(res.context.regime).toBe("UNVERIFIED");
    expect(res.context.breadthPct).toBe(60);
  });

  it("returns UNVERIFIED when breadth has 0 fresh session quotes", async () => {
    const res = await computeTacticalRadarInPython({
      ...baseInput,
      breadth: { advancers: 0, decliners: 0, asOfDate: null },
    });
    expect(res.context.regime).toBe("UNVERIFIED");
    expect(res.context.breadthPct).toBeNull();
  });

  it("computes regime, ranking, and tighter snapback ATR stops in Python", async () => {
    const res = await computeTacticalRadarInPython(baseInput);
    expect(res.context.regime).toBe("TREND_BREAKOUT");
    expect(res.buckets.MID_TREND_PULLBACK[0].ticker).toBe("ACE");
    expect(res.buckets.OVERSOLD_SNAPBACK[0].ticker).toBe("SHAILY");
    expect(res.buckets.OVERSOLD_SNAPBACK[0].riskPct).toBeLessThan(
      res.buckets.MID_TREND_PULLBACK[0].riskPct,
    );
  });
});

describe("getTacticalRadar tenant isolation and warm cache", () => {
  it("isolates tenant observations and cache entries across two users", async () => {
    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("max(td.date)")) return [{ max_date: "2026-11-26" }] as never;
      if (sql.includes("as advancers")) return [{ advancers: 1200, decliners: 800, latest_as_of: "2026-11-26T10:00:00Z" }] as never;
      if (sql.includes("distance_sma_50_pct")) return [{ ticker: "NIFTY", price: 25884.5, change_pct: 0.45, distance_sma_50_pct: 2.1 }] as never;
      return [] as never;
    });

    mockedTenantQuery.mockImplementation(async (userId: string) => {
      if (userId === "user-alpha") {
        return [{
          asset_id: "a-alpha",
          ticker: "ALPHAONLY",
          name: "Alpha Stock",
          exchange: "NSE",
          sector: "IT",
          engine: "MOMENTUM_IGNITION",
          status: "EARLY_WATCH",
          observed_at: "2026-11-26T09:00:00Z",
          live_price: 500,
          live_change_pct: 1.5,
          close: 500,
          rsi_14: 60,
          atr_pct_14: 3.2,
          volume_ratio_20: 1.8,
          return_5d: 4,
          return_20d: 12,
          distance_sma_20_pct: 2,
          distance_sma_200_pct: 10,
          tech_date: "2026-11-26",
        }] as never;
      }
      if (userId === "user-beta") {
        return [{
          asset_id: "a-beta",
          ticker: "BETAONLY",
          name: "Beta Stock",
          exchange: "NSE",
          sector: "Pharma",
          engine: "MOMENTUM_IGNITION_V2",
          status: "PRE_IGNITION",
          observed_at: "2026-11-26T09:00:00Z",
          live_price: 800,
          live_change_pct: 2.1,
          close: 800,
          rsi_14: 62,
          atr_pct_14: 3.0,
          volume_ratio_20: 2.0,
          return_5d: 5,
          return_20d: 14,
          distance_sma_20_pct: 3,
          distance_sma_200_pct: 15,
          tech_date: "2026-11-26",
        }] as never;
      }
      return [] as never;
    });

    const alpha = await getTacticalRadar("IN", "user-alpha", 10, new Date("2026-11-26T12:00:00Z"));
    const beta = await getTacticalRadar("IN", "user-beta", 10, new Date("2026-11-26T12:00:00Z"));
    // Warm-cache hits must also remain tenant-isolated
    const alphaWarm = await getTacticalRadar("IN", "user-alpha", 10, new Date("2026-11-26T12:00:00Z"));

    expect(alpha.buckets.NEAR_TRIGGER.map((c) => c.ticker)).toEqual(["ALPHAONLY"]);
    expect(beta.buckets.NEAR_TRIGGER.map((c) => c.ticker)).toEqual(["BETAONLY"]);
    expect(alphaWarm.buckets.NEAR_TRIGGER.map((c) => c.ticker)).toEqual(["ALPHAONLY"]);
    expect(mockedTenantQuery).toHaveBeenCalledTimes(2);
    shutdownPythonStrategyWorkers();
  });

  it("rejects calls without an authenticated userId", async () => {
    await expect(getTacticalRadar("IN", "")).rejects.toThrow(/userId/i);
  });
});
