import { describe, expect, it } from "vitest";
import { shouldRefreshLiveQuotes } from "./liveQuoteRefresh";

describe("shouldRefreshLiveQuotes", () => {
  it("allows Breeze refreshes during the NSE cash session", () => {
    expect(shouldRefreshLiveQuotes("IN", new Date("2026-10-30T09:59:00Z"))).toBe(true); // 15:29 IST
  });

  it("stops Breeze refreshes after the NSE cash session", () => {
    expect(shouldRefreshLiveQuotes("IN", new Date("2026-10-30T14:10:00Z"))).toBe(false); // 19:40 IST
  });

  it("allows US live refreshes during the regular New York session", () => {
    expect(shouldRefreshLiveQuotes("US", new Date("2026-10-30T14:10:00Z"))).toBe(true); // 10:10 ET / 19:40 IST
  });

  it("stops US live refreshes after the regular New York session", () => {
    expect(shouldRefreshLiveQuotes("US", new Date("2026-10-30T21:00:00Z"))).toBe(false); // 17:00 ET
  });

  it("applies US daylight-saving time through the exchange timezone", () => {
    expect(shouldRefreshLiveQuotes("US", new Date("2026-12-01T15:00:00Z"))).toBe(true); // 10:00 EST
    expect(shouldRefreshLiveQuotes("US", new Date("2026-12-01T21:30:00Z"))).toBe(false); // 16:30 EST
  });
});
