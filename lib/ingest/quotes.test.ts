import { describe, expect, it } from "vitest";
import { parseGoogleFinanceQuote } from "@/lib/ingest/quotes";

describe("parseGoogleFinanceQuote", () => {
  it("extracts the instrument-specific live price and percentage change", () => {
    const html = `noise [["OTHER","NSE"],"Other",0,"INR",[999,1,2,2,3,3]]
      [["ARCHIDPLY","NSE"],"Archidply Industries Limited.",0,"INR",[93,0.05000305,0.053795647,2,3,3],null,92.95`;

    expect(parseGoogleFinanceQuote(html, "ARCHIDPLY", "NSE")).toEqual({
      price: 93,
      changePct: 0.053795647,
      source: "GOOGLE_FINANCE_LIVE",
    });
  });

  it("does not borrow another instrument's price", () => {
    const html = `[["OTHER","NSE"],"Other",0,"INR",[999,1,2,2,3,3]]`;
    expect(parseGoogleFinanceQuote(html, "ARCHIDPLY", "NSE")).toBeNull();
  });

  it("handles the entity-encoded tuple returned by the live HTML page", () => {
    const html = `[[[&quot;/g/1dv3cr2g&quot;,[&quot;ARCHIDPLY&quot;,&quot;NSE&quot;],&quot;Archidply Industries Limited.&quot;,0,&quot;INR&quot;,[93,0.05000305,0.053795647,2,3,3],null,92.95`;
    expect(parseGoogleFinanceQuote(html, "ARCHIDPLY", "NSE")?.price).toBe(93);
  });
});
