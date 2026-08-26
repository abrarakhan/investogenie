import { afterEach, describe, expect, it, vi } from "vitest";
import { buildGNewsQueries, fetchNews } from "./providers";

afterEach(() => vi.unstubAllGlobals());

describe("GNews query generation", () => {
  it("quotes NSE symbols and names containing special characters", () => {
    const queries = buildGNewsQueries([
      { ticker: "M&M", name: "Mahindra & Mahindra Limited" },
      { ticker: "BAJAJ-AUTO", name: "Bajaj Auto Ltd." },
    ]);
    expect(queries.join(" ")).toContain('"M&M"');
    expect(queries.join(" ")).toContain('"BAJAJ-AUTO"');
    expect(queries.join(" ")).toContain('"Mahindra & Mahindra Limited"');
  });

  it("keeps every query within GNews' 200-character limit", () => {
    const queries = buildGNewsQueries(Array.from({ length: 20 }, (_, index) => ({
      ticker: `TICK-${index}`,
      name: `A deliberately long company name with punctuation & holdings number ${index}`,
    })));
    expect(queries.length).toBeLessThanOrEqual(4);
    expect(queries.every((query) => query.length <= 195)).toBe(true);
  });

  it("removes embedded quotes and control characters", () => {
    const [query] = buildGNewsQueries([{ ticker: 'A"B', name: "Line\nBreak Corp" }]);
    expect(query).toBe('(\"Line Break Corp\" OR \"A B\")');
  });

  it("retries a rate-limited GNews request", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ errors: ["rate limited"] }), {
        status: 429,
        headers: { "retry-after": "0.001" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ articles: [{
        url: "https://example.com/market-news",
        title: "Market update",
        publishedAt: "2026-08-21T10:00:00Z",
        source: { name: "Example" },
      }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const articles = await fetchNews({ provider: "gnews", apiKey: "test" }, "US", []);
    expect(articles).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not report an empty GNews response as a successful refresh", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ articles: [] }), { status: 200 }),
    ));
    await expect(fetchNews({ provider: "gnews", apiKey: "test" }, "IN", []))
      .rejects.toThrow("no articles");
  });
});
