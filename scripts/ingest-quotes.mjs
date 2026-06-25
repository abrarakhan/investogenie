// Fetches the LATEST price for the entire US + Indian listed universe and
// upserts it into public.latest_quotes.
//   • US  — NASDAQ screener API (lastsale across NASDAQ/NYSE/AMEX)
//   • NSE — sec_bhavdata_full bhavcopy (latest session close)
//   • BSE — BhavCopy_BSE_CM UDiFF bhavcopy (latest session close)
//
//   DATABASE_URL=postgresql://... node scripts/ingest-quotes.mjs
import pg from "pg";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
const START = new Date("2025-06-13T00:00:00Z"); // latest real session reachable
const MON = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };

function parseCsvLine(line) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) { const c = line[i];
    if (q) { if (c === '"' && line[i+1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ",") { out.push(cur); cur = ""; } else cur += c; }
  out.push(cur); return out.map((s) => s.trim());
}
const num = (s) => { const n = parseFloat(String(s ?? "").replace(/[$,%\s]/g, "")); return Number.isFinite(n) ? n : null; };
const ddmmyyyy = (d) => `${String(d.getUTCDate()).padStart(2,"0")}${String(d.getUTCMonth()+1).padStart(2,"0")}${d.getUTCFullYear()}`;
const yyyymmdd = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,"0")}${String(d.getUTCDate()).padStart(2,"0")}`;

// ---- US: NASDAQ screener ----
async function fetchUS() {
  const quotes = new Map(); // ticker -> {price, changePct}
  for (const exchange of ["NASDAQ", "NYSE", "AMEX"]) {
    const url = `https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&offset=0&exchange=${exchange}`;
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json", Referer: "https://www.nasdaq.com/" } });
    if (!res.ok) { console.log(`  US ${exchange}: http ${res.status}`); continue; }
    const json = await res.json();
    const rows = json?.data?.table?.rows ?? json?.data?.rows ?? [];
    let n = 0;
    for (const r of rows) {
      const t = (r.symbol || "").toUpperCase().trim();
      const price = num(r.lastsale);
      if (!t || price === null || price === 0) continue;
      quotes.set(t, { price, changePct: num(r.pctchange) });
      n++;
    }
    console.log(`  US ${exchange}: ${n} quotes`);
  }
  return quotes;
}

// ---- NSE: sec_bhavdata_full ----
async function fetchNSE() {
  for (let i = 0; i < 8; i++) {
    const d = new Date(START); d.setUTCDate(d.getUTCDate() - i);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const url = `https://archives.nseindia.com/products/content/sec_bhavdata_full_${ddmmyyyy(d)}.csv`;
    const res = await fetch(url, { headers: { "User-Agent": UA, Referer: "https://www.nseindia.com/" } }).catch(() => null);
    if (!res || !res.ok) continue;
    const text = await res.text();
    if (!text.includes("SERIES")) continue;
    const lines = text.split(/\r?\n/).filter(Boolean);
    const h = parseCsvLine(lines[0]); const col = (n) => h.indexOf(n);
    const iSym = col("SYMBOL"), iSer = col("SERIES"), iDate = col("DATE1"), iClose = col("CLOSE_PRICE"), iPrev = col("PREV_CLOSE");
    const quotes = new Map(); let asOf = null;
    for (let k = 1; k < lines.length; k++) {
      const p = parseCsvLine(lines[k]);
      if (p[iSer] !== "EQ") continue;
      const price = num(p[iClose]); if (price === null) continue;
      const prev = num(p[iPrev]);
      const [dd, mon, yyyy] = p[iDate].split("-");
      asOf = `${yyyy}-${String(MON[mon]+1).padStart(2,"0")}-${dd.padStart(2,"0")}`;
      quotes.set(p[iSym].toUpperCase(), { price, changePct: prev ? ((price - prev) / prev) * 100 : null });
    }
    console.log(`  NSE: ${quotes.size} quotes (${asOf})`);
    return { quotes, asOf };
  }
  return { quotes: new Map(), asOf: null };
}

