// Core latest-price ingestion, shared by the cron API route and any manual
// runner. Fetches the whole US + India universe and upserts into latest_quotes.
//   • US  — NASDAQ screener API (lastsale across NASDAQ/NYSE/AMEX)
//   • NSE — sec_bhavdata_full bhavcopy (latest session close)
//   • BSE — BhavCopy_BSE_CM UDiFF bhavcopy (latest session close)
import { Client } from "pg";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
const MON: Record<string, number> = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
const NSE_EQUITY_SERIES = new Set(["EQ", "BE", "BZ", "SM", "ST", "SZ"]);

export interface RefreshSummary {
  matched: number;
  bySource: Record<string, number>;
  durationMs: number;
}

interface RawQuote { price: number; changePct: number | null; source?: string }

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ",") { out.push(cur); cur = ""; } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}
const num = (s: unknown): number | null => {
  const n = parseFloat(String(s ?? "").replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const ddmmyyyy = (d: Date) => `${String(d.getUTCDate()).padStart(2,"0")}${String(d.getUTCMonth()+1).padStart(2,"0")}${d.getUTCFullYear()}`;
const yyyymmdd = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,"0")}${String(d.getUTCDate()).padStart(2,"0")}`;

async function fetchUS(): Promise<Map<string, RawQuote>> {
  const quotes = new Map<string, RawQuote>();
  for (const exchange of ["NASDAQ", "NYSE", "AMEX"]) {
    const url = `https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&offset=0&exchange=${exchange}`;
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json", Referer: "https://www.nasdaq.com/" } });
    if (!res.ok) continue;
    const json = await res.json();
    const rows = json?.data?.table?.rows ?? json?.data?.rows ?? [];
    for (const r of rows) {
      const t = (r.symbol || "").toUpperCase().trim();
      const price = num(r.lastsale);
      if (!t || price === null || price === 0) continue;
      quotes.set(t, { price, changePct: num(r.pctchange) });
    }
  }
  return quotes;
}

async function fetchNSEIndices(): Promise<Map<string, RawQuote>> {
  const quotes = new Map<string, RawQuote>();
  const res = await fetch("https://www.nseindia.com/api/allIndices", {
    headers: {
      "User-Agent": UA,
      Accept: "application/json",
      Referer: "https://www.nseindia.com/",
    },
  }).catch(() => null);
  if (!res || !res.ok) return quotes;

  const json = await res.json().catch(() => null);
  const rows = Array.isArray(json?.data) ? json.data : [];
  const aliases: Record<string, string> = {
    "NIFTY 50": "NIFTY",
  };

  for (const r of rows) {
    const indexName = String(r.index ?? r.indexSymbol ?? "").toUpperCase().trim();
    const ticker = aliases[indexName];
    const price = num(r.last);
    if (!ticker || price === null || price === 0) continue;
    quotes.set(ticker, { price, changePct: num(r.percentChange) });
  }
  return quotes;
}

async function fetchDirectBenchmarks(): Promise<Map<string, RawQuote>> {
  const quotes = new Map<string, RawQuote>();

  const [sensexRes, usdInr] = await Promise.all([
    fetch("https://priceapi.moneycontrol.com/pricefeed/notapplicable/inidicesindia/in%3BSEN", {
      headers: { "User-Agent": UA, Accept: "application/json" },
    }).catch(() => null),
    fetchUsdInr(),
  ]);

  if (sensexRes?.ok) {
    const json = await sensexRes.json().catch(() => null);
    const price = num(json?.data?.pricecurrent);
    if (price !== null) quotes.set("SENSEX", { price, changePct: num(json?.data?.pricepercentchange) });
  }

  if (usdInr !== null) quotes.set("USDINR", { price: usdInr.price, changePct: null, source: usdInr.source });

  return quotes;
}

function validUsdInr(value: unknown): number | null {
  const price = num(value);
  return price !== null && price >= 50 && price <= 150 ? price : null;
}

async function fetchUsdInr(): Promise<{ price: number; source: string } | null> {
  const yahoo = await fetch("https://query2.finance.yahoo.com/v8/finance/chart/INR=X?range=5d&interval=1d", {
    headers: { "User-Agent": UA, Accept: "application/json" },
  }).catch(() => null);
  if (yahoo?.ok) {
    const json = await yahoo.json().catch(() => null);
    const result = json?.chart?.result?.[0];
    const metaPrice = validUsdInr(result?.meta?.regularMarketPrice);
    if (metaPrice !== null) return { price: metaPrice, source: "YAHOO_FX" };
    const closes = Array.isArray(result?.indicators?.quote?.[0]?.close) ? result.indicators.quote[0].close : [];
    for (let i = closes.length - 1; i >= 0; i--) {
      const close = validUsdInr(closes[i]);
      if (close !== null) return { price: close, source: "YAHOO_FX" };
    }
  }

  const currencyApi = await fetch("https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json", {
    headers: { "User-Agent": UA, Accept: "application/json" },
  }).catch(() => null);
  if (currencyApi?.ok) {
    const json = await currencyApi.json().catch(() => null);
    const price = validUsdInr(json?.usd?.inr);
    if (price !== null) return { price, source: "CURRENCY_API" };
  }

  const frankfurter = await fetch("https://api.frankfurter.app/latest?from=USD&to=INR", {
    headers: { "User-Agent": UA, Accept: "application/json" },
  }).catch(() => null);
  if (frankfurter?.ok) {
    const json = await frankfurter.json().catch(() => null);
    const price = validUsdInr(json?.rates?.INR);
    if (price !== null) return { price, source: "FRANKFURTER_FX" };
  }

  const erApi = await fetch("https://open.er-api.com/v6/latest/USD", {
    headers: { "User-Agent": UA, Accept: "application/json" },
  }).catch(() => null);
  if (erApi?.ok) {
    const json = await erApi.json().catch(() => null);
    const price = validUsdInr(json?.rates?.INR);
    if (price !== null) return { price, source: "ER_API_FX" };
  }

  return null;
}

async function fetchBhavSeries(
  startISO: string,
  build: (text: string) => { quotes: Map<string, RawQuote>; asOf: string | null } | null,
  url: (d: Date) => string,
): Promise<{ quotes: Map<string, RawQuote>; asOf: string | null }> {
  const start = new Date(`${startISO}T00:00:00Z`);
  for (let i = 0; i < 8; i++) {
    const d = new Date(start); d.setUTCDate(d.getUTCDate() - i);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const res = await fetch(url(d), { headers: { "User-Agent": UA, Referer: "https://www.nseindia.com/" } }).catch(() => null);
    if (!res || !res.ok) continue;
    const built = build(await res.text());
    if (built && built.quotes.size) return built;
  }
  return { quotes: new Map(), asOf: null };
}

function buildNSE(text: string) {
  if (!text.includes("SERIES")) return null;
  const lines = text.split(/\r?\n/).filter(Boolean);
  const h = parseCsvLine(lines[0]); const col = (n: string) => h.indexOf(n);
  const iSym = col("SYMBOL"), iSer = col("SERIES"), iDate = col("DATE1");
  const iLast = col("LAST_PRICE"), iClose = col("CLOSE_PRICE"), iPrev = col("PREV_CLOSE");
  const quotes = new Map<string, RawQuote>(); let asOf: string | null = null;
  for (let k = 1; k < lines.length; k++) {
    const p = parseCsvLine(lines[k]);
    if (!NSE_EQUITY_SERIES.has(p[iSer])) continue;
    const price = num(p[iLast]) ?? num(p[iClose]); if (price === null || price === 0) continue;
    const prev = num(p[iPrev]);
    const [dd, mon, yyyy] = p[iDate].split("-");
    asOf = `${yyyy}-${String(MON[mon]+1).padStart(2,"0")}-${dd.padStart(2,"0")}`;
    quotes.set(p[iSym].toUpperCase(), { price, changePct: prev ? ((price - prev) / prev) * 100 : null });
  }
  return { quotes, asOf };
}

function buildBSE(text: string) {
  if (!text.includes("TckrSymb")) return null;
  const lines = text.split(/\r?\n/).filter(Boolean);
  const h = parseCsvLine(lines[0]); const col = (n: string) => h.indexOf(n);
  const iSym = col("TckrSymb"), iTp = col("FinInstrmTp"), iDate = col("TradDt");
  const iLast = col("LastPric"), iClose = col("ClsPric"), iPrev = col("PrvsClsgPric");
  const quotes = new Map<string, RawQuote>(); let asOf: string | null = null;
  for (let k = 1; k < lines.length; k++) {
    const p = parseCsvLine(lines[k]);
    if (p[iTp] !== "STK") continue;
    const price = num(p[iLast]) ?? num(p[iClose]); if (price === null || price === 0) continue;
    const prev = num(p[iPrev]);
    asOf = p[iDate];
    quotes.set(p[iSym].toUpperCase(), { price, changePct: prev ? ((price - prev) / prev) * 100 : null });
  }
  return { quotes, asOf };
}

export async function refreshQuotes(databaseUrl: string, startISO = new Date().toISOString().slice(0, 10)): Promise<RefreshSummary> {
  const t0 = Date.now();
  const [usQuotes, nseIndices, directBenchmarks, nse, bse] = await Promise.all([
    fetchUS(),
    fetchNSEIndices(),
    fetchDirectBenchmarks(),
    fetchBhavSeries(startISO, buildNSE, (d) => `https://archives.nseindia.com/products/content/sec_bhavdata_full_${ddmmyyyy(d)}.csv`),
    fetchBhavSeries(startISO, buildBSE, (d) => `https://www.bseindia.com/download/BhavCopy/Equity/BhavCopy_BSE_CM_0_0_0_${yyyymmdd(d)}_F_0000.CSV`),
  ]);

  const client = new Client({ connectionString: databaseUrl, ssl: /127\.0\.0\.1|localhost/.test(databaseUrl) ? false : { rejectUnauthorized: false } });
  await client.connect();
  try {
    const toMap = (rows: { ticker: string; id: string }[]) =>
      new Map<string, string>(rows.map((r) => [r.ticker, r.id]));
    const usMap = toMap((await client.query("select id,ticker from public.assets where country='US'")).rows);
    const nseMap = toMap((await client.query("select id,ticker from public.assets where exchange='NSE'")).rows);
    const bseMap = toMap((await client.query("select id,ticker from public.assets where exchange='BSE'")).rows);
    const directMap = toMap((await client.query("select id,ticker from public.assets where ticker = any($1)", [["SENSEX", "USDINR"]])).rows);

    const rows: { assetId: string; price: number; changePct: number | null; currency: string; asOf: string | null; source: string }[] = [];
    for (const [t, q] of usQuotes) { const id = usMap.get(t); if (id) rows.push({ assetId: id, price: q.price, changePct: q.changePct, currency: "USD", asOf: null, source: "NASDAQ" }); }
    for (const [t, q] of nseIndices) { const id = nseMap.get(t); if (id) rows.push({ assetId: id, price: q.price, changePct: q.changePct, currency: "INR", asOf: startISO, source: "NSE_INDEX" }); }
    for (const [t, q] of directBenchmarks) { const id = directMap.get(t); if (id) rows.push({ assetId: id, price: q.price, changePct: q.changePct, currency: "INR", asOf: startISO, source: q.source ?? "DIRECT_QUOTE" }); }
    for (const [t, q] of nse.quotes) { const id = nseMap.get(t); if (id) rows.push({ assetId: id, price: q.price, changePct: q.changePct, currency: "INR", asOf: nse.asOf, source: "NSE_BHAVCOPY" }); }
    for (const [t, q] of bse.quotes) { const id = bseMap.get(t); if (id) rows.push({ assetId: id, price: q.price, changePct: q.changePct, currency: "INR", asOf: bse.asOf, source: "BSE_BHAVCOPY" }); }

    const cols = 6;
    for (let i = 0; i < rows.length; i += 1000) {
      const batch = rows.slice(i, i + 1000);
      const vals: string[] = [], params: unknown[] = [];
      batch.forEach((r, j) => { const b = j * cols;
        vals.push(`($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6})`);
        params.push(r.assetId, r.price, r.changePct, r.currency, r.asOf, r.source); });
      await client.query(
        `insert into public.latest_quotes (asset_id, price, change_pct, currency, as_of, source)
         values ${vals.join(",")}
         on conflict (asset_id) do update set price=excluded.price, change_pct=excluded.change_pct,
           currency=excluded.currency, as_of=excluded.as_of, source=excluded.source, updated_at=now()`,
        params);
    }

    return {
      matched: rows.length,
      bySource: { NASDAQ: usQuotes.size, NSE_INDEX: nseIndices.size, DIRECT_QUOTE: directBenchmarks.size, NSE_BHAVCOPY: nse.quotes.size, BSE_BHAVCOPY: bse.quotes.size },
      durationMs: Date.now() - t0,
    };
  } finally {
    await client.end();
  }
}
