import { describe, it, expect } from "vitest";
import {
  evaluate,
  applyFilters,
  applySort,
  validateFilter,
  toSqlWhere,
  toOrderBy,
  type Filter,
} from "./filterEngine";

// Minimal snapshot-shaped rows keyed by the backing column names.
const AAA = { symbol: "AAA", sector: "IT", ltp: 100, change_pct_1d: 5, pe_ratio: 20, roe: 18, market_cap: 5000, debt_to_equity: 0.2 };
const BBB = { symbol: "BBB", sector: "Banks", ltp: 50, change_pct_1d: -2, pe_ratio: 10, roe: null, market_cap: 800, debt_to_equity: 1.5 };
const CCC = { symbol: "CCC", sector: "IT", ltp: 200, change_pct_1d: 0, pe_ratio: null, roe: 25, market_cap: 12000, debt_to_equity: null };
const ROWS = [AAA, BBB, CCC];

describe("evaluate — numeric operators", () => {
  it("gt / gte / lt / lte", () => {
    expect(evaluate(AAA, { field: "change_pct_1d", op: "gt", value: 4 })).toBe(true);
    expect(evaluate(AAA, { field: "change_pct_1d", op: "gt", value: 5 })).toBe(false);
    expect(evaluate(AAA, { field: "change_pct_1d", op: "gte", value: 5 })).toBe(true);
    expect(evaluate(BBB, { field: "change_pct_1d", op: "lt", value: 0 })).toBe(true);
    expect(evaluate(CCC, { field: "change_pct_1d", op: "lte", value: 0 })).toBe(true);
  });

  it("eq / neq", () => {
    expect(evaluate(AAA, { field: "ltp", op: "eq", value: 100 })).toBe(true);
    expect(evaluate(AAA, { field: "ltp", op: "neq", value: 100 })).toBe(false);
    expect(evaluate(BBB, { field: "ltp", op: "neq", value: 100 })).toBe(true);
  });

  it("between is inclusive", () => {
    expect(evaluate(AAA, { field: "market_cap", op: "between", value: [1000, 6000] })).toBe(true);
    expect(evaluate(AAA, { field: "market_cap", op: "between", value: [5000, 5000] })).toBe(true);
    expect(evaluate(BBB, { field: "market_cap", op: "between", value: [1000, 6000] })).toBe(false);
  });
});

describe("evaluate — null handling", () => {
  it("null numeric is excluded from every numeric comparison (not treated as 0)", () => {
    expect(evaluate(CCC, { field: "pe_ratio", op: "lt", value: 15 })).toBe(false);
    expect(evaluate(CCC, { field: "pe_ratio", op: "gt", value: -1 })).toBe(false);
    expect(evaluate(CCC, { field: "pe_ratio", op: "eq", value: 0 })).toBe(false);
    expect(evaluate(BBB, { field: "roe", op: "gte", value: 0 })).toBe(false);
  });

  it("missing field behaves like null", () => {
    expect(evaluate({ symbol: "X" }, { field: "roe", op: "gt", value: 0 })).toBe(false);
  });
});

describe("evaluate — enum / text", () => {
  it("eq and in match sector", () => {
    expect(evaluate(AAA, { field: "sector", op: "eq", value: "IT" })).toBe(true);
    expect(evaluate(BBB, { field: "sector", op: "in", value: ["IT", "Banks"] })).toBe(true);
    expect(evaluate(BBB, { field: "sector", op: "in", value: ["IT", "Pharma"] })).toBe(false);
  });

  it("neq lets a null enum through (nothing to be unequal to)", () => {
    expect(evaluate({ symbol: "X", sector: null }, { field: "sector", op: "neq", value: "IT" })).toBe(true);
    expect(evaluate(AAA, { field: "sector", op: "neq", value: "IT" })).toBe(false);
  });
});

