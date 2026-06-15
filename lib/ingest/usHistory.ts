// =============================================================================
// Real US historical EOD ingestion (replaces the synthetic anchored generator).
// -----------------------------------------------------------------------------
// Pulls split-adjusted daily OHLCV bars from a real provider (Tiingo by default)
// and upserts them into public.daily_ohlcv. A full run of ≥250 sessions gives
// the long-horizon indicators (Minervini Trend Template, PTJ 200-day rule) the
// history they need; an incremental run (small `sessions`) keeps the series
// current from a daily cron.
//
// Resilient by construction: a per-ticker failure is isolated and recorded, not
// fatal; transient 429/5xx/network errors are retried with exponential backoff;
// every fetch is bounded by a timeout; requests are throttled to respect free-
// tier rate limits.
//
// Requires FINANCIAL_API_KEY. There is intentionally NO synthetic fallback — if
// the key is missing the caller gets a clear error rather than fabricated data.
// =============================================================================

import { Client } from "pg";

export type Provider = "tiingo";

export interface UsHistoryOptions {
  /** Explicit ticker list; defaults to every US STOCK present in `assets`. */
  tickers?: string[];
  /** Minimum trading sessions to pull (default 260 ≈ 250 + buffer). */
  sessions?: number;
  /** Override the computed start date (ISO yyyy-mm-dd). */
  startISO?: string;
  /** Override the end date (ISO yyyy-mm-dd); defaults to today (UTC). */
  endISO?: string;
  /** Concurrent in-flight requests (default 4 — keep modest for rate limits). */
  concurrency?: number;
  /** Provider id (default "tiingo"). */
  provider?: Provider;
}

export interface UsHistorySummary {
  provider: Provider;
  tickersRequested: number;
  tickersFetched: number;
  barsUpserted: number;
  failures: { ticker: string; error: string }[];
  durationMs: number;
}

interface ProviderBar {
  date: string; // yyyy-mm-dd
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Calendar start date that comfortably spans `sessions` trading days. */
function defaultStartISO(sessions: number, end: Date): string {
  const calendarDays = Math.ceil(sessions * 1.6) + 10; // ~1.45 cal days/session + slack
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - calendarDays);
  return isoDay(start);
}

/** fetch() with timeout + exponential-backoff retry on transient failures. */
async function fetchResilient(
  url: string,
  { attempts = 4, timeoutMs = 15_000 }: { attempts?: number; timeoutMs?: number } = {},
): Promise<Response> {
  let lastErr: unknown = null;
  for (let i = 0; i < attempts; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      clearTimeout(timer);
      // Retry rate-limit / server errors; surface 4xx (other than 429) directly.
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
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

interface TiingoRow {
  date: string;
  open: number; high: number; low: number; close: number; volume: number;
  adjOpen?: number; adjHigh?: number; adjLow?: number; adjClose?: number; adjVolume?: number;
}

/** Fetch split/dividend-adjusted daily bars for one ticker from Tiingo. */
async function fetchTiingoDaily(
  ticker: string,
  apiKey: string,
  startISO: string,
  endISO: string,
): Promise<ProviderBar[]> {
  const sym = encodeURIComponent(ticker.toLowerCase());
  const url =
    `https://api.tiingo.com/tiingo/daily/${sym}/prices` +
    `?startDate=${startISO}&endDate=${endISO}&format=json&token=${apiKey}`;
  const res = await fetchResilient(url);
  if (!res.ok) throw new Error(`Tiingo ${res.status} for ${ticker}`);
  const json = (await res.json()) as TiingoRow[];
  if (!Array.isArray(json)) return [];
  return json
    .map((r) => {
      // Prefer adjusted series so 200-day trends aren't broken by splits.
      const open = r.adjOpen ?? r.open;
      const high = r.adjHigh ?? r.high;
      const low = r.adjLow ?? r.low;
      const close = r.adjClose ?? r.close;
      const volume = r.adjVolume ?? r.volume;
      return {
        date: String(r.date).slice(0, 10),
        open, high, low, close,
        volume: Math.max(0, Math.round(Number(volume) || 0)),
      };
    })
    .filter(
      (b) =>
        b.date &&
        [b.open, b.high, b.low, b.close].every((n) => Number.isFinite(n) && n > 0),
    );
}

const PROVIDERS: Record<Provider, (t: string, k: string, s: string, e: string) => Promise<ProviderBar[]>> = {
  tiingo: fetchTiingoDaily,
};

/** Run an async mapper over `items` with a bounded concurrency pool. */
async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, size) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Backfill (or top up) US daily OHLCV from a real provider.
 *
 * @throws if `apiKey` is missing — no synthetic data is ever produced.
 */
export async function backfillUsHistory(
  databaseUrl: string,
  apiKey: string | undefined,
  opts: UsHistoryOptions = {},
): Promise<UsHistorySummary> {
  const t0 = Date.now();
  if (!apiKey) {
    throw new Error(
      "FINANCIAL_API_KEY is not set — real US history ingestion requires a provider key.",
    );
  }
  const provider = opts.provider ?? "tiingo";
  const fetchDaily = PROVIDERS[provider];
  const sessions = opts.sessions ?? 260;
  const concurrency = opts.concurrency ?? 4;
  const end = opts.endISO ? new Date(`${opts.endISO}T00:00:00Z`) : new Date();
  const endISO = isoDay(end);
  const startISO = opts.startISO ?? defaultStartISO(sessions, end);

  const client = new Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    // Resolve ticker -> asset_id for the US equity universe.
    const params: unknown[] = [];
    let sql = "select id, ticker from public.assets where country='US' and asset_class='STOCK'";
    if (opts.tickers && opts.tickers.length) {
      sql += " and ticker = any($1)";
      params.push(opts.tickers.map((t) => t.toUpperCase()));
    }
    const { rows: assetRows } = await client.query<{ id: string; ticker: string }>(sql, params);
    const idByTicker = new Map(assetRows.map((r) => [r.ticker.toUpperCase(), r.id]));
    const tickers = [...idByTicker.keys()];

    const failures: { ticker: string; error: string }[] = [];
    let tickersFetched = 0;
    let barsUpserted = 0;

    await pool(tickers, concurrency, async (ticker) => {
      const assetId = idByTicker.get(ticker)!;
      try {
        const bars = await fetchDaily(ticker, apiKey, startISO, endISO);
        if (!bars.length) {
          failures.push({ ticker, error: "no bars returned" });
          return;
        }
        tickersFetched++;
        // Chunked upsert so a single ticker's ~260 rows stay well under limits.
        const COLS = 8;
        for (let i = 0; i < bars.length; i += 500) {
          const batch = bars.slice(i, i + 500);
          const vals: string[] = [];
          const p: unknown[] = [];
          batch.forEach((b, j) => {
            const o = j * COLS;
            vals.push(`($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7},$${o + 8})`);
            p.push(assetId, b.date, b.open, b.high, b.low, b.close, b.volume, null);
          });
          await client.query(
            `insert into public.daily_ohlcv
               (asset_id, date, open, high, low, close, volume, open_interest)
             values ${vals.join(",")}
             on conflict (asset_id, date) do update set
               open=excluded.open, high=excluded.high, low=excluded.low,
               close=excluded.close, volume=excluded.volume`,
            p,
          );
          barsUpserted += batch.length;
        }
      } catch (err) {
        failures.push({ ticker, error: err instanceof Error ? err.message : String(err) });
      }
    });

    return {
      provider,
      tickersRequested: tickers.length,
      tickersFetched,
      barsUpserted,
      failures,
      durationMs: Date.now() - t0,
    };
  } finally {
    await client.end();
  }
}
