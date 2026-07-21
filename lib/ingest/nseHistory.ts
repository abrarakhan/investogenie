import { Client } from "pg";

const NSE_BHAVCOPY_URL =
  "https://archives.nseindia.com/products/content/sec_bhavdata_full_{date}.csv";
const BSE_BHAVCOPY_URL =
  "https://www.bseindia.com/download/BhavCopy/Equity/BhavCopy_BSE_CM_0_0_0_{date}_F_0000.CSV";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

const MON: Record<string, number> = {
  Jan: 1,
  Feb: 2,
  Mar: 3,
  Apr: 4,
  May: 5,
  Jun: 6,
  Jul: 7,
  Aug: 8,
  Sep: 9,
  Oct: 10,
  Nov: 11,
  Dec: 12,
};

export interface NseHistoryOptions {
  /** Max successful trading sessions to ingest per run. Repeated runs catch up. */
  maxSessions?: number;
  /** Override end date, mainly for tests/manual replay. Defaults to today UTC. */
  endISO?: string;
}

export interface NseHistorySummary {
  exchange?: "NSE" | "BSE";
  latestDateBefore: string | null;
  latestDateAfter: string | null;
  datesAttempted: number;
  sessionsFetched: number;
  barsUpserted: number;
  assets?: number;
  nseAssets: number;
  bseAssets?: number;
  skipped: { date: string; reason: string }[];
  durationMs: number;
}

interface BhavRow {
  assetId: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur.trim());
  return out;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const ddmmyyyy = (d: Date) =>
  `${String(d.getUTCDate()).padStart(2, "0")}${String(d.getUTCMonth() + 1).padStart(2, "0")}${d.getUTCFullYear()}`;
const yyyymmdd = (d: Date) =>
  `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function parseNseDate(value: string): string | null {
  const [dd, mon, yyyy] = value.split("-");
  const month = MON[mon];
  if (!dd || !month || !yyyy) return null;
  return `${yyyy}-${String(month).padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

async function fetchBhavcopy(
  day: Date,
  idByTicker: Map<string, string>,
): Promise<{ date: string; rows: BhavRow[] } | null> {
  const dateToken = ddmmyyyy(day);
  const url = NSE_BHAVCOPY_URL.replace("{date}", dateToken);
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/csv,*/*",
      Referer: "https://www.nseindia.com/",
    },
  }).catch(() => null);
  if (!res || !res.ok) return null;

  const text = await res.text();
  if (!text.includes("SERIES")) return null;

  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return null;

  const header = parseCsvLine(lines[0]);
  const col = (name: string) => header.indexOf(name);
  const iSym = col("SYMBOL");
  const iSer = col("SERIES");
  const iDate = col("DATE1");
  const iOpen = col("OPEN_PRICE");
  const iHigh = col("HIGH_PRICE");
  const iLow = col("LOW_PRICE");
  const iClose = col("CLOSE_PRICE");
  const iVol = col("TTL_TRD_QNTY");
  if ([iSym, iSer, iDate, iOpen, iHigh, iLow, iClose, iVol].some((i) => i < 0)) {
    throw new Error(`NSE bhavcopy schema changed for ${dateToken}`);
  }

  const rows: BhavRow[] = [];
  let isoDate: string | null = null;
  for (let i = 1; i < lines.length; i++) {
    const p = parseCsvLine(lines[i]);
    if (p[iSer] !== "EQ") continue;

    const assetId = idByTicker.get(p[iSym].toUpperCase());
    if (!assetId) continue;

    isoDate = parseNseDate(p[iDate]);
    const close = Number(p[iClose]);
    if (!isoDate || !Number.isFinite(close) || close <= 0) continue;

    const open = Number(p[iOpen]);
    const high = Number(p[iHigh]);
    const low = Number(p[iLow]);
    const volume = Math.max(0, Math.round(Number(p[iVol]) || 0));
    rows.push({
      assetId,
      date: isoDate,
      open: Number.isFinite(open) && open > 0 ? open : close,
      high: Number.isFinite(high) && high > 0 ? high : close,
      low: Number.isFinite(low) && low > 0 ? low : close,
      close,
      volume,
    });
  }

  return isoDate && rows.length ? { date: isoDate, rows } : null;
}

async function fetchBseBhavcopy(
  day: Date,
  idByTicker: Map<string, string>,
): Promise<{ date: string; rows: BhavRow[] } | null> {
  const dateToken = yyyymmdd(day);
  const url = BSE_BHAVCOPY_URL.replace("{date}", dateToken);
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/csv,*/*",
      Referer: "https://www.bseindia.com/",
    },
  }).catch(() => null);
  if (!res || !res.ok) return null;

  const text = await res.text();
  if (!text.includes("TckrSymb")) return null;

  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return null;

  const header = parseCsvLine(lines[0]);
  const col = (name: string) => header.indexOf(name);
  const iSym = col("TckrSymb");
  const iType = col("FinInstrmTp");
  const iDate = col("TradDt");
  const iOpen = col("OpnPric");
  const iHigh = col("HghPric");
  const iLow = col("LwPric");
  const iClose = col("ClsPric");
  const iLast = col("LastPric");
  const iVol = col("TtlTradgVol");
  if ([iSym, iType, iDate, iOpen, iHigh, iLow, iClose, iVol].some((i) => i < 0)) {
    throw new Error(`BSE bhavcopy schema changed for ${dateToken}`);
  }

  const rows: BhavRow[] = [];
  let isoDate: string | null = null;
  for (let i = 1; i < lines.length; i++) {
    const p = parseCsvLine(lines[i]);
    if (p[iType] !== "STK") continue;

    const assetId = idByTicker.get(p[iSym].toUpperCase());
    if (!assetId) continue;

    isoDate = p[iDate];
    const close = Number(p[iClose]) || Number(p[iLast]);
    if (!isoDate || !Number.isFinite(close) || close <= 0) continue;

    const open = Number(p[iOpen]);
    const high = Number(p[iHigh]);
    const low = Number(p[iLow]);
    const volume = Math.max(0, Math.round(Number(p[iVol]) || 0));
    rows.push({
      assetId,
      date: isoDate,
      open: Number.isFinite(open) && open > 0 ? open : close,
      high: Number.isFinite(high) && high > 0 ? high : close,
      low: Number.isFinite(low) && low > 0 ? low : close,
      close,
      volume,
    });
  }

  return isoDate && rows.length ? { date: isoDate, rows } : null;
}

