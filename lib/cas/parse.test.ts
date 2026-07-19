import { describe, expect, it } from "vitest";
import {
  parseCasHoldings,
  parseIsinRows,
  parseNumericTailRows,
  parseStructured,
  sanitizeParsedRow,
  type ParsedHoldingRow,
} from "./parse";

const mfRow = (over: Partial<ParsedHoldingRow>): ParsedHoldingRow => ({
  name: "Nippon India Small Cap Fund - Growth",
  folio: null,
  isin: "INF204K01HY3",
  quantity: 1234.567,
  price: 188.19,
  value: 232333.16,
  assetClass: "MUTUAL_FUND",
  ...over,
});

describe("sanitizeParsedRow", () => {
  it("keeps a plausible mutual-fund row", () => {
    const row = sanitizeParsedRow(mfRow({}));
    expect(row).not.toBeNull();
    expect(row!.quantity).toBe(1234.567);
  });

  it("rejects folio-sized quantities", () => {
    expect(sanitizeParsedRow(mfRow({ quantity: 499189255276, value: 938188.32 * 499189255276 }))).toBeNull();
    expect(sanitizeParsedRow(mfRow({ quantity: 499189255276 }))).toBeNull();
  });

  it("rejects implausible NAVs via the implied price", () => {
    // 686 units "worth" ₹3.7 crore implies NAV ₹54,493 — no real MF NAV is that high.
    expect(sanitizeParsedRow(mfRow({ quantity: 686, price: null, value: 37_382_197 }))).toBeNull();
    expect(sanitizeParsedRow(mfRow({ quantity: 10, price: null, value: 5_000_000 }))).toBeNull();
    expect(sanitizeParsedRow(mfRow({ quantity: 1_000_000, price: null, value: 100_000 }))).toBeNull(); // implied 0.1
  });

  it("rejects footnote and section-header names", () => {
    for (const name of [
      "*Due to change in fundamental attributes of the Scheme",
      "Mutual Funds Transaction Statement for the Period from 01-Apr-2025",
      "Mutual Fund Folios (F)",
      "of ICICI Prudential Bluechip Fund has been changed to I",
      "Sub Total",
      "Opening Balance",
      "Closing Balance",
      "--- PAGE",
    ]) {
      expect(sanitizeParsedRow(mfRow({ name })), name).toBeNull();
    }
  });

  it("repairs a price that contradicts quantity × price = value", () => {
    const row = sanitizeParsedRow(mfRow({ price: 938188.32 }));
    expect(row).not.toBeNull();
    expect(row!.price).toBeCloseTo(232333.16 / 1234.567, 4);
  });
});

describe("parseIsinRows", () => {
  it("parses a demat equity line", () => {
    const rows = parseIsinRows(
      "INE880J01026 JSW INFRASTRUCTURE LIMITED # SHARES 322.000 195.00 62,790.00",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ isin: "INE880J01026", quantity: 322, price: 195, value: 62790 });
  });

  it("ignores folio numbers embedded in the line", () => {
    const rows = parseIsinRows(
      "INF204K01HY3 Nippon India Small Cap Fund Growth 499189255276 1,234.567 188.19 232,333.16",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(1234.567);
    expect(rows[0].price).toBe(188.19);
    expect(rows[0].value).toBe(232333.16);
  });

  it("prefers the market value over an earlier cost value", () => {
    const rows = parseIsinRows(
      "INF879O01027 Parag Parikh Flexi Cap Fund Direct Growth 1,000.000 50.00 50,000.00 81.50 81,500.00",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe(81500);
    expect(rows[0].price).toBe(81.5);
  });

  it("drops a line whose numbers do not reconcile", () => {
    // Folio + date fragments only — no (quantity, price, value) triple exists.
    const rows = parseIsinRows("INF204K01489 Nippon India Multi Asset 12345678901 30 2025 17");
    expect(rows).toHaveLength(0);
  });
});

describe("parseNumericTailRows", () => {
  it("parses a scheme line and ignores the folio number", () => {
    const rows = parseNumericTailRows(
      "HDFC Flexi Cap Fund - Regular Plan - Growth Folio No: 1234567/89 100.500 1,850.25 185,950.13",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ quantity: 100.5, price: 1850.25, value: 185950.13 });
  });

  it("accepts quantity + value pairs only when the implied price is plausible", () => {
    const ok = parseNumericTailRows("Axis Bluechip Fund - Direct Growth 250.000 12,500.00");
    expect(ok).toHaveLength(1);
    expect(ok[0]).toMatchObject({ quantity: 250, value: 12500, price: 50 });

    const bad = parseNumericTailRows("Some Ghost Fund - Growth 1.000 938,188,320,000.00");
    expect(bad).toHaveLength(0);
  });

  it("does not emit rows for footnotes and totals", () => {
    const text = [
      "*Due to change in fundamental attributes of the Scheme 23 87.73 2,017.79",
      "Mutual Funds Transaction Statement for the Period from 01-Apr-2025 to 30-Jun-2025",
      "Sub Total 1,505,485.54 12,081,600.00",
      "Opening Balance 10,272.755 6.00",
      "--- PAGE 2 ---",
      "Mutual Fund Folios (F) 7,929,835.56 71.00",
    ].join("\n");
    expect(parseNumericTailRows(text)).toHaveLength(0);
    expect(parseCasHoldings(text)).toHaveLength(0);
  });
});

describe("parseStructured", () => {
  it("still parses a clean CSV export", () => {
    const text = [
      "Scheme Name,Folio,ISIN,Units,NAV,Market Value",
      "Parag Parikh Flexi Cap Fund - Direct - Growth,12345678,INF879O01027,1000.000,81.50,81500.00",
    ].join("\n");
    const rows = parseStructured(text);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ quantity: 1000, price: 81.5, value: 81500, isin: "INF879O01027" });
  });
});

describe("parseCasHoldings (end to end)", () => {
  it("extracts only real holdings from a messy CAS extract", () => {
    const text = [
      "Consolidated Account Statement",
      "Mutual Funds Transaction Statement for the Period from 01-Apr-2025 to 30-Jun-2025",
      "Folio No: 499189255276",
      "INF204K01HY3 Nippon India Small Cap Fund - Growth Plan 1,234.567 188.19 232,333.16",
      "*Due to change in fundamental attributes of the Scheme w.e.f. 01-Jan-2025",
      "Sub Total 1,505,485.54 12,081,600.00",
      "--- PAGE 2 ---",
      "INE880J01026 JSW INFRASTRUCTURE LIMITED # SHARES 322.000 195.00 62,790.00",
      "Grand Total 12,314,000.00",
    ].join("\n");
    const rows = parseCasHoldings(text);
    const byIsin = new Map(rows.map((r) => [r.isin, r]));
    expect(byIsin.get("INF204K01HY3")).toMatchObject({ quantity: 1234.567, assetClass: "MUTUAL_FUND" });
    expect(byIsin.get("INE880J01026")).toMatchObject({ quantity: 322, assetClass: "STOCK" });
    for (const row of rows) {
      expect(row.quantity * (row.price ?? 0)).toBeLessThan(1_000_000_000);
      expect(row.name).not.toMatch(/total|page|statement|fundamental/i);
    }
  });
});
