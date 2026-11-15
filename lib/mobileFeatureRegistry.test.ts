import { describe, expect, it } from "vitest";
import { MOBILE_FEATURES, supportedMobileFeatures } from "../mobile/src/features/registry";
import { MOBILE_SCREEN_CATALOG } from "@/lib/mobileScreens";

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

  it("keeps the offline fallback aligned with the server catalog", () => {
    expect(MOBILE_FEATURES).toEqual(MOBILE_SCREEN_CATALOG);
  });
});