describe("applyFilters — AND composition", () => {
  it("combines clauses with AND", () => {
    const filters: Filter[] = [
      { field: "sector", op: "eq", value: "IT" },
      { field: "roe", op: "gte", value: 20 },
    ];
    expect(applyFilters(ROWS, filters).map((r) => r.symbol)).toEqual(["CCC"]);
  });

  it("empty filter list matches everything", () => {
    expect(applyFilters(ROWS, []).length).toBe(3);
  });

  it("a null field silently drops a row from an AND that references it", () => {
    const filters: Filter[] = [{ field: "debt_to_equity", op: "lt", value: 1 }];
    expect(applyFilters(ROWS, filters).map((r) => r.symbol)).toEqual(["AAA"]); // BBB fails, CCC null-excluded
  });
});

describe("applySort — nulls last in both directions", () => {
  it("desc keeps nulls at the bottom", () => {
    const sorted = applySort(ROWS, { field: "pe_ratio", dir: "desc" });
    expect(sorted.map((r) => r.symbol)).toEqual(["AAA", "BBB", "CCC"]); // CCC null last
  });
  it("asc also keeps nulls at the bottom", () => {
    const sorted = applySort(ROWS, { field: "pe_ratio", dir: "asc" });
    expect(sorted.map((r) => r.symbol)).toEqual(["BBB", "AAA", "CCC"]);
  });
});

describe("validateFilter", () => {
  it("rejects unknown fields", () => {
    expect(() => validateFilter({ field: "nope", op: "gt", value: 1 })).toThrow(/Unknown/);
  });
  it("rejects operators the type does not allow", () => {
    expect(() => validateFilter({ field: "ltp", op: "in", value: [1] })).toThrow(/not valid/);
    expect(() => validateFilter({ field: "sector", op: "gt", value: 1 })).toThrow(/not valid/);
  });
  it("rejects malformed between / in values", () => {
    expect(() => validateFilter({ field: "ltp", op: "between", value: 5 })).toThrow(/\[min, max\]/);
    expect(() => validateFilter({ field: "sector", op: "in", value: [] })).toThrow(/non-empty/);
    expect(() => validateFilter({ field: "ltp", op: "gt", value: [1, 2] })).toThrow(/scalar/);
  });
});

describe("toSqlWhere", () => {
  it("emits parameterised clauses with sequential placeholders", () => {
    const { clauses, params } = toSqlWhere(
      [
        { field: "market_cap", op: "gte", value: 1000 },
        { field: "change_pct_1d", op: "between", value: [1, 10] },
        { field: "sector", op: "in", value: ["IT", "Banks"] },
      ],
      1,
    );
    expect(clauses).toEqual([
      "s.market_cap >= $1",
      "s.change_pct_1d between $2 and $3",
      "s.sector = any($4)",
    ]);
    expect(params).toEqual([1000, 1, 10, ["IT", "Banks"]]);
  });

  it("respects a non-1 start index for prepended params", () => {
    const { clauses, params } = toSqlWhere([{ field: "roe", op: "gt", value: 15 }], 3);
    expect(clauses).toEqual(["s.roe > $3"]);
    expect(params).toEqual([15]);
  });

  it("neq tolerates NULL columns in SQL just like the JS evaluator", () => {
    const { clauses } = toSqlWhere([{ field: "sector", op: "neq", value: "IT" }], 1);
    expect(clauses[0]).toBe("(s.sector is null or s.sector <> $1)");
  });
});

describe("toOrderBy", () => {
  it("uses the fallback when the sort field is not sortable/whitelisted", () => {
    expect(toOrderBy({ field: "bogus", dir: "asc" }, { field: "market_cap", dir: "desc" }))
      .toBe("order by s.market_cap desc nulls last, s.symbol asc");
  });
  it("honours a valid sort spec", () => {
    expect(toOrderBy({ field: "change_pct_1d", dir: "asc" }, { field: "market_cap", dir: "desc" }))
      .toBe("order by s.change_pct_1d asc nulls last, s.symbol asc");
  });
});
