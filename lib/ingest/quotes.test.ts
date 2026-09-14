import { describe, expect, it } from "vitest";
import { buildBSE, buildNSE, parseGoogleFinanceQuote } from "@/lib/ingest/quotes";

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

  it("maps the app BSE code to Google Finance's BOM identifier", () => {
    const html = `[["500325","BOM"],"Reliance Industries Ltd",0,"INR",[1395.25,12.5,0.9]]`;
    expect(parseGoogleFinanceQuote(html, "500325", "BSE")).toEqual({
      price: 1395.25,
      changePct: 0.9,
      source: "GOOGLE_FINANCE_LIVE",
    });
  });

  it("handles the entity-encoded tuple returned by the live HTML page", () => {
    const html = `[[[&quot;/g/1dv3cr2g&quot;,[&quot;ARCHIDPLY&quot;,&quot;NSE&quot;],&quot;Archidply Industries Limited.&quot;,0,&quot;INR&quot;,[93,0.05000305,0.053795647,2,3,3],null,92.95`;
    expect(parseGoogleFinanceQuote(html, "ARCHIDPLY", "NSE")?.price).toBe(93);
  });
});

describe("Bhavcopy closing quotes", () => {
  it("uses the NSE official close instead of the final traded price", () => {
    const csv = [
      "SYMBOL,SERIES,DATE1,LAST_PRICE,CLOSE_PRICE,PREV_CLOSE",
      "ABDL,EQ,11-Sep-2026,636.00,632.50,625.00",
    ].join("\n");

    expect(buildNSE(csv)?.quotes.get("ABDL")).toEqual({
      price: 632.5,
      changePct: 1.2,
    });
  });

  it("uses the BSE official close instead of the final traded price", () => {
    const csv = [
      "TckrSymb,FinInstrmTp,TradDt,LastPric,ClsPric,PrvsClsgPric",
      "ALLTIME,STK,2026-09-11,226.00,220.30,218.00",
    ].join("\n");

    expect(buildBSE(csv)?.quotes.get("ALLTIME")).toEqual({
      price: 220.3,
      changePct: expect.closeTo(1.055045871559633),
    });
  });
});
