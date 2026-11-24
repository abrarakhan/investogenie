import { query } from "@/lib/db";
import { MARKET_COUNTRY } from "@/lib/markets";
import { DEFAULT_PROBABILITY_CONFIG } from "@/lib/analytics/probability/config";
import { isMarketOpenNow, latestSignalSessionDate, refreshMarketHolidays, zonedMarketClock } from "@/lib/market-calendar.mjs";
import type { MarketId } from "@/lib/types";
import type { ProbabilityConfig, ProbabilityForecast, ProbabilitySummary } from "@/lib/analytics/probability/types";
import { runPythonStrategyBatch } from "@/lib/pythonStrategyMath";

/**
 * Compute fail-closed, holiday-aware OHLCV and quote freshness cutoffs from the shared market calendar.
 * - Completed OHLCV must reach the latest expected completed session (no 1-session lag).
 * - During an active trading session, live quotes from the current session are required.
 * - On holidays, weekends, and after EOD publication, quotes from the latest completed session suffice.
 */
export function probabilityFreshnessCutoffs(market: MarketId, at: Date = new Date()): {
  expectedCompletedSession: string;
  requiredOhlcvDate: string;
  requiredQuoteDate: string;
  marketOpen: boolean;
} {
  const clock = zonedMarketClock(market, at);
  const marketOpen = isMarketOpenNow(market, at);
  const expectedCompletedSession = latestSignalSessionDate(market, at);
  return {
    expectedCompletedSession,
    requiredOhlcvDate: expectedCompletedSession,
    requiredQuoteDate: marketOpen ? clock.date : expectedCompletedSession,
    marketOpen,
  };
}

interface BarRow {
  asset_id: string;
  ticker: string;
  name: string | null;
  exchange: string;
  currency: string;
  date: string | Date;
  close: string | number;
  quote_price: string | number | null;
  quote_change: string | number | null;
}

// node-postgres returns a DATE column as a JS Date at *local* midnight, so toISOString()
// moves it into the previous UTC day anywhere east of Greenwich (under IST a Friday bar
// reads as Thursday). Format from the local parts instead so the calendar day survives.
const dateOnly = (value: string | Date): string => {
  if (!(value instanceof Date)) return String(value).slice(0, 10);
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${value.getFullYear()}-${month}-${day}`;
};

// Probability features, normalization, forecasts and ranking are Python-owned.

export async function getProbabilitySummary(
  market: MarketId,
  cfg: ProbabilityConfig = DEFAULT_PROBABILITY_CONFIG,
): Promise<ProbabilitySummary> {
  if (market === "IN") await refreshMarketHolidays("IN").catch(() => false);
  const { requiredOhlcvDate, requiredQuoteDate } = probabilityFreshnessCutoffs(market);
  const country = MARKET_COUNTRY[market];
  const exchanges = market === "IN" ? ["NSE"] : ["NASDAQ", "NYSE"];
  const rows = await query<BarRow>(
    // Only consider assets that already have enough history to forecast, and
    // rank by size rather than by |change_pct|. Ranking by biggest mover
    // selected for volatility artefacts (low-priced names) and ignored coverage
    // entirely, so on US only ~34 of 320 candidates cleared minBars and the rest
    // of the fetch was discarded.
    `with eligible as (
       select o.asset_id, count(*) as bars
         from public.daily_ohlcv o
        where o.date >= current_date - interval '430 days'
        group by o.asset_id
       having count(*) >= $4
          and max(o.date) >= $5::date
     ),
     ranked_assets as (
       select a.id
         from public.assets a
         join eligible e on e.asset_id = a.id
         left join public.latest_financials f on f.asset_id = a.id
        where a.country = $1 and a.exchange = any($2) and a.asset_class = 'STOCK'::asset_class and a.is_active
          and not exists (select 1 from public.asset_tracking_exclusions x where x.asset_id=a.id)
          and exists (
            select 1 from public.latest_quotes current_quote
             where current_quote.asset_id=a.id
               and current_quote.as_of::date >= $6::date
          )
        order by f.market_cap desc nulls last, a.ticker
        limit $3
     )
     select a.id asset_id, a.ticker, a.name, a.exchange, a.currency, o.date, o.close,
            q.price as quote_price, q.change_pct as quote_change
       from ranked_assets r
       join public.assets a on a.id = r.id
       join public.daily_ohlcv o on o.asset_id = a.id
       left join public.latest_quotes q on q.asset_id = a.id
      where o.date >= current_date - interval '430 days'
      order by a.ticker, o.date`,
    // Candidates are now pre-filtered for coverage, so a small multiple of
    // maxRows is plenty of headroom instead of a 4x over-fetch.
    [country, exchanges, Math.max(cfg.maxRows * 2, 120), cfg.minBars, requiredOhlcvDate, requiredQuoteDate],
  );

  const grouped = new Map<string, BarRow[]>();
  for (const row of rows) {
    const bucket = grouped.get(row.asset_id) ?? [];
    bucket.push(row);
    grouped.set(row.asset_id, bucket);
  }

  const assets = [...grouped.values()].flatMap((assetRows) => {
    const first = assetRows[0];
    if (!first) return [];
    return [{
      assetId: first.asset_id,
      ticker: first.ticker,
      name: first.name ?? first.ticker,
      exchange: first.exchange,
      currency: first.currency,
      quotePrice: first.quote_price === null ? null : Number(first.quote_price),
      quoteChangePct: first.quote_change === null ? null : Number(first.quote_change),
      points: assetRows.map((row) => ({ date: dateOnly(row.date), close: Number(row.close) })),
    }];
  });
  const [calculated] = await runPythonStrategyBatch<
    { config: ProbabilityConfig; assets: typeof assets },
    { rows: ProbabilityForecast[]; eligible: number; featureCount: number }
  >("probability", [{ config: cfg, assets }]);

  return {
    market,
    horizonDays: cfg.horizonDays,
    generatedAt: new Date().toISOString(),
    rows: calculated.rows,
    coverage: {
      eligible: calculated.eligible,
      forecasted: calculated.rows.length,
      skippedInsufficientHistory: Math.max(0, calculated.eligible - calculated.featureCount),
    },
  };
}
