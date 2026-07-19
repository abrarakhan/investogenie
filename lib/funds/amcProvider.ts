// AmcDisclosureProvider: the PRIMARY FundDataProvider. Ingests AMC monthly
// portfolio disclosure files (parsed by scripts/extract-amc-portfolio.py — the
// same parser the CAS-page import uses) into the month-keyed snapshot tables,
// and serves reads back out of them.
//
// Ingest is where validation lives: a snapshot whose weights don't sum to
// ~100% (±2) is REJECTED here, because once stored it silently poisons every
// overlap number computed from it. The legacy user_mutual_fund_holdings write
// in the CAS import is untouched by any of this — these tables are additive.

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { query, queryOne, tx } from "../db";
import {
  classifyInstrument,
  pseudoIsin,
  validateWeights,
  type FundDataProvider,
  type HoldingLine,
  type HoldingsSnapshot,
  type SchemeMeta,
} from "./provider";

const execFileAsync = promisify(execFile);

export const AMC_SOURCE = "AMC_DISCLOSURE";

export interface ParsedDisclosureRow {
  stock_name: string;
  isin: string | null;
  ticker: string | null;
  weight_percentage: number;
}

export interface DisclosureParseResult {
  rows: ParsedDisclosureRow[];
}

export type DisclosureParseError = "bad_password" | "parser_failed";

export interface ParseDisclosureOptions {
  password?: string;
  /** Keep cash/debt/TREPS lines so the snapshot can pass validateWeights.
   *  The CAS route's equity-only behavior is the default. */
  full?: boolean;
  /** AMC monthly workbooks carry one sheet per scheme; select one by name
   *  substring or every scheme merges into a single bogus snapshot. */
  sheet?: string;
}

async function runParser(
  filePath: string,
  opts: ParseDisclosureOptions,
): Promise<DisclosureParseResult | DisclosureParseError> {
  try {
    const python = process.env.CAS_PDF_PYTHON ?? process.env.PYTHON_BIN ?? "python3";
    const script = join(process.cwd(), "scripts/extract-amc-portfolio.py");
    const args = [script, filePath];
    if (opts.password) args.push("--password", opts.password);
    if (opts.full) args.push("--full");
    if (opts.sheet) args.push("--sheet", opts.sheet);
    const { stdout } = await execFileAsync(python, args, { maxBuffer: 40 * 1024 * 1024 });
    return JSON.parse(stdout) as DisclosureParseResult;
  } catch (error) {
    const stderr = typeof error === "object" && error && "stderr" in error ? String(error.stderr) : "";
    if (stderr.includes("password") && stderr.includes("unlock")) return "bad_password";
    console.error("AMC disclosure parser failed", stderr || error);
    return "parser_failed";
  }
}

/** Parse a disclosure from an uploaded File (staged to a temp path, as the CAS
 *  import always did) or straight from a path on disk (CLI / sync job). */
export async function parseDisclosureSource(
  source: File | { path: string },
  opts: ParseDisclosureOptions = {},
): Promise<DisclosureParseResult | DisclosureParseError> {
  if (!(source instanceof File)) return runParser(source.path, opts);

  const dir = join(tmpdir(), "investogenie-amc");
  await mkdir(dir, { recursive: true });
  const safeExt = source.name.match(/\.[a-z0-9]+$/i)?.[0] ?? ".dat";
  const inputPath = join(dir, `${randomUUID()}${safeExt}`);
  await writeFile(inputPath, Buffer.from(await source.arrayBuffer()));
  try {
    return await runParser(inputPath, opts);
  } finally {
    await unlink(inputPath).catch(() => {});
  }
}

/** Thrown when a parsed snapshot fails the ±2% weight-sum check. Callers that
 *  must not fail the surrounding flow (the CAS import) catch this and log. */
export class SnapshotRejectedError extends Error {
  constructor(
    readonly schemeCode: string,
    readonly month: string,
    readonly totalWeightPct: number,
    reason: string,
  ) {
    super(`snapshot rejected for ${schemeCode} ${month}: ${reason}`);
    this.name = "SnapshotRejectedError";
  }
}

