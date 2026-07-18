// Composable filter engine for the stock screener.
//
// A screen is a list of filter clauses combined with AND. Each clause is
// { field, op, value }. The engine offers two evaluators that share one set of
// semantics, so what the server returns and what any client-side preview shows
// can never disagree:
//
//   * evaluate()/applyFilters() — pure, in-memory (used by unit tests and the
//     dashboard widget)
//   * toSqlWhere()             — parameterised SQL fragment (used by the API for
//     server-side filtering over 500+ rows)
//
// Null semantics (per product spec): a NULL field value never satisfies a
// numeric comparison — the row is excluded rather than treated as 0. In SQL this
// falls out naturally (`null > 5` → NULL → not matched); in JS we enforce it.

import { FIELD_BY_KEY, SORTABLE_KEYS, type FieldDef } from "./fields";

export type Operator = "gt" | "gte" | "lt" | "lte" | "eq" | "neq" | "between" | "in";

export interface Filter {
  field: string;
  op: Operator;
  value: number | string | boolean | Array<number | string>;
}

export interface SortSpec {
  field: string;
  dir: "asc" | "desc";
}

const NUMERIC_OPS: Operator[] = ["gt", "gte", "lt", "lte", "eq", "neq", "between"];
const ENUM_OPS: Operator[] = ["in", "eq", "neq"];
const TEXT_OPS: Operator[] = ["eq", "neq", "in"];

function opsForType(type: FieldDef["type"]): Operator[] {
  if (type === "number") return NUMERIC_OPS;
  if (type === "enum") return ENUM_OPS;
  return TEXT_OPS;
}

/** Throw with a clear message if a filter references an unknown field, an
 *  operator the field's type does not support, or a value shape that does not
 *  match the operator. Returns the resolved field definition. */
export function validateFilter(filter: Filter): FieldDef {
  const def = FIELD_BY_KEY[filter.field];
  if (!def) throw new Error(`Unknown screener field: ${filter.field}`);
  if (!opsForType(def.type).includes(filter.op)) {
    throw new Error(`Operator "${filter.op}" is not valid for field "${filter.field}" (${def.type})`);
  }
  if (filter.op === "between") {
    if (!Array.isArray(filter.value) || filter.value.length !== 2) {
      throw new Error(`"between" on "${filter.field}" needs a [min, max] value`);
    }
  } else if (filter.op === "in") {
    if (!Array.isArray(filter.value) || filter.value.length === 0) {
      throw new Error(`"in" on "${filter.field}" needs a non-empty array value`);
    }
  } else if (Array.isArray(filter.value)) {
    throw new Error(`Operator "${filter.op}" on "${filter.field}" expects a scalar value`);
  }
  return def;
}

const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Evaluate one clause against one row. NULL/absent numeric values never match a
 *  numeric operator (they are excluded, not coerced to 0). */
export function evaluate(row: Record<string, unknown>, filter: Filter): boolean {
  const def = FIELD_BY_KEY[filter.field];
  if (!def) return false;
  const raw = row[def.column] ?? row[filter.field];

  if (def.type === "number") {
    const n = toNum(raw);
    if (n === null) return false; // null excluded from numeric filters
    switch (filter.op) {
      case "gt": return n > Number(filter.value);
      case "gte": return n >= Number(filter.value);
      case "lt": return n < Number(filter.value);
      case "lte": return n <= Number(filter.value);
      case "eq": return n === Number(filter.value);
      case "neq": return n !== Number(filter.value);
      case "between": {
        const [lo, hi] = filter.value as number[];
        return n >= Number(lo) && n <= Number(hi);
      }
      default: return false;
    }
  }

  // text / enum
  const s = raw === null || raw === undefined ? null : String(raw);
  switch (filter.op) {
    case "eq": return s !== null && s === String(filter.value);
    case "neq": return s === null || s !== String(filter.value); // null passes a "not equal"
    case "in": return s !== null && (filter.value as Array<string | number>).map(String).includes(s);
    default: return false;
  }
}

/** AND-combine every clause. An empty filter list matches all rows. */
export function applyFilters<T extends Record<string, unknown>>(rows: T[], filters: Filter[]): T[] {
  if (!filters.length) return rows;
  return rows.filter((row) => filters.every((f) => evaluate(row, f)));
}

/** In-memory sort mirroring the SQL ordering: NULLs always sort last. */
export function applySort<T extends Record<string, unknown>>(rows: T[], sort?: SortSpec): T[] {
  if (!sort || !SORTABLE_KEYS.has(sort.field)) return rows;
  const def = FIELD_BY_KEY[sort.field];
  const col = def.column;
  const dir = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[col] ?? a[sort.field];
    const bv = b[col] ?? b[sort.field];
    const an = def.type === "number" ? toNum(av) : (av == null ? null : String(av));
    const bn = def.type === "number" ? toNum(bv) : (bv == null ? null : String(bv));
    if (an === null && bn === null) return 0;
    if (an === null) return 1; // nulls last regardless of direction
    if (bn === null) return -1;
    if (an < bn) return -1 * dir;
    if (an > bn) return 1 * dir;
    return 0;
  });
}

export interface SqlWhere {
  clauses: string[];
  params: unknown[];
}

/** Build a parameterised WHERE fragment. `startIndex` is the next positional
 *  parameter number ($n) to use, so the caller can prepend its own params
 *  (e.g. country). Returns the clause list (AND them) and the param values. */
export function toSqlWhere(filters: Filter[], startIndex = 1): SqlWhere {
  const clauses: string[] = [];
  const params: unknown[] = [];
  let i = startIndex;
  for (const filter of filters) {
    const def = validateFilter(filter);
    const col = `s.${def.column}`;
    switch (filter.op) {
      case "gt": clauses.push(`${col} > $${i++}`); params.push(filter.value); break;
      case "gte": clauses.push(`${col} >= $${i++}`); params.push(filter.value); break;
      case "lt": clauses.push(`${col} < $${i++}`); params.push(filter.value); break;
      case "lte": clauses.push(`${col} <= $${i++}`); params.push(filter.value); break;
      case "eq": clauses.push(`${col} = $${i++}`); params.push(filter.value); break;
      case "neq": clauses.push(`(${col} is null or ${col} <> $${i++})`); params.push(filter.value); break;
      case "between": {
        const [lo, hi] = filter.value as number[];
        clauses.push(`${col} between $${i++} and $${i++}`);
        params.push(lo, hi);
        break;
      }
      case "in": clauses.push(`${col} = any($${i++})`); params.push(filter.value); break;
    }
  }
  return { clauses, params };
}

/** Build a safe ORDER BY from a sort spec, defaulting to the given fallback.
 *  Only whitelisted sortable columns are allowed; NULLs sort last. */
export function toOrderBy(sort: SortSpec | undefined, fallback: SortSpec): string {
  const spec = sort && SORTABLE_KEYS.has(sort.field) ? sort : fallback;
  const def = FIELD_BY_KEY[spec.field];
  const dir = spec.dir === "asc" ? "asc" : "desc";
  return `order by s.${def.column} ${dir} nulls last, s.symbol asc`;
}
