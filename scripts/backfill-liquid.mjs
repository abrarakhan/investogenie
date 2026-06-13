// Backfills daily OHLCV for a liquid scan universe so the screener has data:
//   • India (Nifty 50) — REAL EOD from NSE full bhavcopy (~60 sessions).
//   • US (S&P 100 subset) — anchored synthetic series (Stooq/Yahoo block
//     scripted access from here; swap in a keyed provider for real US data).
//
//   DATABASE_URL=postgresql://... node scripts/backfill-liquid.mjs
import pg from "pg";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
const SESSIONS = 60;
const BHAV_START = "2025-06-13"; // latest real NSE session available from here

const NIFTY50 = [
  "RELIANCE","TCS","HDFCBANK","ICICIBANK","INFY","ITC","LT","BHARTIARTL","SBIN","BAJFINANCE",
  "HINDUNILVR","KOTAKBANK","AXISBANK","ASIANPAINT","MARUTI","SUNPHARMA","TITAN","ULTRACEMCO","WIPRO","NESTLEIND",
  "ONGC","NTPC","POWERGRID","M&M","TATAMOTORS","TATASTEEL","JSWSTEEL","ADANIENT","ADANIPORTS","COALINDIA",
  "GRASIM","HCLTECH","HDFCLIFE","SBILIFE","BAJAJFINSV","BAJAJ-AUTO","BRITANNIA","CIPLA","DIVISLAB","DRREDDY",
  "EICHERMOT","HEROMOTOCO","HINDALCO","INDUSINDBK","TECHM","APOLLOHOSP","BPCL","TATACONSUM","UPL","LTIM",
];
const SP100 = [
  "AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","JPM","V","UNH","XOM","JNJ","WMT","MA","PG","AVGO","HD","CVX",
  "LLY","ABBV","MRK","KO","PEP","COST","ADBE","BAC","CRM","MCD","TMO","ABT","CSCO","ACN","DHR","LIN","WFC","TXN",
  "DIS","NEE","VZ","PM","CMCSA","INTC","AMD","NKE","ORCL","QCOM","UNP","BMY","RTX","HON","LOW","UPS","INTU","IBM",
  "GS","CAT","AMGN","SBUX","SPGI","BLK","ELV","GILD","ISRG","NOW","PLD","MDT","DE","ADP","TJX","C","MO","MMC","SO",
];
const US_BASE = { AAPL:195, MSFT:430, NVDA:120, AMZN:185, GOOGL:175, META:500, TSLA:250, JPM:200, V:275, UNH:480 };

const MON = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
const noise = (i, k = 1) => Math.sin(i * 12.9898 + k * 78.233) * 0.5;
const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };

function parseCsvLine(line) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) { const c = line[i];
    if (q) { if (c === '"' && line[i+1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ",") { out.push(cur); cur = ""; } else cur += c; }
  out.push(cur); return out.map((s) => s.trim());
}

function ddmmyyyy(d) {
  return `${String(d.getUTCDate()).padStart(2,"0")}${String(d.getUTCMonth()+1).padStart(2,"0")}${d.getUTCFullYear()}`;
}

async function fetchBhavcopy(dateObj) {
  const url = `https://archives.nseindia.com/products/content/sec_bhavdata_full_${ddmmyyyy(dateObj)}.csv`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Referer: "https://www.nseindia.com/" } });
  if (!res.ok) return null;
  const text = await res.text();
  if (!text.includes("SERIES")) return null;
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0]);
  const col = (n) => header.indexOf(n);
  const iSym = col("SYMBOL"), iSer = col("SERIES"), iDate = col("DATE1");
  const iO = col("OPEN_PRICE"), iH = col("HIGH_PRICE"), iL = col("LOW_PRICE"), iC = col("CLOSE_PRICE"), iV = col("TTL_TRD_QNTY");
  const want = new Set(NIFTY50);
  const rows = [];
  let isoDate = null;
  for (let k = 1; k < lines.length; k++) {
    const p = parseCsvLine(lines[k]);
    if (p[iSer] !== "EQ") continue;
    const sym = p[iSym];
    if (!want.has(sym)) continue;
    const [dd, mon, yyyy] = p[iDate].split("-");
    isoDate = `${yyyy}-${String(MON[mon]+1).padStart(2,"0")}-${dd.padStart(2,"0")}`;
    rows.push({ ticker: sym, date: isoDate,
      open: +p[iO], high: +p[iH], low: +p[iL], close: +p[iC], volume: Math.round(+p[iV] || 0) });
  }
  return rows.length ? { isoDate, rows } : null;
}

