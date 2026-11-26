import { describe, expect, it } from "vitest";
import { resolveDeepLink } from "../mobile/src/app/navigation";

describe("notification navigation", () => {
  it("preserves the market on a News & AI push", () => {
    expect(resolveDeepLink({ screen: "news-swing", market: "US" })).toEqual({
      destination: "strategies",
      screenKey: "news-swing",
      market: "US",
    });
  });

  it("leaves the current market alone when the payload market is invalid", () => {
    expect(resolveDeepLink({ screen: "news-swing", market: "OTHER" }).market).toBeUndefined();
  });
});