function monthStart(input: string): string {
  const m = input.match(/^(\d{4})-(\d{2})/);
  if (!m) throw new Error(`invalid month '${input}', expected YYYY-MM or YYYY-MM-DD`);
  return `${m[1]}-${m[2]}-01`;
}

/** Turn parsed rows into HoldingLines: classify, key by (pseudo-)ISIN, and
 *  merge rows that collapse onto the same key so the PK cannot conflict. */
export function toHoldingLines(rows: ParsedDisclosureRow[]): HoldingLine[] {
  const byKey = new Map<string, HoldingLine>();
  for (const row of rows) {
    const name = row.stock_name.trim();
    if (!name || !Number.isFinite(row.weight_percentage)) continue;
    const isin = row.isin?.toUpperCase() ?? null;
    const type = classifyInstrument(name, isin);
    const key = isin && (type === "EQUITY" || type === "DEBT") ? isin : pseudoIsin(type, name);
    const existing = byKey.get(key);
    if (existing) {
      existing.weightPct += row.weight_percentage;
    } else {
      byKey.set(key, {
        instrumentIsin: key,
        instrumentName: name,
        weightPct: row.weight_percentage,
        sector: null,
        instrumentType: type,
      });
    }
  }
  const lines = [...byKey.values()];

  // Some AMC workbooks store "% to NAV" as fractions (0.0985 for 9.85%). If
  // the sheet-wide total lands near 1 instead of near 100, rescale.
  const total = lines.reduce((s, l) => s + l.weightPct, 0);
  if (total > 0.5 && total < 2) {
    for (const line of lines) line.weightPct = Number((line.weightPct * 100).toFixed(6));
  }
  return lines.sort((a, b) => b.weightPct - a.weightPct);
}

export interface IngestInput {
  meta: SchemeMeta;
  /** Disclosure month, YYYY-MM or any YYYY-MM-DD within it. */
  month: string;
  rows: ParsedDisclosureRow[];
  /** Link to public.assets when the scheme maps to a user-held asset. */
  assetId?: string | null;
}

export class AmcDisclosureProvider implements FundDataProvider {
  readonly name = AMC_SOURCE;

  async isAvailable(): Promise<boolean> {
    try {
      await query("select 1");
      return true;
    } catch {
      return false;
    }
  }

  /** Validate then persist one scheme-month snapshot. Idempotent per
   *  (scheme, month): re-ingesting a month replaces that month only. */
  async ingestSnapshot(input: IngestInput): Promise<HoldingsSnapshot> {
    const month = monthStart(input.month);
    const lines = toHoldingLines(input.rows);
    const verdict = validateWeights(lines);
    if (!verdict.ok) {
      throw new SnapshotRejectedError(input.meta.schemeCode, month, verdict.total, verdict.reason ?? "invalid weights");
    }

    await tx(async (c) => {
      await c.query(
        `insert into public.fund_schemes
           (scheme_code, isin, name, amc, category, sub_category, asset_id, source, last_synced_at, latest_month)
         values ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9::date)
         on conflict (scheme_code) do update set
           isin          = coalesce(excluded.isin, fund_schemes.isin),
           name          = excluded.name,
           amc           = coalesce(excluded.amc, fund_schemes.amc),
           category      = coalesce(excluded.category, fund_schemes.category),
           sub_category  = coalesce(excluded.sub_category, fund_schemes.sub_category),
           asset_id      = coalesce(excluded.asset_id, fund_schemes.asset_id),
           source        = excluded.source,
           last_synced_at = now(),
           latest_month  = greatest(coalesce(fund_schemes.latest_month, excluded.latest_month), excluded.latest_month)`,
        [
          input.meta.schemeCode,
          input.meta.isin,
          input.meta.name,
          input.meta.amc,
          input.meta.category,
          input.meta.subCategory,
          input.assetId ?? null,
          AMC_SOURCE,
          month,
        ],
      );

      await c.query(
        "delete from public.fund_holdings_snapshot where scheme_code = $1 and month = $2::date",
        [input.meta.schemeCode, month],
      );
      for (const line of lines) {
        await c.query(
          `insert into public.fund_holdings_snapshot
             (scheme_code, month, instrument_isin, instrument_name, weight_pct, sector, instrument_type, source)
           values ($1, $2::date, $3, $4, $5, $6, $7::fund_instrument_type, $8)`,
          [
            input.meta.schemeCode,
            month,
            line.instrumentIsin,
            line.instrumentName,
            line.weightPct,
            line.sector,
            line.instrumentType,
            AMC_SOURCE,
          ],
        );
        if (line.instrumentType === "EQUITY" || line.instrumentType === "DEBT") {
          if (!line.instrumentIsin.includes(":")) {
            await c.query(
              `insert into public.instrument_name_variants (isin, name)
               values ($1, $2)
               on conflict (isin, name) do update set
                 seen_count = instrument_name_variants.seen_count + 1,
                 last_seen  = now()`,
              [line.instrumentIsin, line.instrumentName],
            );
          }
        }
      }
    });

    return { schemeCode: input.meta.schemeCode, month, lines, source: AMC_SOURCE };
  }

