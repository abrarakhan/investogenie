import { Client } from "pg";
import { fetchTextLenient } from "@/lib/ingest/fetchText";
import { isTradingDay } from "@/lib/market-calendar.mjs";

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
const NSE_EQUITY_SERIES = new Set(["EQ", "BE", "BZ", "SM", "ST", "SZ"]);

export interface NseHistoryOptions {
  /** Max successful trading sessions to ingest per run. Repeated runs catch up. */
  maxSessions?: number;
  /** Reprocess from this date even when a newer exchange-wide bar exists. */
  startISO?: string;
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
  /** NSE only: EQ sessions written to daily_delivery_metrics. */
  deliveryUpserted?: number;
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

/**
 * One NSE EQ session's deliverable quantity for a stock.
 *
 * Deliverable quantity is what makes a move look like accumulation rather than
 * intraday churn, so it is worth storing even for quiet sessions: a 20-day baseline
 * cannot be built from ignition days alone.
 */
interface DeliveryRow {
  assetId: string;
  date: string;
  series: string;
  delivQty: number | null;
  delivPct: number | null;
  turnover: number | null;
  isEtf: boolean;
}

/**
 * Series the exchange settles at 100% delivery by rule.
 *
 * BE and BZ are trade-to-trade: intraday squaring off is not permitted, so every
 * share traded is delivered. SM, ST and SZ are the SME board. Reading any of these as
 * institutional conviction would mean the strictest-surveillance stocks on the
 * exchange score highest on accumulation, which is exactly backwards.
 */
const DELIVERY_ELIGIBLE_SERIES = "EQ";

/** Rupees of turnover below which a session is too thin to carry a useful baseline. */
const DELIVERY_MIN_TURNOVER = 2e7; // Rs 2 crore

/**
 * ETFs, REITs and InvITs settle at or near 100% delivery by construction. Nothing in
 * the data marks them: NSE lists them in series EQ and assets.asset_class calls them
 * STOCK. This is a name heuristic, deliberately broad, and it only ever excludes rows
 * from an accumulation signal rather than creating one.
 */
const ETF_NAME_PATTERN = /\b(ETF|BEES|IETF|REIT|INVIT|GOLDBEES|LIQUIDBEES|SILVER ?ETF)\b/i;
const ETF_TICKER_PATTERN = /(ETF|BEES|IETF|REIT|INVIT)/i;

export function looksLikeFund(ticker: string, name: string | null): boolean {
  return ETF_TICKER_PATTERN.test(ticker) || (!!name && ETF_NAME_PATTERN.test(name));
}

/**
 * Bhavcopy writes "-" where a value is absent, which Number() turns into NaN rather
 * than failing. Coerce those to null before they reach a numeric column.
 */
export function bhavNumber(value: string | undefined): number | null {
  const text = (value ?? "").trim();
  if (!text || text === "-") return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
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

/**
 * Replay a short recent window even when another symbol already advanced the
 * exchange-wide maximum date. Thinly traded symbols can otherwise miss a
 * session forever because the next run starts after the global max date.
 */
export function historyBackfillStart(
  latestDate: string | null,
  end: Date,
  explicitStart?: string,
): Date {
  if (explicitStart) return new Date(`${explicitStart}T00:00:00Z`);
  const replayStart = addDays(end, -8);
  if (!latestDate) return replayStart;
  const incrementalStart = addDays(new Date(`${latestDate}T00:00:00Z`), 1);
  return incrementalStart < replayStart ? incrementalStart : replayStart;
}

/**
 * Delivery was added long after daily OHLCV. A current price table therefore says
 * nothing about whether the 20-session delivery baseline exists. Start far enough
 * back on the first run, then advance from the delivery table's own watermark.
 */
export function deliveryBackfillStart(
  latestDeliveryDate: string | null,
  end: Date,
  explicitStart?: string,
): Date {
  if (explicitStart) return new Date(`${explicitStart}T00:00:00Z`);
  if (latestDeliveryDate) {
    return addDays(new Date(`${latestDeliveryDate}T00:00:00Z`), 1);
  }
  // Ninety calendar days comfortably covers forty NSE sessions plus holidays.
  return addDays(end, -90);
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
  nameByTicker?: Map<string, string | null>,
): Promise<{ date: string; rows: BhavRow[]; delivery: DeliveryRow[] } | null> {
  const dateToken = ddmmyyyy(day);
  const url = NSE_BHAVCOPY_URL.replace("{date}", dateToken);
  const res = await fetch(url, {
    cache: "no-store",
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
  // Delivery columns are additive: a bhavcopy without them still yields price rows,
  // because losing an entire session's OHLCV over a missing optional field would be a
  // far worse failure than losing that session's accumulation evidence.
  const iDelivQty = col("DELIV_QTY");
  const iDelivPct = col("DELIV_PER");
  const iTurnover = col("TURNOVER_LACS");
  if ([iSym, iSer, iDate, iOpen, iHigh, iLow, iClose, iVol].some((i) => i < 0)) {
    throw new Error(`NSE bhavcopy schema changed for ${dateToken}`);
  }

  const rows: BhavRow[] = [];
  const delivery: DeliveryRow[] = [];
  let isoDate: string | null = null;
  for (let i = 1; i < lines.length; i++) {
    const p = parseCsvLine(lines[i]);
    if (!NSE_EQUITY_SERIES.has(p[iSer])) continue;

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

    if (iDelivQty < 0 || iDelivPct < 0) continue;
    const series = p[iSer];
    if (series !== DELIVERY_ELIGIBLE_SERIES) continue;
    // TURNOVER_LACS is in lakhs of rupees.
    const turnover = iTurnover >= 0 ? bhavNumber(p[iTurnover]) : null;
    const turnoverRupees = turnover === null ? null : turnover * 1e5;
    // The base floor, not the ignition floor. Quiet pre-breakout sessions must be
    // stored or the 20-day delivery baseline they anchor would be incomplete, and a
    // stock would look like it had no history exactly when it started moving.
    // The exchange turnover field is part of the eligibility rule, not optional
    // evidence. Keeping an unmeasured row would allow a thin base into the rolling
    // baseline merely because its turnover was absent.
    if (turnoverRupees === null || turnoverRupees < DELIVERY_MIN_TURNOVER) continue;
    const delivQty = bhavNumber(p[iDelivQty]);
    const delivPct = bhavNumber(p[iDelivPct]);
    if (delivQty === null && delivPct === null) continue;
    const ticker = p[iSym].toUpperCase();
    delivery.push({
      assetId,
      date: isoDate,
      series,
      delivQty: delivQty === null ? null : Math.max(0, Math.round(delivQty)),
      delivPct: delivPct === null ? null : delivPct,
      turnover: turnoverRupees,
      isEtf: looksLikeFund(ticker, nameByTicker?.get(ticker) ?? null),
    });
  }

  // The caller compares data.date against the session it asked for; NSE sometimes
  // serves a previous session's file for a date it has not published yet.
  return isoDate && rows.length ? { date: isoDate, rows, delivery } : null;
}

async function fetchBseBhavcopy(
  day: Date,
  idByTicker: Map<string, string>,
): Promise<{ date: string; rows: BhavRow[]; delivery?: DeliveryRow[] } | null> {
  const dateToken = yyyymmdd(day);
  const url = BSE_BHAVCOPY_URL.replace("{date}", dateToken);
  const headers = {
    "User-Agent": UA,
    Accept: "text/csv,*/*",
    Referer: "https://www.bseindia.com/",
  };
  const res = await fetch(url, {
    cache: "no-store",
    headers,
  }).catch(() => null);
  let text: string | null = res?.ok ? await res.text() : null;
  if (text === null) {
    const fallback = await fetchTextLenient(url, headers).catch(() => null);
    if (fallback?.ok) text = fallback.text;
  }
  if (text === null) return null;
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

  // BSE's bhavcopy carries no deliverable-quantity columns, so this exchange
  // contributes prices only.
  return isoDate && rows.length ? { date: isoDate, rows } : null;
}

async function upsertDelivery(client: Client, rows: DeliveryRow[]): Promise<number> {
  const cols = 7;
  let upserted = 0;
  for (let i = 0; i < rows.length; i += 900) {
    const batch = rows.slice(i, i + 900);
    const values: string[] = [];
    const params: unknown[] = [];
    batch.forEach((r, j) => {
      const b = j * cols;
      values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`);
      params.push(r.assetId, r.date, r.series, r.delivQty, r.delivPct, r.turnover, r.isEtf);
    });
    // Idempotent: the exchange revises a session's file, and a re-run must overwrite
    // rather than conflict or duplicate.
    await client.query(
      `insert into public.daily_delivery_metrics
         (asset_id,date,series,deliv_qty,deliv_pct,turnover,is_etf)
       values ${values.join(",")}
       on conflict (asset_id,date) do update set
         series=excluded.series,
         deliv_qty=excluded.deliv_qty,
         deliv_pct=excluded.deliv_pct,
         turnover=excluded.turnover,
         is_etf=excluded.is_etf`,
      params,
    );
    upserted += batch.length;
  }
  return upserted;
}

async function upsertBars(client: Client, rows: BhavRow[], source: string): Promise<number> {
  const cols = 8;
  let upserted = 0;
  for (let i = 0; i < rows.length; i += 900) {
    const batch = rows.slice(i, i + 900);
    const values: string[] = [];
    const params: unknown[] = [];
    batch.forEach((r, j) => {
      const b = j * cols;
      values.push(
        `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8})`,
      );
      params.push(r.assetId, r.date, r.open, r.high, r.low, r.close, r.volume, source);
    });
    await client.query(
      `insert into public.daily_ohlcv (asset_id,date,open,high,low,close,volume,source)
       values ${values.join(",")}
       on conflict (asset_id,date) do update set
         open=excluded.open,
         high=excluded.high,
         low=excluded.low,
         close=excluded.close,
         volume=excluded.volume,
         source=excluded.source`,
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
  let maxSessions = opts.maxSessions ?? 20;
  const end = opts.endISO ? new Date(`${opts.endISO}T00:00:00Z`) : new Date();

  const client = new Client({
    connectionString: databaseUrl,
    ssl: /127\.0\.0\.1|localhost/.test(databaseUrl)
      ? false
      : { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    const { rows: assets } = await client.query<{ id: string; ticker: string; name: string | null }>(
      "select id,ticker,name from public.assets where exchange=$1 and asset_class='STOCK' and is_active=true",
      [exchange],
    );
    const idByTicker = new Map(assets.map((r) => [r.ticker.toUpperCase(), r.id]));
    // Names carry the only available signal that a listing is a fund rather than a
    // company; the exchange files and asset_class do not distinguish them.
    const nameByTicker = new Map(assets.map((r) => [r.ticker.toUpperCase(), r.name]));

    const { rows: latestRows } = await client.query<{ latest: string | null }>(
      `select max(o.date)::text latest
         from public.daily_ohlcv o
         join public.assets a on a.id=o.asset_id
        where a.exchange=$1 and a.asset_class='STOCK'`,
      [exchange],
    );
    const latestDateBefore = latestRows[0]?.latest ?? null;

    const priceStart = historyBackfillStart(latestDateBefore, end, opts.startISO);
    let cursor = priceStart;
    if (exchange === "NSE" && !opts.startISO) {
      const { rows: deliveryRows } = await client.query<{ latest: string | null; sessions: string | number }>(
        `select max(d.date)::text latest,count(distinct d.date) sessions
           from public.daily_delivery_metrics d
           join public.assets a on a.id=d.asset_id
          where a.exchange='NSE' and a.asset_class='STOCK' and not d.is_etf`,
      );
      const deliverySessions = Number(deliveryRows[0]?.sessions ?? 0);
      const deliveryStart = deliveryBackfillStart(
        deliverySessions < 40 ? null : deliveryRows[0]?.latest ?? null,
        end,
      );
      if (deliveryStart < cursor) cursor = deliveryStart;
      // A pre-existing current OHLCV history may have only the few delivery rows
      // written since migration 0084. Fill the complete baseline in one EOD run;
      // otherwise max(date) would keep pointing at the recent island forever.
      if (deliverySessions < 40 && opts.maxSessions === undefined) maxSessions = 70;
    }

    let datesAttempted = 0;
    let sessionsFetched = 0;
    let barsUpserted = 0;
    let deliveryUpserted = 0;
    const skipped: { date: string; reason: string }[] = [];

    while (cursor <= end && sessionsFetched < maxSessions) {
      const date = isoDay(cursor);
      cursor = addDays(cursor, 1);
      if (!isTradingDay("IN", date)) {
        skipped.push({ date, reason: "exchange closed" });
        continue;
      }

      datesAttempted++;
      const data = exchange === "BSE"
        ? await fetchBseBhavcopy(new Date(`${date}T00:00:00Z`), idByTicker)
        : await fetchBhavcopy(new Date(`${date}T00:00:00Z`), idByTicker, nameByTicker);
      if (!data) {
        skipped.push({ date, reason: "bhavcopy not available" });
        continue;
      }
      // NSE can serve the previous session's file for a date it has not published
      // yet. Storing that session's rows under the requested date would put a whole
      // day of prices and delivery on the wrong date, so the date is taken from the
      // file and a mismatch is reported rather than absorbed.
      if (data.date !== date) {
        skipped.push({ date, reason: `exchange served ${data.date}` });
        continue;
      }
      const count = await upsertBars(client, data.rows, `${exchange}_BHAVCOPY`);
      const delivery: DeliveryRow[] = data.delivery ?? [];
      if (delivery.length) deliveryUpserted += await upsertDelivery(client, delivery);
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
      deliveryUpserted,
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
