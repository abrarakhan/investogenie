import { describe, expect, it } from "vitest";
import { FIELDS } from "./fields";
import { validateFilter } from "./filterEngine";
import { buildMarketContext, buildSystemRules, sanitizeIntent, type ScreenIntent } from "./nlQuery";

const SECTORS = ["IT", "Banks", "Pharma"];
const UNIVERSES = ["ALL", "NIFTY_50", "NIFTY_500"];
const OPTS = { sectors: SECTORS, universes: UNIVERSES };

const intent = (over: Partial<ScreenIntent>): ScreenIntent => ({
  filters: [],
  sort: null,
  universe: null,
  valueBelowSectorMedian: false,
  search: null,
  notes: "",
  ...over,
});

describe("sanitizeIntent — numeric coercion", () => {
  it("keeps a well-formed numeric clause and coerces a numeric string", () => {
    const out = sanitizeIntent(
      intent({ filters: [{ field: "pe_ratio", op: "lt", value: "30" }] }),
      OPTS,
    );
    expect(out.filters).toEqual([{ field: "pe_ratio", op: "lt", value: 30 }]);
    expect(out.notes).toBe("");
  });

  it("drops a non-numeric scalar on a numeric field", () => {
    // Passes validateFilter, then Number("cheap") -> NaN throws at the pg layer.
    const bad = { field: "pe_ratio", op: "lt" as const, value: "cheap" };
    expect(() => validateFilter(bad)).not.toThrow();

    const out = sanitizeIntent(intent({ filters: [bad] }), OPTS);
    expect(out.filters).toHaveLength(0);
    expect(out.notes).toMatch(/not a number/);
  });
});

describe("sanitizeIntent — between bounds", () => {
  it("swaps a reversed range", () => {
    // [250, 101] validates fine and then matches zero rows.
    const reversed = { field: "mcap_rank", op: "between" as const, value: [250, 101] };
    expect(() => validateFilter(reversed)).not.toThrow();

    const out = sanitizeIntent(intent({ filters: [reversed] }), OPTS);
    expect(out.filters[0].value).toEqual([101, 250]);
  });

  it("leaves an already-ordered range alone", () => {
    const out = sanitizeIntent(
      intent({ filters: [{ field: "mcap_rank", op: "between", value: [101, 250] }] }),
      OPTS,
    );
    expect(out.filters[0].value).toEqual([101, 250]);
  });

  it("drops a range with a non-numeric bound", () => {
    const out = sanitizeIntent(
      intent({ filters: [{ field: "roe", op: "between", value: ["low", 20] }] }),
      OPTS,
    );
    expect(out.filters).toHaveLength(0);
    expect(out.notes).toMatch(/non-numeric range bound/);
  });
});

describe("sanitizeIntent — sector values", () => {
  it("keeps known sectors and reports the unknown ones", () => {
    const out = sanitizeIntent(
      intent({ filters: [{ field: "sector", op: "in", value: ["IT", "Widgets"] }] }),
      OPTS,
    );
    expect(out.filters[0].value).toEqual(["IT"]);
    expect(out.notes).toMatch(/no such sector: Widgets/);
  });

  it("drops the clause when no sector survives", () => {
    const out = sanitizeIntent(
      intent({ filters: [{ field: "sector", op: "in", value: ["Widgets"] }] }),
      OPTS,
    );
    expect(out.filters).toHaveLength(0);
  });
});

describe("sanitizeIntent — non-filter slots", () => {
  it("nulls an unknown universe and notes it", () => {
    const out = sanitizeIntent(intent({ universe: "FTSE_100" }), OPTS);
    expect(out.universe).toBeNull();
    expect(out.notes).toMatch(/unknown universe/);
  });

  it("keeps a known universe", () => {
    expect(sanitizeIntent(intent({ universe: "NIFTY_50" }), OPTS).universe).toBe("NIFTY_50");
  });

  it("nulls a sort on a non-sortable field", () => {
    const out = sanitizeIntent(intent({ sort: { field: "nonsense", dir: "desc" } }), OPTS);
    expect(out.sort).toBeNull();
  });

  it("preserves the model's own notes alongside drop reasons", () => {
    const out = sanitizeIntent(
      intent({ notes: "Could not apply the OR.", universe: "FTSE_100" }),
      OPTS,
    );
    expect(out.notes).toMatch(/Could not apply the OR\./);
    expect(out.notes).toMatch(/Dropped:/);
  });
});

describe("sanitizeIntent — output survives the engine", () => {
  it("every surviving clause passes validateFilter", () => {
    const out = sanitizeIntent(
      intent({
        filters: [
          { field: "pe_ratio", op: "lt", value: "30" },
          { field: "mcap_rank", op: "between", value: [250, 101] },
          { field: "sector", op: "in", value: ["IT", "Widgets"] },
          { field: "roe", op: "gt", value: "abc" },
        ],
      }),
      OPTS,
    );
    expect(out.filters).toHaveLength(3);
    for (const f of out.filters) expect(() => validateFilter(f)).not.toThrow();
  });
});

describe("buildSystemRules", () => {
  const rules = buildSystemRules();

  it("lists every screenable field key", () => {
    for (const f of FIELDS) expect(rules).toContain(f.key);
  });

  it("states the sign convention for the 52-week high", () => {
    expect(rules).toContain('"value":-5');
  });

  it("calls out debt_to_equity as a ratio, not a percent", () => {
    expect(rules).toMatch(/debt_to_equity is a plain RATIO/);
  });

  it("includes preset examples as few-shots", () => {
    expect(rules).toContain("Ranks 101–250 by market cap (SEBI)");
    expect(rules).toContain('"op":"between","value":[101,250]');
  });
});

describe("buildMarketContext", () => {
  it("names the money unit for IN", () => {
    expect(buildMarketContext("IN", SECTORS, UNIVERSES)).toMatch(/Rs\. Crore/);
  });

  it("names the money unit for US", () => {
    expect(buildMarketContext("US", SECTORS, UNIVERSES)).toMatch(/USD millions/);
  });

  it("injects the live sector and universe lists", () => {
    const ctx = buildMarketContext("IN", SECTORS, UNIVERSES);
    for (const s of SECTORS) expect(ctx).toContain(s);
    expect(ctx).toContain("NIFTY_50");
  });
});