  async searchSchemes(q: string): Promise<SchemeMeta[]> {
    const rows = await query<SchemeRow>(
      `${SCHEME_SELECT}
        where source = $2 and (name ilike $1 or amc ilike $1)
        order by lower(name) limit 20`,
      [`%${q}%`, AMC_SOURCE],
    );
    return rows.map(toSchemeMeta);
  }

  async getSchemeMeta(schemeCode: string): Promise<SchemeMeta | null> {
    const row = await queryOne<SchemeRow>(
      `${SCHEME_SELECT} where scheme_code = $1 and source = $2`,
      [schemeCode, AMC_SOURCE],
    );
    return row ? toSchemeMeta(row) : null;
  }

  async getHoldings(schemeCode: string, month?: string): Promise<HoldingsSnapshot | null> {
    const target = month
      ? monthStart(month)
      : (await queryOne<{ month: string }>(
          `select to_char(max(month), 'YYYY-MM-DD') as month
             from public.fund_holdings_snapshot where scheme_code = $1 and source = $2`,
          [schemeCode, AMC_SOURCE],
        ))?.month;
    if (!target) return null;

    const rows = await query<HoldingRow>(
      `select instrument_isin, instrument_name, weight_pct::float8 as weight_pct,
              sector, instrument_type, rating,
              to_char(maturity_date, 'YYYY-MM-DD') as maturity_date, coupon_pct::float8 as coupon_pct
         from public.fund_holdings_snapshot
        where scheme_code = $1 and month = $2::date and source = $3
        order by weight_pct desc`,
      [schemeCode, target, AMC_SOURCE],
    );
    if (rows.length === 0) return null;

    return {
      schemeCode,
      month: target,
      source: AMC_SOURCE,
      lines: rows.map((r) => ({
        instrumentIsin: r.instrument_isin,
        instrumentName: r.instrument_name,
        weightPct: r.weight_pct,
        sector: r.sector,
        instrumentType: r.instrument_type,
        rating: r.rating,
        maturityDate: r.maturity_date,
        couponPct: r.coupon_pct,
      })),
    };
  }

  async listSnapshots(schemeCode: string): Promise<string[]> {
    const rows = await query<{ month: string }>(
      `select distinct to_char(month, 'YYYY-MM-DD') as month
         from public.fund_holdings_snapshot
        where scheme_code = $1 and source = $2
        order by month desc`,
      [schemeCode, AMC_SOURCE],
    );
    return rows.map((r) => r.month);
  }
}

const SCHEME_SELECT = `
  select scheme_code, isin, name, amc, category, sub_category
    from public.fund_schemes`;

interface SchemeRow {
  scheme_code: string;
  isin: string | null;
  name: string;
  amc: string | null;
  category: string | null;
  sub_category: string | null;
}

interface HoldingRow {
  instrument_isin: string;
  instrument_name: string;
  weight_pct: number;
  sector: string | null;
  instrument_type: HoldingLine["instrumentType"];
  rating: string | null;
  maturity_date: string | null;
  coupon_pct: number | null;
}

function toSchemeMeta(row: SchemeRow): SchemeMeta {
  return {
    schemeCode: row.scheme_code,
    isin: row.isin,
    name: row.name,
    amc: row.amc,
    category: row.category,
    subCategory: row.sub_category,
  };
}
