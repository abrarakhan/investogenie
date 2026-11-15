import { describe, expect, it } from "vitest";
import { MOBILE_FEATURES, supportedMobileFeatures } from "./registry";

describe("mobile feature registry", () => {
  it("keeps generic server-driven screens without a native implementation", () => {
    expect(supportedMobileFeatures([
      { key: "future", title: "Future", tabLabel: "Future", kind: "cards" },
    ])).toHaveLength(1);
  });

  it("hides unsupported dedicated screens", () => {
    expect(supportedMobileFeatures([
      { key: "future-native", title: "Future", tabLabel: "Future", kind: "native" },
    ])).toEqual([]);
  });

  it("has unique fallback feature keys", () => {
    expect(new Set(MOBILE_FEATURES.map((feature) => feature.key)).size).toBe(MOBILE_FEATURES.length);
  });
});
