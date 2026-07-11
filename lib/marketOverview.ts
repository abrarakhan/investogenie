import { query, queryOne } from "@/lib/db";
import { runScreener } from "@/lib/screener";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import type { MarketId } from "@/lib/types";

export interface OverviewQuote {
  ticker: string;
  name: string;
  exchange: string;
  price: number;
  changePct: number | null;
  asOf: string | null;
}

export interface OverviewSeries {
  ticker: string;
  points: { date: string; close: number }[];
}

export interface OverviewCandidate {
  ticker: string;
  current: number | null;
  entry: number | null;
  target: number | null;
  score: number;
  verdict: string;
}

export interface FundamentalLeader {
  ticker: string;
  peRatio: number | null;
  marketCap: number | null;
  roce: number | null;
  salesGrowth: number | null;
  profitGrowth: number | null;
}

export interface DataFreshness {
  latestQuoteAsOf: string | null;
  latestQuoteUpdatedAt: string | null;
  latestHistoryDate: string | null;
  latestFundamentalsPeriod: string | null;
  latestFundamentalsUpdatedAt: string | null;
  lastScanAt: string | null;
  lastScanStatus: string | null;
  lastQuoteSyncAt: string | null;
  lastQuoteSyncStatus: string | null;
  lastHistorySyncAt: string | null;
  lastHistorySyncStatus: string | null;
}

export interface MarketOverviewData {
  market: MarketId;
  quotes: OverviewQuote[];
  gainers: OverviewQuote[];
  losers: OverviewQuote[];
  breadth: { advancers: number; decliners: number; unchanged: number };
  series: OverviewSeries[];
  candidates: OverviewCandidate[];
  fundamentals: FundamentalLeader[];
  coverage: { quoted: number; history: number; fundamentals: number };
  freshness: DataFreshness;
}

interface QuoteRow {
  ticker: string;
  name: string | null;
  exchange: string;
  price: string | number;
  change_pct: string | number | null;
  as_of: string | Date | null;
}

interface FreshnessRow {
  latest_quote_as_of: string | Date | null;
  latest_quote_updated_at: string | Date | null;
  latest_history_date: string | Date | null;
  latest_fundamentals_period: string | Date | null;
  latest_fundamentals_updated_at: string | Date | null;
  last_scan_at: string | Date | null;
  last_scan_status: string | null;
  last_quote_sync_at: string | Date | null;
  last_quote_sync_status: string | null;
  last_history_sync_at: string | Date | null;
  last_history_sync_status: string | null;
}

const REGION = {
  US: {
    country: "US",
    exchanges: ["NASDAQ", "NYSE"],
    instruments: ["AAPL", "MSFT", "NVDA"],
    chart: ["AAPL", "MSFT", "NVDA"],
  },
  IN: {
    country: "IN",
    exchanges: ["NSE"],
    instruments: ["NIFTY", "SENSEX", "USDINR"],
    chart: ["RELIANCE", "HDFCBANK", "INFY"],
  },
} as const;

