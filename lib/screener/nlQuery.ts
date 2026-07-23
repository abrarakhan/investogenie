// Natural-language → screener filters.
//
// The model never talks to the database. It emits a ScreenIntent, which is then
// put through the SAME validateFilter() the hand-built filter UI uses before any
// clause reaches toSqlWhere(). Anything off-registry throws before SQL is built,
// so this adds no injection surface — the field registry is the contract.
//
// Three layers of checking, in order:
//   1. zodOutputFormat()  — the SDK rejects output that doesn't match the schema
//   2. validateFilter()   — existing engine guard; its throw message drives one
//                           repair turn (not a loop)
//   3. sanitizeIntent()   — the gaps validateFilter() deliberately doesn't cover:
//                           reversed `between` bounds, non-numeric scalars on a
//                           numeric field, and sector values that don't exist in
//                           this market. All three validate cleanly and then
//                           silently misbehave, so they are caught here.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { FIELDS, FIELD_BY_KEY, SORTABLE_KEYS } from "./fields";
import { validateFilter, type Filter, type SortSpec } from "./filterEngine";
import { PRESETS } from "./presets";

const MODEL = "claude-opus-4-8";
export const MAX_QUERY_CHARS = 500;

/** Money columns whose unit differs per market (Rs. Crore vs USD millions). */
const MONEY_FIELDS = ["market_cap", "free_cash_flow", "trade_value"];
/** Percent-point columns — 15 means 15%, never 0.15. */
const PERCENT_FIELDS = FIELDS.filter((f) => f.format === "percent").map((f) => f.key);

export interface ScreenIntent {
  filters: Filter[];
  sort: SortSpec | null;
  universe: string | null;
  /** "cheap for its sector" — resolved as a sector-median CTE, not a filter. */
  valueBelowSectorMedian: boolean;
  search: string | null;
  /** What could NOT be expressed. Shown to the user; empty when nothing was lost. */
  notes: string;
}

const fieldKeys = FIELDS.map((f) => f.key) as [string, ...string[]];
const sortableKeys = FIELDS.filter((f) => f.sortable).map((f) => f.key) as [string, ...string[]];

const FilterSchema = z.object({
  field: z.enum(fieldKeys),
  op: z.enum(["gt", "gte", "lt", "lte", "eq", "neq", "between", "in"]),
  value: z.union([z.number(), z.string(), z.array(z.number()), z.array(z.string())]),
});

// `.nullable()` rather than `.optional()` — structured outputs want every
// property present in `required`.
const ScreenIntentSchema = z.object({
  filters: z.array(FilterSchema),
  sort: z.object({ field: z.enum(sortableKeys), dir: z.enum(["asc", "desc"]) }).nullable(),
  universe: z.string().nullable(),
  valueBelowSectorMedian: z.boolean(),
  search: z.string().nullable(),
  notes: z.string(),
});

// --- Prompt ----------------------------------------------------------------

function fieldTable(): string {
  return FIELDS.map((f) => {
    const bits = [`${f.key} (${f.type}`, f.unit ? `, ${f.unit}` : "", ")"].join("");
    return `  ${bits.padEnd(34)} ${f.label}${f.help ? ` — ${f.help}` : ""}`;
  }).join("\n");
}

function presetExamples(): string {
  return PRESETS.filter((p) => p.filters.length > 0 || p.sort)
    .map((p) => {
      const intent = {
        filters: p.filters,
        sort: p.sort ?? null,
        universe: null,
        valueBelowSectorMedian: p.dynamic === "value",
        search: null,
        notes: "",
      };
      return `"${p.description}"\n${JSON.stringify(intent)}`;
    })
    .join("\n\n");
}

/** The stable half of the prompt — identical for every request and every market,
 *  so it is the cache breakpoint. (Opus 4.8 needs a 4096-token prefix before
 *  caching engages; below that it silently won't cache, which is harmless.) */
