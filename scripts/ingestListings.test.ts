import { describe, expect, it } from "vitest";
import { fetchListingSources } from "./ingest-listings.mjs";

const row = (ticker: string, exchange: string) => ({ ticker, name: ticker, exchange, country: "IN", currency: "INR" });

describe("listing source fetch", () => {
  it("keeps the sources that succeed when one exchange refuses the download", async () => {
    const result = await fetchListingSources([
      ["US", async () => [row("AAPL", "NASDAQ")]],
      ["NSE", async () => [row("TCS", "NSE"), row("INFY", "NSE")]],
      ["BSE", async () => { throw new Error("BSE 403"); }],
    ]);
    expect(result.counts).toEqual({ US: 1, NSE: 2 });
    expect(result.rows.map((item) => item.ticker)).toEqual(["AAPL", "TCS", "INFY"]);
    expect(result.failures).toEqual([{ source: "BSE", error: "BSE 403" }]);
  });

  it("reports every failure when no source succeeds", async () => {
    const result = await fetchListingSources([
      ["US", async () => { throw new Error("SEC 503"); }],
      ["BSE", async () => { throw new Error("BSE 403"); }],
    ]);
    expect(result.counts).toEqual({});
    expect(result.failures.map((failure) => failure.source)).toEqual(["US", "BSE"]);
  });
});
