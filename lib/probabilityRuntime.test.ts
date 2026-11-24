import { describe, expect, it } from "vitest";
import { probabilityFreshnessCutoffs } from "./probability-runtime";

describe("probabilityFreshnessCutoffs holiday awareness", () => {
  it("falls back to previous NSE trading session on an India exchange holiday (2026-11-24)", () => {
    // 2026-11-24 11:30 IST (06:00 UTC) — Guru Nanak Jayanti NSE holiday
    const holidayMidday = new Date("2026-11-24T06:00:00Z");
    const cutoffs = probabilityFreshnessCutoffs("IN", holidayMidday);
    expect(cutoffs.expectedSession).toBe("2026-11-23");
    expect(cutoffs.quoteCutoff).toBe("2026-11-23");
    expect(cutoffs.ohlcvCutoff).toBe("2026-11-20");
  });

  it("falls back to previous US trading session on a US exchange holiday (2026-11-26 Thanksgiving)", () => {
    // 2026-11-26 11:30 EST (16:30 UTC) — US Thanksgiving holiday
    const thanksgiving = new Date("2026-11-26T16:30:00Z");
    const cutoffs = probabilityFreshnessCutoffs("US", thanksgiving);
    expect(cutoffs.expectedSession).toBe("2026-11-25");
    expect(cutoffs.quoteCutoff).toBe("2026-11-25");
    expect(cutoffs.ohlcvCutoff).toBe("2026-11-24");
  });

  it("uses previous session during India market hours and current session after 18:30 IST publication", () => {
    // 2026-11-23 11:00 IST (05:30 UTC) — regular NSE trading day mid-session
    const intraday = probabilityFreshnessCutoffs("IN", new Date("2026-11-23T05:30:00Z"));
    expect(intraday.quoteCutoff).toBe("2026-11-20");

    // 2026-11-23 19:00 IST (13:30 UTC) — after 18:30 IST bhavcopy publication
    const postClose = probabilityFreshnessCutoffs("IN", new Date("2026-11-23T13:30:00Z"));
    expect(postClose.quoteCutoff).toBe("2026-11-23");
    expect(postClose.ohlcvCutoff).toBe("2026-11-20");
  });
});