export function buildSystemRules(): string {
  return `You convert a plain-English stock-screening request into a ScreenIntent JSON object.

FIELDS — the only screenable columns. Never invent a field key.
${fieldTable()}

OPERATORS
  number fields: gt, gte, lt, lte, eq, neq, between   (NOT "in")
  enum/text fields (sector, symbol): in, eq, neq      (no numeric comparisons, no between)
  "between" takes [min, max]. "in" takes a non-empty array.

UNITS — the most common source of wrong answers. Read carefully.

1. MONEY (${MONEY_FIELDS.join(", ")}) is stored in MARKET-DEPENDENT units:
     IN market → Rs. Crore.     "₹10,000 crore" → 10000.   "₹1 lakh crore" → 100000.
     US market → USD millions.  "$10 billion"   → 10000.   "$500 million"  → 500.
   The active market is given below. Convert into THAT market's unit.
   Never emit a raw figure like 10000000000.

2. PERCENT fields (${PERCENT_FIELDS.join(", ")}) are percentage POINTS, not fractions.
     "ROE above 15%" → 15   (never 0.15)

3. EXCEPTION: debt_to_equity is a plain RATIO, not a percent.
     "debt to equity under 0.5" → 0.5   (not 50)

4. SIGNS on the 52-week fields:
     pct_from_52w_high is always <= 0  (0 = at the high, -12 = 12% below it)
       "within 5% of the 52-week high" → {"field":"pct_from_52w_high","op":"gte","value":-5}
     pct_from_52w_low is always >= 0
       "within 5% of the 52-week low"  → {"field":"pct_from_52w_low","op":"lte","value":5}

5. CAP BANDS use mcap_rank (1 = largest in that market), per SEBI:
     large cap → mcap_rank lte 100
     mid cap   → mcap_rank between [101, 250]
     small cap → mcap_rank gt 250

STRUCTURE — filters are combined with AND only. There is no OR, no NOT, no nesting.
  - "IT or pharma stocks" → ONE clause: {"field":"sector","op":"in","value":["IT","Pharma"]}
    (an "in" list IS the OR, for a single field)
  - "tech under 20 P/E OR banks under 15" spans two fields and is NOT REPRESENTABLE.
    Emit whichever single interpretation is most useful (or no filters), and say
    plainly in "notes" that the OR could not be applied. Never silently drop one side.

NOT FILTERS — these have their own slots. Never emit them as filter clauses:
  universe                "in the Nifty 50" → universe: "NIFTY_50" (allowed values given below)
  valueBelowSectorMedian  "cheap for its sector" / "P/E below its sector median" → true
  search                  a specific company name or symbol fragment
  sort                    "highest ROE" → {"field":"roe","dir":"desc"}
  market is fixed by the page — never a filter.

NULLS — a numeric filter EXCLUDES every row where that field is null, and not all
stocks have fundamentals. When a request leans on absence ("no debt", "companies
that pay no dividend"), note in "notes" that rows with unknown values are dropped.

NOTES — "" when everything was representable. Otherwise one or two plain sentences
about what you could not do. Do not restate the filters you did create.

EXAMPLES
${presetExamples()}`;
}

/** The volatile half — per-market enum values. Kept after the cache breakpoint. */
export function buildMarketContext(
  market: string,
  sectors: string[],
  universes: string[],
): string {
  return `ACTIVE MARKET: ${market}
Money fields are in ${market === "US" ? "USD millions" : "Rs. Crore"} for this market.

Valid sector values (use these EXACTLY, or omit the sector filter):
${sectors.length ? sectors.join(", ") : "(none loaded)"}

Valid universe values: ${universes.join(", ")}`;
}

// --- Sanitize ---------------------------------------------------------------

export interface SanitizeOptions {
  sectors: string[];
  universes: string[];
}

/** Catch what validateFilter() lets through. Each case below passes validation
 *  and then either matches nothing or throws at the pg layer. */
