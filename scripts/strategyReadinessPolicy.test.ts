import { describe, expect, it } from "vitest";
import { readinessMarkets } from "./strategy-readiness-policy.mjs";

describe("strategy readiness market selection", () => {
  it("checks both markets by default and when ALL is explicit", () => {
    expect(readinessMarkets()).toEqual(["IN", "US"]);
    expect(readinessMarkets(["--market", "ALL"])).toEqual(["IN", "US"]);
  });

  it("can audit India or the US independently", () => {
    expect(readinessMarkets(["--market", "IN"])).toEqual(["IN"]);
    expect(readinessMarkets(["--market=us"])).toEqual(["US"]);
  });

  it("fails closed for missing, invalid or unknown arguments", () => {
    expect(() => readinessMarkets(["--market"])).toThrow(/requires IN, US or ALL/);
    expect(() => readinessMarkets(["--market", "EU"])).toThrow(/Invalid market/);
    expect(() => readinessMarkets(["--all"])).toThrow(/Unknown argument/);
  });
});
