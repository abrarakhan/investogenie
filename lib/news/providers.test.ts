import { describe, expect, it } from "vitest";
import { buildGNewsQueries } from "./providers";

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
});
