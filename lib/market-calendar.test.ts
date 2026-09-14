import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isMarketHoliday,
  isMarketOpenNow,
  latestExpectedSessionDate,
  refreshMarketHolidays,
  tradingSessionLag,
} from "./market-calendar.mjs";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("market calendar", () => {
  it("recognizes the 14 September 2026 Indian exchange holiday", () => {
    const holiday = new Date("2026-09-14T06:00:00Z");
    expect(isMarketHoliday("IN", holiday)).toBe(true);
    expect(isMarketOpenNow("IN", holiday)).toBe(false);
    expect(latestExpectedSessionDate("IN", holiday, 18 * 60)).toBe("2026-09-11");
  });

  it("counts missing exchange sessions rather than calendar days", () => {
    expect(tradingSessionLag("IN", "2026-09-11", "2026-09-14")).toBe(0);
    expect(tradingSessionLag("IN", "2026-09-11", "2026-09-15")).toBe(1);
  });

  it("recognizes US exchange holidays", () => {
    const laborDay = new Date("2026-09-07T15:00:00Z");
    expect(isMarketHoliday("US", laborDay)).toBe(true);
    expect(isMarketOpenNow("US", laborDay)).toBe(false);
  });

  it("learns capital-market holidays from the official NSE calendar", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ CM: [{ tradingDate: "15-Jan-2027" }] }),
    }));

    expect(await refreshMarketHolidays("IN", true)).toBe(true);
    expect(isMarketHoliday("IN", new Date("2027-01-15T06:00:00Z"))).toBe(true);
    expect(latestExpectedSessionDate("IN", new Date("2027-01-15T13:00:00Z"))).toBe("2027-01-14");
  });
});
