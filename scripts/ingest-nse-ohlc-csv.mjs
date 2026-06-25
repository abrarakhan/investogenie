// Bulk-load authentic NSE 10-year daily OHLCV from a CSV into daily_ohlcv.
// Streams the file (low memory), maps Symbol -> asset_id (exchange='NSE'), and
// upserts on (asset_id, date) so re-runs are idempotent and overwrite revisions.
//
// CSV header: Date,Close,High,Low,Open,Volume,Symbol,Exchange
// Usage: DATABASE_URL=... node --env-file=.env.local \
//          scripts/ingest-nse-ohlc-csv.mjs /path/to/NSE_All_Stocks_10Year_OHLC.csv
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) { console.error("DATABASE_URL required"); process.exit(1); }
const file = process.argv[2];
if (!file) { console.error("Usage: ingest-nse-ohlc-csv.mjs <csv>"); process.exit(1); }

const BATCH = 1000;       // rows per multi-row upsert (1000 * 7 = 7000 params)
const COLS = 7;

const num = (s) => { const n = parseFloat(s); return Number.isFinite(n) ? n : null; };
const int = (s) => { const n = parseInt(s, 10); return Number.isFinite(n) ? n : 0; };

// Local Postgres has no TLS; hosted Postgres usually requires it.
const isLocal = /127\.0\.0\.1|localhost/.test(databaseUrl);
const client = new pg.Client({ connectionString: databaseUrl, ssl: isLocal ? false : { rejectUnauthorized: false } });
await client.connect();

async function flush(batch) {
  if (batch.length === 0) return 0;
  const vals = [], params = [];
  batch.forEach((r, j) => {
    const o = j * COLS;
    vals.push(`($${o+1},$${o+2},$${o+3},$${o+4},$${o+5},$${o+6},$${o+7})`);
    params.push(r.assetId, r.date, r.open, r.high, r.low, r.close, r.volume);
  });
  await client.query(
    `insert into public.daily_ohlcv (asset_id,date,open,high,low,close,volume)
     values ${vals.join(",")}
     on conflict (asset_id,date) do update set
       open=excluded.open, high=excluded.high, low=excluded.low,
       close=excluded.close, volume=excluded.volume`,
    params,
  );
  return batch.length;
}

try {
  // Symbol -> asset_id for the NSE universe.
  const { rows } = await client.query("select id, ticker from public.assets where exchange=$1", ["NSE"]);
  const idByTicker = new Map(rows.map((r) => [r.ticker.toUpperCase(), r.id]));
  console.log(`resolved ${idByTicker.size} NSE tickers`);

  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  let header = true;
  let seen = 0, upserted = 0, skipped = 0;
  const unmatched = new Set();
  let batch = [];
  const t0 = Date.now();

  for await (const line of rl) {
    if (header) { header = false; continue; }
    if (!line) continue;
    const p = line.split(",");
    if (p.length < 8) { skipped++; continue; }
    // Date,Close,High,Low,Open,Volume,Symbol,Exchange
    const sym = p[6].trim().toUpperCase();
    const assetId = idByTicker.get(sym);
    seen++;
    if (!assetId) { unmatched.add(sym); skipped++; continue; }
    batch.push({
      assetId, date: p[0].trim(),
      open: num(p[4]), high: num(p[2]), low: num(p[3]), close: num(p[1]),
      volume: int(p[5]),
    });
    if (batch.length >= BATCH) {
      upserted += await flush(batch);
      batch = [];
      if (upserted % 100000 === 0) {
        const rate = Math.round(upserted / ((Date.now() - t0) / 1000));
        console.log(`  ${upserted} upserted (${rate}/s)…`);
      }
    }
  }
  upserted += await flush(batch);

  console.log(`done — seen:${seen} upserted:${upserted} skipped:${skipped} unmatchedSymbols:${unmatched.size}`);
  if (unmatched.size) console.log("unmatched:", [...unmatched].slice(0, 20).join(", "));
  console.log(`elapsed: ${Math.round((Date.now() - t0) / 1000)}s`);
} catch (err) {
  console.error("ingest failed:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
