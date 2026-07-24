// Ingests the full listed-equity universe into public.assets:
//   • US  — SEC company_tickers_exchange.json (Nasdaq, NYSE, OTC, CBOE)
//   • NSE — archives.nseindia.com EQUITY_L.csv
//   • BSE — api.bseindia.com active equity scrip list
//
//   DATABASE_URL=postgresql://... node scripts/ingest-listings.mjs
import pg from "pg";

const UA_SEC = "InvestoGenie/1.0 (research; contact@investogenie.app)";
const UA_BROWSER =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

const SEC_URL = "https://www.sec.gov/files/company_tickers_exchange.json";
const NSE_URL = "https://archives.nseindia.com/content/equities/EQUITY_L.csv";
const BSE_URL =
  "https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w?Group=&Scripcode=&industry=&segment=Equity&status=Active";

/** Minimal RFC-4180-ish CSV line splitter (handles quoted fields w/ commas). */
function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const EXCHANGE_MAP = { Nasdaq: "NASDAQ", NYSE: "NYSE", OTC: "OTC", CBOE: "CBOE" };

// OTC listings are excluded from ingestion: Tiingo's EOD equity feed (our US
// history provider) does not cover OTC, and Google Finance's OTC quote path
// only returns a live price, never history. Every no-history OTC asset was
// removed on 2026-07-24, but this job re-created them on its very next run
// because it upserts the full SEC universe with no memory of that deletion.
// Filtering OTC out here (rather than deleting-and-hoping) is what makes the
// exclusion actually stick. This never touches OTC assets that already have
// OHLCV history sitting in the table — this job only inserts/updates, never
// deletes, so those existing rows are simply no longer refreshed by it.
const EXCLUDED_US_EXCHANGES = new Set(["OTC"]);

async function fetchUS() {
  const res = await fetch(SEC_URL, { headers: { "User-Agent": UA_SEC } });
  if (!res.ok) throw new Error(`SEC ${res.status}`);
  const json = await res.json();
  const rows = [];
  let excluded = 0;
  for (const [, name, ticker, exchange] of json.data) {
    if (!ticker) continue;
    const ex = EXCHANGE_MAP[exchange] ?? (exchange ? String(exchange).toUpperCase() : "OTHER");
    if (EXCLUDED_US_EXCHANGES.has(ex)) { excluded++; continue; }
    rows.push({ ticker: String(ticker).toUpperCase(), name, exchange: ex, country: "US", currency: "USD" });
  }
  if (excluded) console.log(`  (excluded ${excluded} OTC listing(s) from ingestion)`);
  return rows;
}

async function fetchNSE() {
  const res = await fetch(NSE_URL, { headers: { "User-Agent": UA_BROWSER } });
  if (!res.ok) throw new Error(`NSE ${res.status}`);
  const text = await res.text();
  const lines = text.split(/\r?\n/).filter(Boolean);
  lines.shift(); // header
  const rows = [];
  for (const line of lines) {
    const p = parseCsvLine(line);
    const symbol = p[0];
    if (!symbol) continue;
    rows.push({ ticker: symbol.toUpperCase(), name: p[1] ?? symbol, exchange: "NSE", country: "IN", currency: "INR" });
  }
  return rows;
}

async function fetchBSE() {
  const res = await fetch(BSE_URL, {
    headers: { "User-Agent": UA_BROWSER, Referer: "https://www.bseindia.com/", Origin: "https://www.bseindia.com" },
  });
  if (!res.ok) throw new Error(`BSE ${res.status}`);
  const json = await res.json();
  const rows = [];
  for (const r of json) {
    if (r.Status && r.Status !== "Active") continue;
    const ticker = (r.scrip_id && r.scrip_id.trim()) || String(r.SCRIP_CD);
    if (!ticker) continue;
    rows.push({ ticker: ticker.toUpperCase(), name: r.Scrip_Name ?? r.Issuer_Name ?? ticker, exchange: "BSE", country: "IN", currency: "INR" });
  }
  return rows;
}

/** Dedupe by (exchange, ticker) so a single upsert batch never hits the same row twice. */
function dedupe(rows) {
  const m = new Map();
  for (const r of rows) m.set(`${r.exchange}|${r.ticker}`, r);
  return [...m.values()];
}

async function upsertBatch(client, batch) {
  const cols = 6; // ticker,name,asset_class,exchange,country,currency
  const values = [];
  const params = [];
  batch.forEach((r, i) => {
    const b = i * cols;
    values.push(`($${b + 1},$${b + 2},'STOCK',$${b + 3},$${b + 4},$${b + 5},$${b + 6})`);
    params.push(r.ticker, (r.name ?? "").slice(0, 300), r.exchange, r.country, r.currency, true);
  });
  await client.query(
    `insert into public.assets (ticker, name, asset_class, exchange, country, currency, is_active)
     values ${values.join(",")}
     on conflict (exchange, ticker) do update set name = excluded.name, is_active = true`,
    params,
  );
}

async function main() {
  const [us, nse, bse] = await Promise.all([fetchUS(), fetchNSE(), fetchBSE()]);
  console.log(`fetched — US:${us.length}  NSE:${nse.length}  BSE:${bse.length}`);

  const all = dedupe([...us, ...nse, ...bse]);
  console.log(`deduped total: ${all.length}`);

  const databaseUrl = process.env.DATABASE_URL ?? "postgresql://localhost:5432/investogenie";
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: /127\.0\.0\.1|localhost/.test(databaseUrl) ? false : { rejectUnauthorized: false },
  });
  await client.connect();
  const BATCH = 1000;
  let done = 0;
  for (let i = 0; i < all.length; i += BATCH) {
    await upsertBatch(client, all.slice(i, i + BATCH));
    done += Math.min(BATCH, all.length - i);
    process.stdout.write(`\rupserted ${done}/${all.length}`);
  }
  process.stdout.write("\n");

  const summary = await client.query(
    `select country, exchange, count(*) n from public.assets
     where asset_class='STOCK' group by country, exchange order by country, n desc`,
  );
  console.log("=== assets (STOCK) by exchange ===");
  for (const row of summary.rows) console.log(`  ${row.country}  ${row.exchange.padEnd(8)} ${row.n}`);
  const total = await client.query("select count(*) n from public.assets where asset_class='STOCK'");
  console.log(`TOTAL STOCK assets: ${total.rows[0].n}`);
  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
