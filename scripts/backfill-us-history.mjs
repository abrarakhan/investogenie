// Real US historical EOD backfill (replaces the synthetic generator in
// backfill-liquid.mjs). Pulls split-adjusted daily bars from Tiingo and upserts
// them into daily_ohlcv so the Minervini/PTJ 200-day indicators activate.
//
// Usage:
//   FINANCIAL_API_KEY=... DATABASE_URL=... node --env-file=.env.local \
//     scripts/backfill-us-history.mjs [SESSIONS] [TICKER,TICKER,...]
//
// Mirrors lib/ingest/usHistory.ts (the in-app version used by the cron route);
// kept as a standalone .mjs because the toolchain has no tsx for running TS.
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
const apiKey = process.env.FINANCIAL_API_KEY;
if (!databaseUrl) { console.error("DATABASE_URL is required"); process.exit(1); }
if (!apiKey) { console.error("FINANCIAL_API_KEY is required (Tiingo token)"); process.exit(1); }

const sessions = Number(process.argv[2]) || 260;
const tickerArg = process.argv[3] ? process.argv[3].split(",").map((t) => t.trim().toUpperCase()) : null;
const concurrency = 4;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isoDay = (d) => d.toISOString().slice(0, 10);

const end = new Date();
const start = new Date(end);
start.setUTCDate(start.getUTCDate() - (Math.ceil(sessions * 1.6) + 10));
const startISO = isoDay(start);
const endISO = isoDay(end);

async function fetchResilient(url, attempts = 4, timeoutMs = 15000) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
      clearTimeout(timer);
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}`);
        await sleep(Math.min(8000, 500 * 2 ** i) + Math.floor(Math.random() * 250));
        continue;
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      await sleep(Math.min(8000, 500 * 2 ** i) + Math.floor(Math.random() * 250));
    }
  }
  throw lastErr ?? new Error("fetch failed");
}

async function fetchTiingoDaily(ticker) {
  const sym = encodeURIComponent(ticker.toLowerCase());
  const url = `https://api.tiingo.com/tiingo/daily/${sym}/prices?startDate=${startISO}&endDate=${endISO}&format=json&token=${apiKey}`;
  const res = await fetchResilient(url);
  if (!res.ok) throw new Error(`Tiingo ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json)) return [];
  return json
    .map((r) => ({
      date: String(r.date).slice(0, 10),
      open: r.adjOpen ?? r.open,
      high: r.adjHigh ?? r.high,
      low: r.adjLow ?? r.low,
      close: r.adjClose ?? r.close,
      volume: Math.max(0, Math.round(Number(r.adjVolume ?? r.volume) || 0)),
    }))
    .filter((b) => b.date && [b.open, b.high, b.low, b.close].every((n) => Number.isFinite(n) && n > 0));
}

async function pool(items, size, fn) {
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, size) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      await fn(items[i]);
    }
  });
  await Promise.all(workers);
}

const client = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  const paramsQ = [];
  let sql = "select id, ticker from public.assets where country='US' and asset_class='STOCK'";
  if (tickerArg) { sql += " and ticker = any($1)"; paramsQ.push(tickerArg); }
  const { rows } = await client.query(sql, paramsQ);
  const idByTicker = new Map(rows.map((r) => [r.ticker.toUpperCase(), r.id]));
  const tickers = [...idByTicker.keys()];
  console.log(`resolved ${tickers.length} US tickers; pulling ${startISO}..${endISO}`);

  let fetched = 0, bars = 0;
  const failures = [];
  await pool(tickers, concurrency, async (ticker) => {
    const id = idByTicker.get(ticker);
    try {
      const series = await fetchTiingoDaily(ticker);
      if (!series.length) { failures.push([ticker, "no bars"]); return; }
      fetched++;
      const COLS = 8;
      for (let i = 0; i < series.length; i += 500) {
        const batch = series.slice(i, i + 500);
        const vals = [], p = [];
        batch.forEach((b, j) => {
          const o = j * COLS;
          vals.push(`($${o+1},$${o+2},$${o+3},$${o+4},$${o+5},$${o+6},$${o+7},$${o+8})`);
          p.push(id, b.date, b.open, b.high, b.low, b.close, b.volume, null);
        });
        await client.query(
          `insert into public.daily_ohlcv (asset_id,date,open,high,low,close,volume,open_interest)
           values ${vals.join(",")}
           on conflict (asset_id,date) do update set
             open=excluded.open, high=excluded.high, low=excluded.low,
             close=excluded.close, volume=excluded.volume`, p);
        bars += batch.length;
      }
      if (fetched % 10 === 0) console.log(`  ${fetched}/${tickers.length} tickers, ${bars} bars`);
    } catch (err) {
      failures.push([ticker, err?.message ?? String(err)]);
    }
  });

  console.log(`done — ${fetched}/${tickers.length} tickers, ${bars} bars upserted`);
  if (failures.length) console.log(`failures (${failures.length}):`, failures.slice(0, 20));
} catch (err) {
  console.error("backfill failed:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
