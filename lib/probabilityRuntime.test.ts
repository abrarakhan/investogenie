import { describe, expect, it } from "vitest";
import { probabilityFreshnessCutoffs } from "./probability-runtime";

describe("probabilityFreshnessCutoffs fail-closed holiday & session awareness", () => {
  it("India regular market hours: requires previous completed OHLCV and current live quote", () => {
    // 2026-11-23 11:00 IST (05:30 UTC) — Monday active NSE session
    const cutoffs = probabilityFreshnessCutoffs("IN", new Date("2026-11-23T05:30:00Z"));
    expect(cutoffs.marketOpen).toBe(true);
    expect(cutoffs.expectedCompletedSession).toBe("2026-11-20");
    expect(cutoffs.requiredOhlcvDate).toBe("2026-11-20");
    expect(cutoffs.requiredQuoteDate).toBe("2026-11-23");
  });

  it("India after 18:30 IST EOD publication: requires current session OHLCV and quote", () => {
    // 2026-11-23 19:00 IST (13:30 UTC)
    const cutoffs = probabilityFreshnessCutoffs("IN", new Date("2026-11-23T13:30:00Z"));
    expect(cutoffs.marketOpen).toBe(false);
    expect(cutoffs.expectedCompletedSession).toBe("2026-11-23");
    expect(cutoffs.requiredOhlcvDate).toBe("2026-11-23");
    expect(cutoffs.requiredQuoteDate).toBe("2026-11-23");
  });

  it("India exchange holiday (2026-11-24): requires 2026-11-23 OHLCV and quote (rejects 2026-11-20)", () => {
    // 2026-11-24 11:30 IST (06:00 UTC) — Guru Nanak Jayanti NSE holiday
    const cutoffs = probabilityFreshnessCutoffs("IN", new Date("2026-11-24T06:00:00Z"));
    expect(cutoffs.marketOpen).toBe(false);
    expect(cutoffs.expectedCompletedSession).toBe("2026-11-23");
    expect(cutoffs.requiredOhlcvDate).toBe("2026-11-23");
    expect(cutoffs.requiredQuoteDate).toBe("2026-11-23");
  });

  it("India weekend (2026-11-22 Sunday): requires Friday 2026-11-20 OHLCV and quote", () => {
    const cutoffs = probabilityFreshnessCutoffs("IN", new Date("2026-11-22T06:00:00Z"));
    expect(cutoffs.marketOpen).toBe(false);
    expect(cutoffs.expectedCompletedSession).toBe("2026-11-20");
    expect(cutoffs.requiredOhlcvDate).toBe("2026-11-20");
    expect(cutoffs.requiredQuoteDate).toBe("2026-11-20");
  });

  it("India Diwali Muhurat special session (2026-11-08 14:45 IST): treats session as open", () => {
    // 2026-11-08 14:45 IST = 09:15 UTC (within openMinutes 860..930)
    const cutoffs = probabilityFreshnessCutoffs("IN", new Date("2026-11-08T09:15:00Z"));
    expect(cutoffs.marketOpen).toBe(true);
    expect(cutoffs.requiredQuoteDate).toBe("2026-11-08");
    expect(cutoffs.requiredOhlcvDate).toBe("2026-11-06");
  });

  it("US regular market hours: requires previous completed OHLCV and current live quote", () => {
    // 2026-11-25 11:30 EST (16:30 UTC) — Wednesday open US session
    const cutoffs = probabilityFreshnessCutoffs("US", new Date("2026-11-25T16:30:00Z"));
    expect(cutoffs.marketOpen).toBe(true);
    expect(cutoffs.expectedCompletedSession).toBe("2026-11-24");
    expect(cutoffs.requiredOhlcvDate).toBe("2026-11-24");
    expect(cutoffs.requiredQuoteDate).toBe("2026-11-25");
  });

  it("US Thanksgiving holiday (2026-11-26): requires 2026-11-25 OHLCV and quote", () => {
    // 2026-11-26 11:30 EST (16:30 UTC)
    const cutoffs = probabilityFreshnessCutoffs("US", new Date("2026-11-26T16:30:00Z"));
    expect(cutoffs.marketOpen).toBe(false);
    expect(cutoffs.expectedCompletedSession).toBe("2026-11-25");
    expect(cutoffs.requiredOhlcvDate).toBe("2026-11-25");
    expect(cutoffs.requiredQuoteDate).toBe("2026-11-25");
  });

  it("US after 17:00 ET EOD publication: requires current session OHLCV and quote", () => {
    // 2026-11-25 18:00 EST (23:00 UTC)
    const cutoffs = probabilityFreshnessCutoffs("US", new Date("2026-11-25T23:00:00Z"));
    expect(cutoffs.marketOpen).toBe(false);
    expect(cutoffs.expectedCompletedSession).toBe("2026-11-25");
    expect(cutoffs.requiredOhlcvDate).toBe("2026-11-25");
    expect(cutoffs.requiredQuoteDate).toBe("2026-11-25");
  });
});
