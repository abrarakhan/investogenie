import { query } from "@/lib/db";
import { chosenBenchmarkSql } from "@/lib/benchmarkSql";

export interface MarketBenchmarkBarRow {
  asset_id: string;
  date: string;
  open: string | number;
  high: string | number;
  low: string | number;
  close: string | number;
  volume: string | number;
  open_interest: string | number | null;
}

const BENCHMARK_TTL_MS = 60_000;
const UNIVERSE_COUNT_TTL_MS = 5 * 60_000;

interface CacheEntry<T> {
  at: number;
  value?: T;
  hasValue: boolean;
  pending?: Promise<T>;
}

const store = ((globalThis as { __investogenieMarketContext?: Map<string, CacheEntry<unknown>> })
  .__investogenieMarketContext ??= new Map());

function getOrLoad<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const now = Date.now();
  let entry = store.get(key) as CacheEntry<T> | undefined;
  if (entry?.hasValue && now - entry.at < ttlMs) return Promise.resolve(entry.value as T);
  if (entry?.pending) return entry.pending;
  if (!entry) {
    entry = { at: 0, hasValue: false };
    store.set(key, entry as CacheEntry<unknown>);
  }
  const current = entry;
  const pending = loader().then(
    (value) => {
      current.value = value;
      current.hasValue = true;
      current.at = Date.now();
      current.pending = undefined;
      return value;
    },
    (error) => {
      current.pending = undefined;
      if (!current.hasValue && store.get(key) === current) store.delete(key);
      throw error;
    },
  );
  current.pending = pending;
  return pending;
}

/**
 * Shared short-TTL cache for the 260-bar completed benchmark series used identically by
 * Strong Swing, Momentum Ignition, and Armed Strong Swing.
 */
export function loadBenchmarkBarsCached(
  market: "IN" | "US",
  benchmarkTickers: readonly string[],
  marketOpen: boolean,
  sessionDate: string,
): Promise<MarketBenchmarkBarRow[]> {
  const key = `bench:${market}:${benchmarkTickers.join(",")}:${marketOpen ? 1 : 0}:${sessionDate}`;
  return getOrLoad(key, BENCHMARK_TTL_MS, () =>
    query<MarketBenchmarkBarRow>(
      `with chosen as (
         ${chosenBenchmarkSql("$1", "$2")}
       )
       select o.asset_id,o.date::text date,o.open,o.high,o.low,o.close,o.volume,o.open_interest
         from public.daily_ohlcv o join chosen c on c.id=o.asset_id
        where not ($3::boolean and o.date >= $4::date)
        order by o.date desc limit 260`,
      [market, [...benchmarkTickers], marketOpen, sessionDate],
    ),
  );
}

/** Shared short-TTL cache for active equity universe counts (Momentum & Armed Swing). */
export function loadUniverseCountCached(market: "IN" | "US"): Promise<number> {
  const universeWhere = market === "IN"
    ? "a.country='IN' and a.exchange='NSE'"
    : "a.country='US' and a.exchange in ('NASDAQ','NYSE','AMEX','NYSEARCA','NYSEAMERICAN')";
  return getOrLoad(`universe-count:${market}`, UNIVERSE_COUNT_TTL_MS, async () => {
    const rows = await query<{ count: string | number }>(
      `select count(*)::text count from public.assets a
        where ${universeWhere} and a.asset_class='STOCK' and a.is_active
          and not exists (select 1 from public.asset_tracking_exclusions x where x.asset_id=a.id)`,
    );
    return Number(rows[0]?.count ?? 0);
  });
}

/** Test-only reset. */
export function resetMarketContextCache(): void {
  store.clear();
}
