import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isMarketHoliday,
  isMarketOpenNow,
  latestExpectedSessionDate,
  latestSignalSessionDate,
  marketHolidayDates,
  refreshMarketHolidays,
  tradingDayOffset,
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
    expect(marketHolidayDates("IN")).toContain("2026-09-14");
  });

  it("keeps Friday as the expected session through the closed weekend", () => {
    expect(latestExpectedSessionDate("IN", new Date("2026-09-12T07:00:00Z"))).toBe("2026-09-11");
    expect(latestExpectedSessionDate("IN", new Date("2026-09-13T07:00:00Z"))).toBe("2026-09-11");
  });

  it("recognizes the Sunday Diwali Muhurat session and its exact shortened hours", () => {
    const beforeOpen = new Date("2026-11-08T08:49:00Z"); // 14:19 IST
    const duringSession = new Date("2026-11-08T09:25:00Z"); // 14:55 IST
    const afterClose = new Date("2026-11-08T10:01:00Z"); // 15:31 IST

    expect(isMarketHoliday("IN", duringSession)).toBe(false);
    expect(isMarketOpenNow("IN", beforeOpen)).toBe(false);
    expect(isMarketOpenNow("IN", duringSession)).toBe(true);
    expect(isMarketOpenNow("IN", afterClose)).toBe(false);
    expect(tradingDayOffset("IN", "2026-11-06", 1)).toBe("2026-11-08");
    expect(tradingDayOffset("IN", "2026-11-08", 1)).toBe("2026-11-09");
    expect(tradingSessionLag("IN", "2026-11-06", "2026-11-09")).toBe(2);
  });

  it("waits for each market's EOD publication window before requiring the new signal session", () => {
    expect(latestSignalSessionDate("IN", new Date("2026-11-05T12:00:00Z"))).toBe("2026-11-04");
    expect(latestSignalSessionDate("IN", new Date("2026-11-05T13:01:00Z"))).toBe("2026-11-05");
    expect(latestSignalSessionDate("US", new Date("2026-11-05T21:30:00Z"))).toBe("2026-11-04");
    expect(latestSignalSessionDate("US", new Date("2026-11-05T22:01:00Z"))).toBe("2026-11-05");
  });

  it("counts missing exchange sessions rather than calendar days", () => {
    expect(tradingSessionLag("IN", "2026-09-11", "2026-09-14")).toBe(0);
    expect(tradingSessionLag("IN", "2026-09-11", "2026-09-15")).toBe(1);
  });

  it("advances by trading sessions across weekends and exchange holidays", () => {
    expect(tradingDayOffset("IN", "2026-10-16", 1)).toBe("2026-10-19");
    expect(tradingDayOffset("IN", "2026-10-16", 2)).toBe("2026-10-21");
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