// ---- BSE: BhavCopy_BSE_CM UDiFF ----
async function fetchBSE() {
  for (let i = 0; i < 8; i++) {
    const d = new Date(START); d.setUTCDate(d.getUTCDate() - i);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const url = `https://www.bseindia.com/download/BhavCopy/Equity/BhavCopy_BSE_CM_0_0_0_${yyyymmdd(d)}_F_0000.CSV`;
    const res = await fetch(url, { headers: { "User-Agent": UA, Referer: "https://www.bseindia.com/" } }).catch(() => null);
    if (!res || !res.ok) continue;
    const text = await res.text();
    if (!text.includes("TckrSymb")) continue;
    const lines = text.split(/\r?\n/).filter(Boolean);
    const h = parseCsvLine(lines[0]); const col = (n) => h.indexOf(n);
    const iSym = col("TckrSymb"), iTp = col("FinInstrmTp"), iClose = col("ClsPric"), iPrev = col("PrvsClsgPric"), iDate = col("TradDt");
    const quotes = new Map(); let asOf = null;
    for (let k = 1; k < lines.length; k++) {
      const p = parseCsvLine(lines[k]);
      if (p[iTp] !== "STK") continue; // equities only
      const price = num(p[iClose]); if (price === null || price === 0) continue;
      const prev = num(p[iPrev]);
      asOf = p[iDate];
      quotes.set(p[iSym].toUpperCase(), { price, changePct: prev ? ((price - prev) / prev) * 100 : null });
    }
    console.log(`  BSE: ${quotes.size} quotes (${asOf})`);
    return { quotes, asOf };
  }
  return { quotes: new Map(), asOf: null };
}

async function upsert(client, rows) {
  const cols = 6;
  for (let i = 0; i < rows.length; i += 1000) {
    const batch = rows.slice(i, i + 1000);
    const vals = [], params = [];
    batch.forEach((r, j) => { const b = j * cols;
      vals.push(`($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6})`);
      params.push(r.assetId, r.price, r.changePct, r.currency, r.asOf, r.source); });
    await client.query(
      `insert into public.latest_quotes (asset_id, price, change_pct, currency, as_of, source)
       values ${vals.join(",")}
       on conflict (asset_id) do update set
         price=excluded.price, change_pct=excluded.change_pct, currency=excluded.currency,
         as_of=excluded.as_of, source=excluded.source, updated_at=now()`,
      params);
  }
}

async function main() {
  console.log("fetching latest quotes…");
  const [usQuotes, nse, bse] = await Promise.all([fetchUS(), fetchNSE(), fetchBSE()]);

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  // Build ticker -> asset_id maps directly via pg.
  const usMap = new Map((await client.query("select id,ticker from public.assets where country='US'")).rows.map((r) => [r.ticker, r.id]));
  const nseMap = new Map((await client.query("select id,ticker from public.assets where exchange='NSE'")).rows.map((r) => [r.ticker, r.id]));
  const bseMap = new Map((await client.query("select id,ticker from public.assets where exchange='BSE'")).rows.map((r) => [r.ticker, r.id]));

  const rows = [];
  for (const [t, q] of usQuotes) { const id = usMap.get(t); if (id) rows.push({ assetId: id, price: q.price, changePct: q.changePct, currency: "USD", asOf: null, source: "NASDAQ" }); }
  for (const [t, q] of nse.quotes) { const id = nseMap.get(t); if (id) rows.push({ assetId: id, price: q.price, changePct: q.changePct, currency: "INR", asOf: nse.asOf, source: "NSE_BHAVCOPY" }); }
  for (const [t, q] of bse.quotes) { const id = bseMap.get(t); if (id) rows.push({ assetId: id, price: q.price, changePct: q.changePct, currency: "INR", asOf: bse.asOf, source: "BSE_BHAVCOPY" }); }

  console.log(`matched ${rows.length} quotes to assets — upserting…`);
  await upsert(client, rows);

  const summary = await client.query(
    `select source, count(*) n, max(as_of) as_of from public.latest_quotes group by source order by n desc`);
  console.log("=== latest_quotes by source ===");
  summary.rows.forEach((r) => console.log(`  ${(r.source||"").padEnd(13)} ${String(r.n).padStart(6)}  as_of=${r.as_of ?? "live"}`));
  const total = await client.query("select count(*) n from public.latest_quotes");
  console.log(`TOTAL latest_quotes: ${total.rows[0].n}`);
  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
