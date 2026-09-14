import { describe, expect, it } from "vitest";
import { fundDisplayIdentity } from "./displayName";

describe("fundDisplayIdentity", () => {
  it("shows Franklin as fund house plus its actual scheme", () => {
    expect(fundDisplayIdentity(
      "Franklin India Focused Equity Fund - Growth",
      "Franklin Templeton India",
    )).toEqual({
      amc: "Franklin Templeton",
      scheme: "India Focused Equity Fund",
      label: "Franklin Templeton · India Focused Equity Fund",
    });
  });

  it("removes plan and option labels from the display name", () => {
    expect(fundDisplayIdentity("HDFC Flexi Cap Fund - Regular Plan - Growth").scheme)
      .toBe("Flexi Cap Fund");
    expect(fundDisplayIdentity("Nippon India Small Cap Fund - Growth Plan Growth Option").scheme)
      .toBe("Small Cap Fund");
  });

  it("preserves strategy words that belong to the scheme", () => {
    expect(fundDisplayIdentity(
      "ICICI Prudential Transportation and Logistics Fund - Growth",
    ).scheme).toBe("Transportation and Logistics Fund");
    expect(fundDisplayIdentity(
      "SBI Children's Fund - Investment Plan Regular Growth",
    ).scheme).toBe("Children's Fund - Investment Plan");
  });
});
