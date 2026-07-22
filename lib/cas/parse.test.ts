import { describe, expect, it } from "vitest";
import {
  parseCasHoldings,
  parseCamsKfintechFundSections,
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
<<<<<<< HEAD

  it("splits multiple schemes under one folio by ISIN", () => {
    const text = [
      "HDFC Mutual Fund",
      "H02-HDFC Flexi Cap Fund - Regular Plan - Growth (Non -Demat ) - ISIN: INF179K01608(Advisor: ARN-7037) Registrar : CAMS",
      "Folio No: 7933973 / 38",
      "Abrar Ahmed Khan",
      "NAV on 17-Jul-2026: INR 2,043.566 Market Value on 17-Jul-2026: INR 402,126.79",
      "Exit Load: this legal text must be ignored.",
      "Closing Unit Balance: 196.777 Total Cost Value: 114,281.68",
      "HHIDRG -HDFC Nifty India Digital Index Fund Regular Growth (Non -Demat ) - ISIN: INF179KC1JA6(Advisor: ARN-178985) Registrar : CAMS",
      "Folio No: 7933973 / 38",
      "Abrar Ahmed Khan",
      "NAV on 17-Jul-2026: INR 8.2589 Market Value on 17-Jul-2026: INR 95,313.40",
      "Closing Unit Balance: 11,540.689 Total Cost Value: 100,000.00",
    ].join("\n");
    const rows = parseCamsKfintechFundSections(text);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => `${row.isin}:${row.folio}`)).toEqual(["INF179K01608:7933973/38", "INF179KC1JA6:7933973/38"]);
    expect(rows[0]).toMatchObject({ quantity: 196.777, costValue: 114281.68, value: 402126.79 });
  });

  it("keeps the same ISIN in different folios as separate holdings", () => {
    const text = [
      "P1191-ICICI Prudential Large Cap Fund - Growth (Non -Demat ) - ISIN: INF109K01BL4(Advisor: ARN-0845)",
      "Folio No: 17188882 / 09",
      "Abrar Ahmed Khan",
      "NAV on 17-Jul-2026: INR 109.20 Market Value on 17-Jul-2026: INR 204.20",
      "Closing Unit Balance: 1.870 Total Cost Value: 100.00",
      "P1191-ICICI Prudential Large Cap Fund - Growth (Non -Demat ) - ISIN: INF109K01BL4(Advisor: ARN-182499)",
      "Folio No: 8414850 / 88",
      "Abrar Ahmed Khan",
      "NAV on 17-Jul-2026: INR 109.20 Market Value on 17-Jul-2026: INR 898,553.40",
      "Closing Unit Balance: 8,228.511 Total Cost Value: 471,800.00",
    ].join("\n");
    const rows = parseCasHoldings(text).filter((row) => row.isin === "INF109K01BL4");
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.folio).sort()).toEqual(["17188882/09", "8414850/88"]);
  });

  it("does not create holdings from disclosure text inside a fund section", () => {
    const text = [
      "L619G-SBI Children's Fund - Investment Plan Regular Growth (Non -Demat ) - ISIN: INF200KA1Q99(Advisor: ARN-178985) Registrar : CAMS",
      "Folio No: 29536020 / 0",
      "Ayyan Ahmad Khan",
      "Exit Load: please refer to SAI / SID / KIM / Addendum issued from time to time.",
      "Scheme name of SBI Magnum Children's Benefit Fund Investment Plan has been changed.",
      "NAV on 17-Jul-2026: INR 49.5660 Market Value on 17-Jul-2026: INR 337,301.44",
      "Closing Unit Balance: 6,805.097 Total Cost Value: 210,000.00",
    ].join("\n");
    const rows = parseCasHoldings(text);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("SBI Children's Fund - Investment Plan Regular Growth");
  });

  it("accepts holder name variation in one consolidated CAS", () => {
    const text = [
      "127FMGPG -Motilal Oswal Midcap Fund - Regular Plan Growth (Non Demat ) - ISIN: INF247L01411(Advisor: ARN-178985) Registrar :",
      "Folio No: 901106347976 / 0",
      "ARSALAN AHMAD KHAN",
      "NAV on 17-Jul-2026: INR 99.0958 Market Value on 17-Jul-2026: INR 87,518.44",
      "Closing Unit Balance: 883.170 Total Cost Value: 85,000.00",
      "L619G-SBI Children's Fund - Investment Plan Regular Growth (Non -Demat ) - ISIN: INF200KA1Q99(Advisor: ARN-178985) Registrar : CAMS",
      "Folio No: 29536020 / 0",
      "Ayyan Ahmad Khan",
      "NAV on 17-Jul-2026: INR 49.5660 Market Value on 17-Jul-2026: INR 337,301.44",
      "Closing Unit Balance: 6,805.097 Total Cost Value: 210,000.00",
    ].join("\n");
    const rows = parseCasHoldings(text);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.holderName)).toEqual(["ARSALAN AHMAD KHAN", "Ayyan Ahmad Khan"]);
  });

  it("is idempotent by ISIN plus folio", () => {
    const section = [
      "INF109KC1O90 ICICI Prudential Business Cycle Fund Growth (Non -Demat ) - ISIN: INF109KC1O90(Advisor: ARN-7037) Registrar : CAMS",
      "Folio No: 8414850 / 88",
      "Abrar Ahmed Khan",
      "NAV on 17-Jul-2026: INR 24.92 Market Value on 17-Jul-2026: INR 125,219.86",
      "Closing Unit Balance: 5,024.874 Total Cost Value: 50,000.00",
    ].join("\n");
    const rows = parseCasHoldings(`${section}\n${section}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ isin: "INF109KC1O90", folio: "8414850/88", quantity: 5024.874 });
  });
=======
>>>>>>> claude/vigilant-wu-216d1d
});