function synthUS(ticker) {
  const base = US_BASE[ticker] ?? 50 + (hash(ticker) % 400);
  const seed = hash(ticker);
  const breakout = seed % 7 === 0; // ~1 in 7 gets a coil->breakout
  const bars = [];
  let price = base;
  const today = new Date(Date.UTC(2025, 5, 13));
  for (let i = 0; i < 90; i++) {
    const di = 89 - i;
    const d = new Date(today); d.setUTCDate(d.getUTCDate() - di);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue; // skip weekends
    let drift = 0.0003 + 0.004 * noise(seed + i, 2);
    if (breakout && i >= 84) drift += 0.012; // breakout burst at the end
    if (breakout && i < 84) drift *= 0.3; // tight coil before
    price = Math.max(1, price * (1 + drift));
    const open = price * (1 - 0.002 * noise(seed + i, 5));
    const high = Math.max(open, price) * 1.004;
    const low = Math.min(open, price) * 0.996;
    const vol = Math.round((breakout && i >= 84 ? 3 : 1) * (5_000_000 + 4_000_000 * Math.abs(noise(seed + i, 7))));
    bars.push({ date: d.toISOString().slice(0,10),
      open: +open.toFixed(2), high: +high.toFixed(2), low: +low.toFixed(2), close: +price.toFixed(2), volume: vol });
  }
  return bars;
}

async function upsertOhlcv(client, rows) {
  const cols = 8;
  for (let i = 0; i < rows.length; i += 800) {
    const batch = rows.slice(i, i + 800);
    const vals = [], params = [];
    batch.forEach((r, j) => { const b = j * cols;
      vals.push(`($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8})`);
      params.push(r.assetId, r.date, r.open, r.high, r.low, r.close, r.volume, r.oi ?? null); });
    await client.query(
      `insert into public.daily_ohlcv (asset_id,date,open,high,low,close,volume,open_interest)
       values ${vals.join(",")}
       on conflict (asset_id,date) do update set open=excluded.open,high=excluded.high,low=excluded.low,close=excluded.close,volume=excluded.volume`,
      params);
  }
}

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  // Resolve asset ids
  const nseRes = await client.query("select id,ticker from public.assets where exchange='NSE' and ticker = any($1)", [NIFTY50]);
  const nseId = new Map(nseRes.rows.map((r) => [r.ticker, r.id]));
  const usRes = await client.query("select id,ticker from public.assets where country='US' and ticker = any($1)", [SP100]);
  const usId = new Map(usRes.rows.map((r) => [r.ticker, r.id]));
  console.log(`resolved ids — NSE:${nseId.size}/${NIFTY50.length}  US:${usId.size}/${SP100.length}`);

  // ---- India: real bhavcopy ----
  const indiaRows = [];
  const seenDates = new Set();
  let cur = new Date(`${BHAV_START}T00:00:00Z`);
  let tries = 0;
  while (seenDates.size < SESSIONS && tries < 130) {
    tries++;
    const day = cur.getUTCDay();
    cur.setUTCDate(cur.getUTCDate() - 1);
    if (day === 0 || day === 6) continue;
    const next = new Date(cur); next.setUTCDate(next.getUTCDate() + 1);
    const data = await fetchBhavcopy(next).catch(() => null);
    if (!data || seenDates.has(data.isoDate)) continue;
    seenDates.add(data.isoDate);
    for (const r of data.rows) {
      const id = nseId.get(r.ticker);
      if (id) indiaRows.push({ assetId: id, ...r });
    }
    process.stdout.write(`\rIndia sessions: ${seenDates.size}/${SESSIONS}`);
  }
  process.stdout.write("\n");
  await upsertOhlcv(client, indiaRows);
  console.log(`India: upserted ${indiaRows.length} real bars across ${seenDates.size} sessions`);

  // ---- US: anchored synthetic ----
  const usRows = [];
  for (const [ticker, id] of usId) for (const b of synthUS(ticker)) usRows.push({ assetId: id, ...b });
  await upsertOhlcv(client, usRows);
  console.log(`US: upserted ${usRows.length} synthetic bars for ${usId.size} names`);

  const cov = await client.query(
    `select a.country, count(distinct a.id) n from public.assets a
     join public.daily_ohlcv o on o.asset_id=a.id group by a.country order by a.country`);
  console.log("=== instruments with OHLCV ==="); cov.rows.forEach((r) => console.log(`  ${r.country}: ${r.n}`));
  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
