import { describe, expect, it } from "vitest";
import { newsDecay, scoreNewsSwing, type NewsImpactInput } from "./newsSwing";

const NOW = new Date("2026-08-21T12:00:00Z");
const impact = (overrides: Partial<NewsImpactInput> = {}): NewsImpactInput => ({
  direction: "POSITIVE",
  sentimentScore: 0.8,
  confidence: 0.9,
  severity: 0.8,
  publishedAt: "2026-08-21T10:00:00Z",
  scope: "ASSET",
  ...overrides,
});

describe("news swing scoring", () => {
  it("keeps the technical calculation unchanged when no news exists", () => {
    expect(scoreNewsSwing(0.72, [], NOW)).toEqual({
      technicalScore: 72, newsAdjustment: 0, combinedScore: 72, state: "NEUTRAL",
    });
  });

  it("caps both positive and negative overlays at 20 points", () => {
    expect(scoreNewsSwing(70, Array(10).fill(impact()), NOW).newsAdjustment).toBe(20);
    expect(scoreNewsSwing(70, Array(10).fill(impact({ direction: "NEGATIVE", sentimentScore: -1 })), NOW).newsAdjustment).toBe(-20);
  });

  it("decays old news and ignores it after seven days", () => {
    expect(newsDecay("2026-08-20T12:00:00Z", NOW)).toBeCloseTo(0.5);
    expect(newsDecay("2026-08-10T12:00:00Z", NOW)).toBe(0);
  });

  it("marks a recent severe verified negative event risk-off", () => {
    const result = scoreNewsSwing(85, [impact({
      direction: "NEGATIVE", sentimentScore: -0.9, confidence: 0.9, severity: 0.95,
    })], NOW);
    expect(result.state).toBe("RISK_OFF");
    expect(result.combinedScore).toBeLessThan(85);
  });

  it("weights broad market news below stock-specific news", () => {
    const asset = scoreNewsSwing(70, [impact({ scope: "ASSET" })], NOW);
    const market = scoreNewsSwing(70, [impact({ scope: "MARKET" })], NOW);
    expect(asset.newsAdjustment).toBeGreaterThan(market.newsAdjustment);
  });
});
