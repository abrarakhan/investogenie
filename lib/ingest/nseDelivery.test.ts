import { describe, expect, it } from "vitest";
import { bhavNumber, historyBackfillStart, looksLikeFund } from "@/lib/ingest/nseHistory";

/**
 * Deliverable quantity is the evidence the mid-way setups rest on, and almost every
 * way of getting it wrong produces a *stronger* signal rather than a weaker one: a
 * trade-to-trade series reads as 100% conviction, an ETF reads as permanent
 * accumulation, and a "-" parsed as NaN reads as whatever the database makes of it.
 * These tests pin the exclusions, not just the happy path.
 */

describe("bhavNumber", () => {
  it("coerces the exchange's absent marker to null rather than NaN", () => {
    expect(bhavNumber("-")).toBeNull();
    expect(bhavNumber(" - ")).toBeNull();
    expect(bhavNumber("")).toBeNull();
    expect(bhavNumber(undefined)).toBeNull();
  });

  it("reads ordinary numbers, including padded ones", () => {
    expect(bhavNumber("1234")).toBe(1234);
    expect(bhavNumber(" 56.78 ")).toBe(56.78);
    expect(bhavNumber("0")).toBe(0);
  });

  it("rejects anything that is not a number instead of returning NaN", () => {
    // NaN reaching a numeric column is the failure this guards: it is neither a
    // value nor an absence, and it compares false against every threshold.
    expect(bhavNumber("n/a")).toBeNull();
    expect(bhavNumber("1,234")).toBeNull();
  });
});

describe("looksLikeFund", () => {
  it("flags ETFs by ticker, which is how NSE lists most of them", () => {
    for (const ticker of ["NIFTYBEES", "GOLDBEES", "LIQUIDBEES", "MON100ETF", "SETFNIF50"]) {
      expect(looksLikeFund(ticker, null), ticker).toBe(true);
    }
  });

  it("flags REITs and InvITs, which settle like funds rather than companies", () => {
    expect(looksLikeFund("EMBASSYREIT", null)).toBe(true);
    expect(looksLikeFund("INDIGRIDINVIT", null)).toBe(true);
  });

  it("flags a fund whose ticker hides it but whose name does not", () => {
    expect(looksLikeFund("MAFANG", "Mirae Asset NYSE FANG+ ETF")).toBe(true);
  });

  it("leaves ordinary companies alone", () => {
    for (const [ticker, name] of [
      ["RELIANCE", "Reliance Industries Limited"],
      ["TCS", "Tata Consultancy Services Limited"],
      ["MEESHO", "Meesho Limited"],
      ["ANGELONE", "Angel One Limited"],
    ] as const) {
      expect(looksLikeFund(ticker, name), ticker).toBe(false);
    }
  });
});

describe("historyBackfillStart", () => {
  // Unchanged by this work, pinned here because the delivery write shares its loop:
  // a regression that narrowed the replay window would quietly stop backfilling
  // delivery for thinly traded stocks.
  const end = new Date("2026-11-17T00:00:00Z");

  it("replays a short recent window even when history is current", () => {
    expect(historyBackfillStart("2026-11-16", end).toISOString().slice(0, 10)).toBe("2026-11-09");
  });

  it("starts from the day after the stored maximum when that is older", () => {
    expect(historyBackfillStart("2026-10-01", end).toISOString().slice(0, 10)).toBe("2026-10-02");
  });

  it("honours an explicit start", () => {
    expect(historyBackfillStart("2026-11-16", end, "2026-01-05").toISOString().slice(0, 10))
      .toBe("2026-01-05");
  });
});
