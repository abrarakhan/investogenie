// =============================================================================
// Corporate fundamentals ingestion pipeline.
// -----------------------------------------------------------------------------
// Accepts a multi-year structural financial JSON array (FMP-style or any
// open-source screener export), normalises monetary scales to Rs. Crore,
// derives trailing metrics (YoY profit/sales variance, ROCE, P/E) gracefully,
// keeps only the last 15 years, and upserts into asset_financial_reports with
//   ON CONFLICT (asset_id, period_end_date, report_type) DO UPDATE
// so revisions overwrite in place while historic quarters stay pristine.
//
// The pure helpers (normaliseToCrore / computeYoYVariance / deriveReport) are
// exported for unit testing and reuse.
// =============================================================================

import { Client } from "pg";
import type { ReportType } from "@/lib/types";

/** How incoming monetary values are scaled before conversion to Rs. Crore. */
export type CurrencyScale = "CRORE" | "LAKH" | "MILLION" | "BILLION" | "ABSOLUTE";

/** A single raw report record (field names are matched leniently). */
export interface RawFinancialRecord {
  /** Period end date (ISO or anything Date can parse). */
  date?: string;
  periodEndDate?: string;
  /** 'Q1'/'annual'/'quarter'/'FY' … mapped to a ReportType. */
  period?: string;
  reportType?: string;
  fiscalPeriod?: string;

  revenue?: number | string;
  sales?: number | string;
  netProfit?: number | string;
  netIncome?: number | string;
  operatingProfit?: number | string;
  ebit?: number | string;
  capitalEmployed?: number | string;

  eps?: number | string;
  price?: number | string;
  cmp?: number | string;
  peRatio?: number | string;
  marketCap?: number | string;
  roce?: number | string;
}

export interface CompanyFundamentals {
  ticker: string;
  /** Scale of monetary fields in this company's records (default ABSOLUTE INR). */
  currencyScale?: CurrencyScale;
  currency?: string;
  source?: string;
  reports: RawFinancialRecord[];
}

export type FundamentalsPayload = CompanyFundamentals[];

export interface FundamentalsSummary {
  companies: number;
  reportsParsed: number;
  reportsUpserted: number;
  tickersUnmatched: string[];
  durationMs: number;
}

// ---- pure helpers -----------------------------------------------------------

const CRORE = 1e7; // 1 crore = 10,000,000
const SCALE_TO_CRORE: Record<CurrencyScale, number> = {
  CRORE: 1,
  LAKH: 1 / 100, // 100 lakh = 1 crore
  MILLION: 0.1, // 1 million = 10 lakh = 0.1 crore
  BILLION: 100, // 1 billion = 100 crore
  ABSOLUTE: 1 / CRORE, // raw rupees → crore
};

const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[,\s₹$]/g, ""));
  return Number.isFinite(n) ? n : null;
};

const round = (n: number, dp: number) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

/** Convert a monetary figure to Rs. Crore at the given input scale. */
export function normaliseToCrore(value: unknown, scale: CurrencyScale = "ABSOLUTE"): number | null {
  const n = toNum(value);
  if (n === null) return null;
  return round(n * SCALE_TO_CRORE[scale], 2);
}

/** Percentage change vs a prior-year figure; null when either side is unusable. */
export function computeYoYVariance(current: number | null, prior: number | null): number | null {
  if (current === null || prior === null) return null;
  if (prior === 0) return null; // undefined growth off a zero base
  return round(((current - prior) / Math.abs(prior)) * 100, 4);
}

/** Map a free-form period/report label to a ReportType (defaults QUARTERLY). */
function classifyReportType(rec: RawFinancialRecord): ReportType {
  const raw = `${rec.reportType ?? ""} ${rec.period ?? ""}`.toLowerCase();
  if (raw.includes("ttm") || raw.includes("trailing")) return "TTM";
  if (raw.includes("annual") || raw.includes("fy") || raw.includes("year")) return "ANNUAL";
  return "QUARTERLY";
}