export function sanitizeIntent(raw: ScreenIntent, opts: SanitizeOptions): ScreenIntent {
  const dropped: string[] = [];
  const filters: Filter[] = [];

  for (const f of raw.filters) {
    const def = FIELD_BY_KEY[f.field];
    if (!def) { dropped.push(`unknown field "${f.field}"`); continue; }

    if (f.op === "between") {
      if (!Array.isArray(f.value) || f.value.length !== 2) {
        dropped.push(`${def.label}: "between" needs two bounds`);
        continue;
      }
      const lo = Number(f.value[0]);
      const hi = Number(f.value[1]);
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
        dropped.push(`${def.label}: non-numeric range bound`);
        continue;
      }
      // A reversed range validates fine and then matches zero rows.
      filters.push({ ...f, value: lo <= hi ? [lo, hi] : [hi, lo] });
      continue;
    }

    if (def.type === "number") {
      if (Array.isArray(f.value)) { dropped.push(`${def.label}: expected a single number`); continue; }
      const n = Number(f.value);
      // Number("abc") → NaN passes validateFilter, then throws a pg type error.
      if (!Number.isFinite(n)) { dropped.push(`${def.label}: "${f.value}" is not a number`); continue; }
      filters.push({ ...f, value: n });
      continue;
    }

    // Sector values are discovered per market at runtime, so the schema enum
    // can't cover them — check against the live list.
    if (f.field === "sector" && opts.sectors.length) {
      const known = new Set(opts.sectors);
      if (Array.isArray(f.value)) {
        const kept = f.value.filter((v) => known.has(String(v)));
        const lost = f.value.filter((v) => !known.has(String(v)));
        if (lost.length) dropped.push(`no such sector: ${lost.join(", ")}`);
        if (!kept.length) continue;
        filters.push({ ...f, value: kept });
        continue;
      }
      if (!known.has(String(f.value))) { dropped.push(`no such sector: ${f.value}`); continue; }
    }

    filters.push(f);
  }

  let sort = raw.sort;
  if (sort && !SORTABLE_KEYS.has(sort.field)) sort = null;

  let universe = raw.universe;
  if (universe && !opts.universes.includes(universe)) {
    dropped.push(`unknown universe "${universe}"`);
    universe = null;
  }

  const notes = [raw.notes?.trim(), dropped.length ? `Dropped: ${dropped.join("; ")}.` : ""]
    .filter(Boolean)
    .join(" ");

  return { ...raw, filters, sort, universe, notes };
}

// --- Model call -------------------------------------------------------------

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }
  client ??= new Anthropic();
  return client;
}

async function callModel(
  system: Anthropic.TextBlockParam[],
  messages: Anthropic.MessageParam[],
): Promise<ScreenIntent> {
  const message = await getClient().messages.parse({
    model: MODEL,
    max_tokens: 2048,
    // Adaptive thinking is off on Opus 4.8 unless set explicitly; the unit and
    // sign reasoning above benefits from a little. `low` effort keeps an
    // interactive search box responsive.
    thinking: { type: "adaptive" },
    output_config: { effort: "low", format: zodOutputFormat(ScreenIntentSchema) },
    system,
    messages,
  });
  if (!message.parsed_output) throw new Error("Could not interpret that query");
  return message.parsed_output as ScreenIntent;
}

export interface ParseScreenQueryInput {
  query: string;
  market: string;
  sectors: string[];
  universes: string[];
}

/** Turn a plain-English query into a validated ScreenIntent. Throws if the model
 *  cannot produce filters the engine accepts after one repair attempt. */
export async function parseScreenQuery(input: ParseScreenQueryInput): Promise<ScreenIntent> {
  const query = input.query.trim().slice(0, MAX_QUERY_CHARS);
  if (!query) throw new Error("Enter a query first");

  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: buildSystemRules(), cache_control: { type: "ephemeral" } },
    { type: "text", text: buildMarketContext(input.market, input.sectors, input.universes) },
  ];
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: query }];

  let intent = await callModel(system, messages);

  try {
    intent.filters.forEach(validateFilter);
  } catch (err) {
    // validateFilter's messages are already user-quality — hand it back verbatim
    // for exactly one repair attempt. If it fails again, surface the error.
    const reason = err instanceof Error ? err.message : String(err);
    intent = await callModel(system, [
      ...messages,
      {
        role: "user",
        content: `Your previous answer was rejected by the filter engine.

Answer: ${JSON.stringify(intent)}
Error: ${reason}

Fix only the clause that caused that error and return the corrected ScreenIntent. If the clause cannot be expressed with the available fields and operators, drop it and explain why in "notes".`,
      },
    ]);
    intent.filters.forEach(validateFilter);
  }

  return sanitizeIntent(intent, { sectors: input.sectors, universes: input.universes });
}
