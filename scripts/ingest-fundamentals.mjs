// Manual fundamentals ingestion. Reads a JSON payload file (FMP-style array of
// { ticker, currencyScale?, reports: [...] }) and upserts into
// asset_financial_reports. Mirrors lib/ingest/fundamentals.ts (the in-app
// version); standalone .mjs because the toolchain has no tsx.
//
// Usage: DATABASE_URL=... node --env-file=.env.local \
//          scripts/ingest-fundamentals.mjs <payload.json> [COUNTRY=IN]
import { readFileSync } from "node:fs";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) { console.error("DATABASE_URL required"); process.exit(1); }
const file = process.argv[2];
if (!file) { console.error("Usage: ingest-fundamentals.mjs <payload.json> [COUNTRY]"); process.exit(1); }
const country = process.argv[3] || "IN";

const CRORE = 1e7;
const SCALE = { CRORE: 1, LAKH: 1 / 100, MILLION: 0.1, BILLION: 100, ABSOLUTE: 1 / CRORE };
const toNum = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[,\s₹$]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const round = (n, dp) => { const f = 10 ** dp; return Math.round(n * f) / f; };
const toCrore = (v, s) => { const n = toNum(v); return n === null ? null : round(n * SCALE[s], 2); };
const yoy = (cur, prior) => (cur === null || prior === null || prior === 0 ? null : round(((cur - prior) / Math.abs(prior)) * 100, 4));
const classify = (r) => {
  const raw = `${r.reportType ?? ""} ${r.period ?? ""}`.toLowerCase();
  if (raw.includes("ttm") || raw.includes("trailing")) return "TTM";
  if (raw.includes("annual") || raw.includes("fy") || raw.includes("year")) return "ANNUAL";
  return "QUARTERLY";
};
const parseDate = (r) => {
  const raw = r.periodEndDate ?? r.date;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};
function derive(rec, company) {
  const periodEndDate = parseDate(rec);
  if (!periodEndDate) return null;
  const s = company.currencyScale ?? "ABSOLUTE";
  const revenue = toCrore(rec.revenue ?? rec.sales, s);
  const netProfit = toCrore(rec.netProfit ?? rec.netIncome, s);
  const operatingProfit = toCrore(rec.operatingProfit, s);
  const ebit = toCrore(rec.ebit, s);
  const capitalEmployed = toCrore(rec.capitalEmployed, s);
  const marketCap = toCrore(rec.marketCap, s);
  const eps = toNum(rec.eps);
  const cmp = toNum(rec.cmp ?? rec.price);
  let roce = toNum(rec.roce);
  if (roce === null && ebit !== null && capitalEmployed) roce = round((ebit / capitalEmployed) * 100, 4);
  let pe = toNum(rec.peRatio);
  if (pe === null && cmp !== null && eps !== null && eps > 0) pe = round(cmp / eps, 4);
  return { periodEndDate, reportType: classify(rec), fiscalPeriod: rec.fiscalPeriod ?? null,
    currency: company.currency ?? "INR", revenue, netProfit, operatingProfit, ebit,
    capitalEmployed, eps, cmp, peRatio: pe, marketCap, roce, source: company.source ?? null };
}
function priorYear(sorted, idx) {
  const cur = sorted[idx];
  const t = new Date(cur.periodEndDate); t.setUTCFullYear(t.getUTCFullYear() - 1);
  let best = null, bestDiff = Infinity;
  for (let j = 0; j < idx; j++) {
    if (sorted[j].reportType !== cur.reportType) continue;
    const diff = Math.abs(new Date(sorted[j].periodEndDate).getTime() - t.getTime());
    if (diff < bestDiff) { bestDiff = diff; best = sorted[j]; }
  }
  return bestDiff <= 45 * 86400000 ? best : null;
}

const payload = JSON.parse(readFileSync(file, "utf8"));
const cutoff = (() => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - 15); return d.toISOString().slice(0, 10); })();

const client = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  const { rows } = await client.query("select id,ticker from public.assets where country=$1", [country]);
  const idsByTicker = new Map();
  for (const r of rows) { const k = r.ticker.toUpperCase(); (idsByTicker.get(k) ?? idsByTicker.set(k, []).get(k)).push(r.id); }
  const COLS = 18;
  let parsed = 0, upserted = 0; const unmatched = [];
  for (const company of payload) {
    const assetIds = idsByTicker.get(company.ticker.toUpperCase());
    if (!assetIds || !assetIds.length) { unmatched.push(company.ticker); continue; }
    const base = company.reports.map((r) => derive(r, company))
      .filter((r) => r && r.periodEndDate >= cutoff)
      .sort((a, b) => a.periodEndDate.localeCompare(b.periodEndDate));
    const derived = base.map((r, i) => ({ ...r,
      profitVarianceYoY: yoy(r.netProfit, priorYear(base, i)?.netProfit ?? null),
      salesVarianceYoY: yoy(r.revenue, priorYear(base, i)?.revenue ?? null) }));
    parsed += derived.length;
    for (const assetId of assetIds)
    for (let i = 0; i < derived.length; i += 500) {
      const batch = derived.slice(i, i + 500); const vals = [], p = [];
      batch.forEach((r, j) => { const o = j * COLS;
        vals.push(`(${Array.from({ length: COLS }, (_, k) => `$${o + k + 1}`).join(",")})`);
        p.push(assetId, r.periodEndDate, r.reportType, r.fiscalPeriod, r.currency,
          r.revenue, r.netProfit, r.operatingProfit, r.ebit, r.capitalEmployed,
          r.eps, r.cmp, r.peRatio, r.marketCap, r.roce,
          r.profitVarianceYoY, r.salesVarianceYoY, r.source); });
      await client.query(
        `insert into public.asset_financial_reports
           (asset_id,period_end_date,report_type,fiscal_period,currency,revenue,net_profit,
            operating_profit,ebit,capital_employed,eps,cmp,pe_ratio,market_cap,roce,
            profit_variance_yoy,sales_variance_yoy,source)
         values ${vals.join(",")}
         on conflict (asset_id,period_end_date,report_type) do update set
           fiscal_period=excluded.fiscal_period,currency=excluded.currency,revenue=excluded.revenue,
           net_profit=excluded.net_profit,operating_profit=excluded.operating_profit,ebit=excluded.ebit,
           capital_employed=excluded.capital_employed,eps=excluded.eps,cmp=excluded.cmp,
           pe_ratio=excluded.pe_ratio,market_cap=excluded.market_cap,roce=excluded.roce,
           profit_variance_yoy=excluded.profit_variance_yoy,sales_variance_yoy=excluded.sales_variance_yoy,
           source=excluded.source,updated_at=now()`, p);
      upserted += batch.length;
    }
  }
  console.log(`done — companies:${payload.length} parsed:${parsed} upserted:${upserted} unmatched:${unmatched.length}`);
  if (unmatched.length) console.log("unmatched:", unmatched.slice(0, 20));
} catch (err) {
  console.error("ingest failed:", err.message); process.exitCode = 1;
} finally {
  await client.end();
}