function parseDate(rec: RawFinancialRecord): string | null {
  const raw = rec.periodEndDate ?? rec.date;
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export interface NormalisedReport {
  periodEndDate: string;
  reportType: ReportType;
  fiscalPeriod: string | null;
  currency: string;
  revenue: number | null;
  netProfit: number | null;
  operatingProfit: number | null;
  ebit: number | null;
  capitalEmployed: number | null;
  eps: number | null;
  cmp: number | null;
  peRatio: number | null;
  marketCap: number | null;
  roce: number | null;
  profitVarianceYoY: number | null;
  salesVarianceYoY: number | null;
  source: string | null;
}

/**
 * Normalise + derive a single report. YoY variances require the matching prior
 * report (same report_type, ~1 year earlier) which the caller supplies; when it
 * is absent the variance degrades to null rather than throwing.
 */
export function deriveReport(
  rec: RawFinancialRecord,
  company: CompanyFundamentals,
  prior: NormalisedReport | null,
): NormalisedReport | null {
  const periodEndDate = parseDate(rec);
  if (!periodEndDate) return null;
  const scale = company.currencyScale ?? "ABSOLUTE";

  const revenue = normaliseToCrore(rec.revenue ?? rec.sales, scale);
  const netProfit = normaliseToCrore(rec.netProfit ?? rec.netIncome, scale);
  const operatingProfit = normaliseToCrore(rec.operatingProfit, scale);
  const ebit = normaliseToCrore(rec.ebit, scale);
  const capitalEmployed = normaliseToCrore(rec.capitalEmployed, scale);
  const marketCap = normaliseToCrore(rec.marketCap, scale);

  const eps = toNum(rec.eps);
  const cmp = toNum(rec.cmp ?? rec.price);

  // ROCE: prefer reported; else EBIT / Capital Employed.
  let roce = toNum(rec.roce);
  if (roce === null && ebit !== null && capitalEmployed && capitalEmployed !== 0) {
    roce = round((ebit / capitalEmployed) * 100, 4);
  }

  // P/E: prefer reported; else price / EPS when both are sane.
  let peRatio = toNum(rec.peRatio);
  if (peRatio === null && cmp !== null && eps !== null && eps > 0) {
    peRatio = round(cmp / eps, 4);
  }

  return {
    periodEndDate,
    reportType: classifyReportType(rec),
    fiscalPeriod: rec.fiscalPeriod ?? null,
    currency: company.currency ?? "INR",
    revenue,
    netProfit,
    operatingProfit,
    ebit,
    capitalEmployed,
    eps,
    cmp,
    peRatio,
    marketCap,
    roce,
    profitVarianceYoY: computeYoYVariance(netProfit, prior?.netProfit ?? null),
    salesVarianceYoY: computeYoYVariance(revenue, prior?.revenue ?? null),
    source: company.source ?? null,
  };
}

const fifteenYearsAgoISO = (): string => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - 15);
  return d.toISOString().slice(0, 10);
};

/** Find the prior-year same-grain report for YoY matching (±45-day tolerance). */
function findPriorYear(sorted: NormalisedReport[], idx: number): NormalisedReport | null {
  const cur = sorted[idx];
  const target = new Date(cur.periodEndDate);
  target.setUTCFullYear(target.getUTCFullYear() - 1);
  const targetMs = target.getTime();
  let best: NormalisedReport | null = null;
  let bestDiff = Infinity;
  for (let j = 0; j < idx; j++) {
    const c = sorted[j];
    if (c.reportType !== cur.reportType) continue;
    const diff = Math.abs(new Date(c.periodEndDate).getTime() - targetMs);
    if (diff < bestDiff) { bestDiff = diff; best = c; }
  }
  return bestDiff <= 45 * 86_400_000 ? best : null;
}

/**
 * Ingest a fundamentals payload into asset_financial_reports.
 * Resolves tickers against the Indian equity universe (country='IN').
 */
