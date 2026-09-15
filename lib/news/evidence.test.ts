import { describe, expect, it } from "vitest";
import { canonicalizeNewsUrl, enrichEvidence, sourceTrustScore } from "./evidence";

describe("news evidence quality", () => {
  it("removes tracking parameters from canonical URLs", () => {
    expect(canonicalizeNewsUrl("https://www.reuters.com/story/?utm_source=x&id=2#top"))
      .toBe("https://reuters.com/story?id=2");
  });
  it("scores official and unknown sources conservatively", () => {
    expect(sourceTrustScore("https://www.rbi.org.in/a")).toBe(100);
    expect(sourceTrustScore("https://example.test/a")).toBe(40);
  });
  it("requires an official source or independent reputable corroboration", () => {
    const base = { provider: "gnews" as const, providerArticleId: null, description: null, sourceName: null, imageUrl: null, publishedAt: new Date().toISOString(), tickerSentiments: [], rawPayload: {} };
    const rows = enrichEvidence([
      { ...base, url: "https://reuters.com/a", title: "RBI cuts rates sharply" },
      { ...base, url: "https://bloomberg.com/b", title: "RBI cuts rates sharply" },
      { ...base, url: "https://unknown.test/c", title: "Unverified company claim" },
    ]);
    expect(rows[0].verifiedEvidence).toBe(true);
    expect(rows[1].corroborationCount).toBe(2);
    expect(rows[2].verifiedEvidence).toBe(false);
  });
});
