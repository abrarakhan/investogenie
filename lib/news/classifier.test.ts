import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MODEL_BY_PROVIDER, isAIProvider } from "@/lib/ai/providers";
import { classifyNews } from "./classifier";
import type { NormalizedNewsArticle } from "./providers";

afterEach(() => vi.unstubAllGlobals());

const article: NormalizedNewsArticle = {
  provider: "gnews",
  providerArticleId: null,
  url: "https://example.com/order-win",
  title: "Example Industries wins a major order",
  description: "The company announced a new multi-year contract.",
  sourceName: "Example News",
  imageUrl: null,
  publishedAt: "2026-08-21T10:00:00Z",
  tickerSentiments: [],
  rawPayload: {},
};

describe("DeepSeek news classification", () => {
  it("is a supported provider with a current V4 default", () => {
    expect(isAIProvider("deepseek")).toBe(true);
    expect(DEFAULT_MODEL_BY_PROVIDER.deepseek).toBe("deepseek-v4-flash");
  });

  it("uses DeepSeek JSON output to produce an asset impact", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ impacts: [{
        articleIndex: 0,
        scope: "ASSET",
        ticker: "EXAMPLE",
        sector: "Industrials",
        eventType: "ORDER_WIN",
        direction: "POSITIVE",
        sentimentScore: 0.7,
        confidence: 0.85,
        severity: 0.6,
        horizon: "SWING",
        rationale: "The order improves the near-term revenue outlook.",
      }] }) } }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const impacts = await classifyNews("IN", [article], [{
      assetId: "asset-1", ticker: "EXAMPLE", name: "Example Industries", sector: "Industrials",
    }], { provider: "deepseek", model: "deepseek-v4-flash", apiKey: "test" });

    expect(impacts).toEqual([expect.objectContaining({
      assetId: "asset-1",
      direction: "POSITIVE",
      analysisSource: "ai:deepseek",
      model: "deepseek-v4-flash",
    })]);
    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(request.response_format).toEqual({ type: "json_object" });
    expect(request.thinking).toEqual({ type: "disabled" });
  });
});