export async function ingestFundamentals(
  databaseUrl: string,
  payload: FundamentalsPayload,
  opts: { country?: string } = {},
): Promise<FundamentalsSummary> {
  const t0 = Date.now();
  const country = opts.country ?? "IN";
  const cutoff = fifteenYearsAgoISO();

  const client = new Client({ connectionString: databaseUrl, ssl: /127\.0\.0\.1|localhost/.test(databaseUrl) ? false : { rejectUnauthorized: false } });
  await client.connect();
  try {
    const { rows: assetRows } = await client.query<{ id: string; ticker: string }>(
      "select id, ticker from public.assets where country=$1",
      [country],
    );
    // A company's fundamentals apply to every listing of its ticker (NSE + BSE),
    // so map ticker -> all matching asset ids and upsert against each.
    const idsByTicker = new Map<string, string[]>();
    for (const r of assetRows) {
      const key = r.ticker.toUpperCase();
      (idsByTicker.get(key) ?? idsByTicker.set(key, []).get(key)!).push(r.id);
    }

    const COLS = 18;
    const tickersUnmatched: string[] = [];
    let reportsParsed = 0;
    let reportsUpserted = 0;

    for (const company of payload) {
      const assetIds = idsByTicker.get(company.ticker.toUpperCase());
      if (!assetIds || assetIds.length === 0) { tickersUnmatched.push(company.ticker); continue; }

      // Normalise first (without variance), sort ascending, then derive YoY.
      const base = company.reports
        .map((rec) => deriveReport(rec, company, null))
        .filter((r): r is NormalisedReport => r !== null && r.periodEndDate >= cutoff)
        .sort((a, b) => a.periodEndDate.localeCompare(b.periodEndDate));

      const derived = base.map((r, i) => ({
        ...r,
        profitVarianceYoY: computeYoYVariance(r.netProfit, findPriorYear(base, i)?.netProfit ?? null),
        salesVarianceYoY: computeYoYVariance(r.revenue, findPriorYear(base, i)?.revenue ?? null),
      }));
      reportsParsed += derived.length;
      if (derived.length === 0) continue;

      for (const assetId of assetIds)
      for (let i = 0; i < derived.length; i += 500) {
        const batch = derived.slice(i, i + 500);
        const vals: string[] = [];
        const params: unknown[] = [];
        batch.forEach((r, j) => {
          const o = j * COLS;
          vals.push(`(${Array.from({ length: COLS }, (_, k) => `$${o + k + 1}`).join(",")})`);
          params.push(
            assetId, r.periodEndDate, r.reportType, r.fiscalPeriod, r.currency,
            r.revenue, r.netProfit, r.operatingProfit, r.ebit, r.capitalEmployed,
            r.eps, r.cmp, r.peRatio, r.marketCap, r.roce,
            r.profitVarianceYoY, r.salesVarianceYoY, r.source,
          );
        });
        await client.query(
          `insert into public.asset_financial_reports
             (asset_id, period_end_date, report_type, fiscal_period, currency,
              revenue, net_profit, operating_profit, ebit, capital_employed,
              eps, cmp, pe_ratio, market_cap, roce,
              profit_variance_yoy, sales_variance_yoy, source)
           values ${vals.join(",")}
           on conflict (asset_id, period_end_date, report_type) do update set
             fiscal_period=excluded.fiscal_period, currency=excluded.currency,
             revenue=excluded.revenue, net_profit=excluded.net_profit,
             operating_profit=excluded.operating_profit, ebit=excluded.ebit,
             capital_employed=excluded.capital_employed, eps=excluded.eps,
             cmp=excluded.cmp, pe_ratio=excluded.pe_ratio, market_cap=excluded.market_cap,
             roce=excluded.roce, profit_variance_yoy=excluded.profit_variance_yoy,
             sales_variance_yoy=excluded.sales_variance_yoy, source=excluded.source,
             updated_at=now()`,
          params,
        );
        reportsUpserted += batch.length;
      }
    }

    return {
      companies: payload.length,
      reportsParsed,
      reportsUpserted,
      tickersUnmatched,
      durationMs: Date.now() - t0,
    };
  } finally {
    await client.end();
  }
}
