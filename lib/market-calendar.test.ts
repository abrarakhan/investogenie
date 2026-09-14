import { describe, expect, it } from "vitest";
import {
  isMarketHoliday,
  isMarketOpenNow,
  latestExpectedSessionDate,
  tradingSessionLag,
} from "./market-calendar.mjs";

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
});
