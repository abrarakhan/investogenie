// Backfills real daily OHLCV for the ENTIRE NSE equity universe (every EQ
// symbol) from NSE full bhavcopy over ~60 sessions. Widens scan coverage well
// beyond the Nifty 50 liquid subset.
//   DATABASE_URL=postgresql://... node scripts/backfill-nse-universe.mjs
import pg from "pg";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
const SESSIONS = 60;
const START = "2025-06-13";
const MON = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };

function parseCsvLine(line) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) { const c = line[i];
    if (q) { if (c === '"' && line[i+1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ",") { out.push(cur); cur = ""; } else cur += c; }
  out.push(cur); return out.map((s) => s.trim());
}
const ddmmyyyy = (d) => `${String(d.getUTCDate()).padStart(2,"0")}${String(d.getUTCMonth()+1).padStart(2,"0")}${d.getUTCFullYear()}`;

async function fetchBhavcopy(d, idByTicker) {
  const url = `https://archives.nseindia.com/products/content/sec_bhavdata_full_${ddmmyyyy(d)}.csv`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Referer: "https://www.nseindia.com/" } }).catch(() => null);
  if (!res || !res.ok) return null;
  const text = await res.text();
  if (!text.includes("SERIES")) return null;
  const lines = text.split(/\r?\n/).filter(Boolean);
  const h = parseCsvLine(lines[0]); const col = (n) => h.indexOf(n);
  const iSym = col("SYMBOL"), iSer = col("SERIES"), iDate = col("DATE1");
  const iO = col("OPEN_PRICE"), iH = col("HIGH_PRICE"), iL = col("LOW_PRICE"), iC = col("CLOSE_PRICE"), iV = col("TTL_TRD_QNTY");
  const rows = []; let isoDate = null;
  for (let k = 1; k < lines.length; k++) {
    const p = parseCsvLine(lines[k]);
    if (p[iSer] !== "EQ") continue;
    const id = idByTicker.get(p[iSym].toUpperCase());
    if (!id) continue;
    const [dd, mon, yyyy] = p[iDate].split("-");
    isoDate = `${yyyy}-${String(MON[mon]+1).padStart(2,"0")}-${dd.padStart(2,"0")}`;
    const close = +p[iC]; if (!Number.isFinite(close)) continue;
    rows.push({ assetId: id, date: isoDate, open: +p[iO] || close, high: +p[iH] || close, low: +p[iL] || close, close, volume: Math.round(+p[iV] || 0) });
  }
  return rows.length ? { isoDate, rows } : null;
}

async function upsert(client, rows) {
  const cols = 7;
  for (let i = 0; i < rows.length; i += 700) {
    const batch = rows.slice(i, i + 700);
    const vals = [], params = [];
    batch.forEach((r, j) => { const b = j * cols;
      vals.push(`($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7})`);
      params.push(r.assetId, r.date, r.open, r.high, r.low, r.close, r.volume); });
    await client.query(
      `insert into public.daily_ohlcv (asset_id,date,open,high,low,close,volume)
       values ${vals.join(",")}
       on conflict (asset_id,date) do update set open=excluded.open,high=excluded.high,low=excluded.low,close=excluded.close,volume=excluded.volume`,
      params);
  }
}

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const idByTicker = new Map((await client.query("select id,ticker from public.assets where exchange='NSE'")).rows.map((r) => [r.ticker, r.id]));
  console.log(`NSE assets: ${idByTicker.size}`);

  const seen = new Set();
  let cur = new Date(`${START}T00:00:00Z`);
  let tries = 0, totalBars = 0;
  while (seen.size < SESSIONS && tries < 130) {
    tries++;
    const day = cur.getUTCDay();
    cur.setUTCDate(cur.getUTCDate() - 1);
    if (day === 0 || day === 6) continue;
    const probe = new Date(cur); probe.setUTCDate(probe.getUTCDate() + 1);
    const data = await fetchBhavcopy(probe, idByTicker).catch(() => null);
    if (!data || seen.has(data.isoDate)) continue;
    seen.add(data.isoDate);
    await upsert(client, data.rows);
    totalBars += data.rows.length;
    process.stdout.write(`\rsessions ${seen.size}/${SESSIONS}  bars ${totalBars}`);
  }
  process.stdout.write("\n");

  const cov = await client.query("select count(distinct asset_id) n from public.daily_ohlcv o join public.assets a on a.id=o.asset_id where a.exchange='NSE'");
  console.log(`NSE instruments with OHLCV: ${cov.rows[0].n}`);
  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