const dateOnly = (value: Date): string => {
  const yyyy = value.getFullYear();
  const mm = String(value.getMonth() + 1).padStart(2, "0");
  const dd = String(value.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

const isoDate = (value: string | Date | null): string | null => {
  if (!value) return null;
  return value instanceof Date ? dateOnly(value) : value;
};

const isoDateTime = (value: string | Date | null): string | null => {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
};

const quote = (row: QuoteRow): OverviewQuote => ({
  ticker: row.ticker,
  name: row.name ?? row.ticker,
  exchange: row.exchange,
  price: Number(row.price),
  changePct: row.change_pct === null ? null : Number(row.change_pct),
  asOf: isoDate(row.as_of),
});

export async function getMarketOverview(market: MarketId): Promise<MarketOverviewData> {
  const cfg = REGION[market];
  const primaryExchange = cfg.exchanges[0];
  const [instrumentRows, gainers, losers, breadth, historyRows, fundamentals, coverage, freshness, candidates] =
    await Promise.all([
      query<QuoteRow>(
        `select a.ticker,a.name,a.exchange,q.price,q.change_pct,q.as_of
           from public.assets a join public.latest_quotes q on q.asset_id=a.id
          where a.country=$1 and a.ticker=any($2)
          order by array_position($2::text[],a.ticker),
                   case when a.exchange=$3 then 0 else 1 end`,
        [cfg.country, [...cfg.instruments], primaryExchange],
      ),
      query<QuoteRow>(
        `select a.ticker,a.name,a.exchange,q.price,q.change_pct,q.as_of
           from public.assets a join public.latest_quotes q on q.asset_id=a.id
          where a.country=$1 and a.exchange=any($2) and a.asset_class='STOCK'
            and q.change_pct is not null and q.change_pct between -40 and 40
            and ($3::boolean=false or (q.price>=1 and not (length(a.ticker)>=5 and right(a.ticker,1) in ('W','R','U'))))
          order by q.change_pct desc limit 8`,
        [cfg.country, [...cfg.exchanges], market === "US"],
      ),
      query<QuoteRow>(
        `select a.ticker,a.name,a.exchange,q.price,q.change_pct,q.as_of
           from public.assets a join public.latest_quotes q on q.asset_id=a.id
          where a.country=$1 and a.exchange=any($2) and a.asset_class='STOCK'
            and q.change_pct is not null and q.change_pct between -40 and 40
            and ($3::boolean=false or (q.price>=1 and not (length(a.ticker)>=5 and right(a.ticker,1) in ('W','R','U'))))
          order by q.change_pct asc limit 8`,
        [cfg.country, [...cfg.exchanges], market === "US"],
      ),
      queryOne<{ advancers: string; decliners: string; unchanged: string }>(
        `select count(*) filter(where q.change_pct>0)::text advancers,
                count(*) filter(where q.change_pct<0)::text decliners,
                count(*) filter(where q.change_pct=0 or q.change_pct is null)::text unchanged
           from public.latest_quotes q join public.assets a on a.id=q.asset_id
          where a.country=$1 and a.exchange=any($2) and a.asset_class='STOCK'`,
        [cfg.country, [...cfg.exchanges]],
      ),
      query<{ ticker: string; date: string | Date; close: string | number }>(
        `select a.ticker,o.date,o.close
           from public.daily_ohlcv o join public.assets a on a.id=o.asset_id
          where a.country=$1 and a.exchange=$2 and a.ticker=any($3)
            and o.date >= current_date - interval '400 days'
          order by a.ticker,o.date`,
        [cfg.country, primaryExchange, [...cfg.chart]],
      ),
      query<{
        ticker: string;
        pe_ratio: string | number | null;
        market_cap: string | number | null;
        roce: string | number | null;
        sales_variance_yoy: string | number | null;
        profit_variance_yoy: string | number | null;
      }>(
        `select a.ticker,f.pe_ratio,f.market_cap,f.roce,
                f.sales_variance_yoy,f.profit_variance_yoy
           from public.latest_financials f join public.assets a on a.id=f.asset_id
          where a.country=$1 and a.exchange=$2 and f.roce is not null
          order by f.roce desc nulls last limit 8`,
        [cfg.country, primaryExchange],
      ),
      queryOne<{ quoted: string; history: string; fundamentals: string }>(
        `select
           count(distinct q.asset_id)::text quoted,
           count(distinct o.asset_id)::text history,
           count(distinct f.asset_id)::text fundamentals
         from public.assets a
         left join public.latest_quotes q on q.asset_id=a.id
         left join (select distinct asset_id from public.daily_ohlcv) o on o.asset_id=a.id
         left join (select distinct asset_id from public.asset_financial_reports) f on f.asset_id=a.id
         where a.country=$1 and a.exchange=any($2) and a.asset_class='STOCK'`,
        [cfg.country, [...cfg.exchanges]],
      ),
      queryOne<FreshnessRow>(
        `with scoped_assets as (
           select id from public.assets
            where country=$1 and exchange=any($2) and asset_class='STOCK'
         ), latest_scan as (
           select created_at,status from public.cron_logs
            where job='scan' order by created_at desc limit 1
         ), latest_quote_sync as (
           select created_at,status from public.cron_logs
            where job='refresh-quotes' order by created_at desc limit 1
         ), latest_history_sync as (
           select created_at,status from public.cron_logs
            where job = case when $1='US' then 'backfill-us' else 'backfill-nse' end
            order by created_at desc limit 1
         )
         select
           (select max(q.as_of) from public.latest_quotes q join scoped_assets a on a.id=q.asset_id) latest_quote_as_of,
           (select max(q.updated_at) from public.latest_quotes q join scoped_assets a on a.id=q.asset_id) latest_quote_updated_at,
           (select max(o.date) from public.daily_ohlcv o join scoped_assets a on a.id=o.asset_id) latest_history_date,
           (select max(f.period_end_date) from public.latest_financials f join scoped_assets a on a.id=f.asset_id) latest_fundamentals_period,
           (select max(f.updated_at) from public.asset_financial_reports f join scoped_assets a on a.id=f.asset_id) latest_fundamentals_updated_at,
           (select created_at from latest_scan) last_scan_at,
           (select status from latest_scan) last_scan_status,
           (select created_at from latest_quote_sync) last_quote_sync_at,
           (select status from latest_quote_sync) last_quote_sync_status,
           (select created_at from latest_history_sync) last_history_sync_at,
           (select status from latest_history_sync) last_history_sync_status`,
        [cfg.country, [...cfg.exchanges]],
      ),
      runScreener(cfg.country, { ...DEFAULT_SETTINGS, includeShort: false }, {
        exchange: primaryExchange,
        limit: 6,
      }),
    ]);

  const instrumentMap = new Map<string, OverviewQuote>();
  for (const row of instrumentRows) {
    if (!instrumentMap.has(row.ticker)) instrumentMap.set(row.ticker, quote(row));
  }

  const seriesMap = new Map<string, OverviewSeries["points"]>();
  for (const row of historyRows) {
    const points = seriesMap.get(row.ticker) ?? [];
    points.push({ date: isoDate(row.date) ?? "", close: Number(row.close) });
    seriesMap.set(row.ticker, points);
  }
  const n = (value: string | number | null) => value === null ? null : Number(value);

  return {
    market,
    quotes: cfg.instruments.flatMap((ticker) => {
      const value = instrumentMap.get(ticker);
      return value ? [value] : [];
    }),
    gainers: gainers.map(quote),
    losers: losers.map(quote),
    breadth: {
      advancers: Number(breadth?.advancers ?? 0),
      decliners: Number(breadth?.decliners ?? 0),
      unchanged: Number(breadth?.unchanged ?? 0),
    },
    series: cfg.chart.flatMap((ticker) => {
      const points = seriesMap.get(ticker);
      return points?.length ? [{ ticker, points }] : [];
    }),
    candidates: candidates.map((row) => ({
      ticker: row.ticker,
      current: row.lastQuote,
      entry: row.entry,
      target: row.target,
      score: row.score,
      verdict: row.verdict,
    })),
    fundamentals: fundamentals.map((row) => ({
      ticker: row.ticker,
      peRatio: n(row.pe_ratio),
      marketCap: n(row.market_cap),
      roce: n(row.roce),
      salesGrowth: n(row.sales_variance_yoy),
      profitGrowth: n(row.profit_variance_yoy),
    })),
    coverage: {
      quoted: Number(coverage?.quoted ?? 0),
      history: Number(coverage?.history ?? 0),
      fundamentals: Number(coverage?.fundamentals ?? 0),
    },
    freshness: {
      latestQuoteAsOf: isoDate(freshness?.latest_quote_as_of ?? null),
      latestQuoteUpdatedAt: isoDateTime(freshness?.latest_quote_updated_at ?? null),
      latestHistoryDate: isoDate(freshness?.latest_history_date ?? null),
      latestFundamentalsPeriod: isoDate(freshness?.latest_fundamentals_period ?? null),
      latestFundamentalsUpdatedAt: isoDateTime(freshness?.latest_fundamentals_updated_at ?? null),
      lastScanAt: isoDateTime(freshness?.last_scan_at ?? null),
      lastScanStatus: freshness?.last_scan_status ?? null,
      lastQuoteSyncAt: isoDateTime(freshness?.last_quote_sync_at ?? null),
      lastQuoteSyncStatus: freshness?.last_quote_sync_status ?? null,
      lastHistorySyncAt: isoDateTime(freshness?.last_history_sync_at ?? null),
      lastHistorySyncStatus: freshness?.last_history_sync_status ?? null,
    },
  };
}