async function upsertBars(client: Client, rows: BhavRow[]): Promise<number> {
  const cols = 7;
  let upserted = 0;
  for (let i = 0; i < rows.length; i += 900) {
    const batch = rows.slice(i, i + 900);
    const values: string[] = [];
    const params: unknown[] = [];
    batch.forEach((r, j) => {
      const b = j * cols;
      values.push(
        `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`,
      );
      params.push(r.assetId, r.date, r.open, r.high, r.low, r.close, r.volume);
    });
    await client.query(
      `insert into public.daily_ohlcv (asset_id,date,open,high,low,close,volume)
       values ${values.join(",")}
       on conflict (asset_id,date) do update set
         open=excluded.open,
         high=excluded.high,
         low=excluded.low,
         close=excluded.close,
         volume=excluded.volume`,
      params,
    );
    upserted += batch.length;
  }
  return upserted;
}

async function backfillIndianExchangeHistory(
  databaseUrl: string,
  exchange: "NSE" | "BSE",
  opts: NseHistoryOptions = {},
): Promise<NseHistorySummary> {
  const t0 = Date.now();
  const maxSessions = opts.maxSessions ?? 20;
  const end = opts.endISO ? new Date(`${opts.endISO}T00:00:00Z`) : new Date();

  const client = new Client({
    connectionString: databaseUrl,
    ssl: /127\.0\.0\.1|localhost/.test(databaseUrl)
      ? false
      : { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    const { rows: assets } = await client.query<{ id: string; ticker: string }>(
      "select id,ticker from public.assets where exchange=$1 and asset_class='STOCK' and is_active=true",
      [exchange],
    );
    const idByTicker = new Map(assets.map((r) => [r.ticker.toUpperCase(), r.id]));

    const { rows: latestRows } = await client.query<{ latest: string | null }>(
      `select max(o.date)::text latest
         from public.daily_ohlcv o
         join public.assets a on a.id=o.asset_id
        where a.exchange=$1 and a.asset_class='STOCK'`,
      [exchange],
    );
    const latestDateBefore = latestRows[0]?.latest ?? null;

    let cursor = latestDateBefore
      ? addDays(new Date(`${latestDateBefore}T00:00:00Z`), 1)
      : addDays(end, -7);

    let datesAttempted = 0;
    let sessionsFetched = 0;
    let barsUpserted = 0;
    const skipped: { date: string; reason: string }[] = [];

    while (cursor <= end && sessionsFetched < maxSessions) {
      const day = cursor.getUTCDay();
      const date = isoDay(cursor);
      cursor = addDays(cursor, 1);
      if (day === 0 || day === 6) {
        skipped.push({ date, reason: "weekend" });
        continue;
      }

      datesAttempted++;
      const data = exchange === "BSE"
        ? await fetchBseBhavcopy(new Date(`${date}T00:00:00Z`), idByTicker)
        : await fetchBhavcopy(new Date(`${date}T00:00:00Z`), idByTicker);
      if (!data) {
        skipped.push({ date, reason: "bhavcopy not available" });
        continue;
      }
      const count = await upsertBars(client, data.rows);
      sessionsFetched++;
      barsUpserted += count;
    }

    const { rows: afterRows } = await client.query<{ latest: string | null }>(
      `select max(o.date)::text latest
         from public.daily_ohlcv o
         join public.assets a on a.id=o.asset_id
        where a.exchange=$1 and a.asset_class='STOCK'`,
      [exchange],
    );

    return {
      exchange,
      latestDateBefore,
      latestDateAfter: afterRows[0]?.latest ?? null,
      datesAttempted,
      sessionsFetched,
      barsUpserted,
      assets: idByTicker.size,
      nseAssets: idByTicker.size,
      bseAssets: exchange === "BSE" ? idByTicker.size : undefined,
      skipped: skipped.slice(-30),
      durationMs: Date.now() - t0,
    };
  } finally {
    await client.end();
  }
}

export async function backfillNseHistory(
  databaseUrl: string,
  opts: NseHistoryOptions = {},
): Promise<NseHistorySummary> {
  return backfillIndianExchangeHistory(databaseUrl, "NSE", opts);
}

export async function backfillBseHistory(
  databaseUrl: string,
  opts: NseHistoryOptions = {},
): Promise<NseHistorySummary> {
  return backfillIndianExchangeHistory(databaseUrl, "BSE", opts);
}
