import { query } from "@/lib/db";
import {
  deriveHistoricalMetrics,
  type AnnualFundamentalPoint,
  type LongTermFundamentals,
  type LongTermMarket,
} from "@/lib/analytics/longTermStrategies";

interface LongTermDataRow {
  asset_id: string;
  symbol: string;
  name: string | null;
  sector: string | null;
  exchange: string;
  currency: string;
  ltp: string | number | null;
  change_pct_1d: string | number | null;
  quote_as_of: Date | string | null;
  pct_from_52w_high: string | number | null;
  report_period: Date | string;
  fundamentals_updated_at: Date | string;
  source: string | null;
  report_currency: string | null;
  cmp: string | number | null;
  provider_market_cap: string | number | null;
  provider_pe: string | number | null;
  roe: string | number | null;
  debt_to_equity: string | number | null;
  dividend_yield: string | number | null;
  free_cash_flow: string | number | null;
  revenue_growth_yoy: string | number | null;
  profit_growth_yoy: string | number | null;
  ttm_net_profit: string | number | null;
  ttm_quarters: string | number;
  statement_period: Date | string | null;
  annual_ebit: string | number | null;
  annual_ebitda: string | number | null;
  annual_interest_expense: string | number | null;
  annual_net_profit: string | number | null;
  total_assets: string | number | null;
  current_assets: string | number | null;
  cash_and_equivalents: string | number | null;
  receivables: string | number | null;
  current_liabilities: string | number | null;
  total_debt: string | number | null;
  shareholders_equity: string | number | null;
  annual_operating_cash_flow: string | number | null;
  annual_series: unknown;
}

export interface LongTermDataRecord {
  assetId: string;
  symbol: string;
  name: string | null;
  sector: string | null;
  exchange: string;
  currency: string;
  ltp: number | null;
  changePct1d: number | null;
  quoteAsOf: string | null;
  reportPeriod: string;
  statementPeriod: string | null;
  fundamentalsUpdatedAt: string;
  source: string | null;
  marketCap: number | null;
  fundamentals: LongTermFundamentals;
}

const numberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const dateOnly = (value: Date | string | null): string | null => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
};

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const CACHE_TTL_MS = 5 * 60 * 1000;
const globalForLongTerm = globalThis as unknown as {
  __igLongTermCache?: Map<LongTermMarket, { expiresAt: number; records: LongTermDataRecord[] }>;
};
const dataCache = globalForLongTerm.__igLongTermCache ?? new Map();
globalForLongTerm.__igLongTermCache = dataCache;

function parseAnnualSeries(value: unknown): AnnualFundamentalPoint[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      period: dateOnly(String(row.period ?? "")) ?? "",
      revenue: numberOrNull(row.revenue),
      netProfit: numberOrNull(row.net_profit),
      roce: numberOrNull(row.roce),
      operatingCashFlow: numberOrNull(row.operating_cash_flow),
      freeCashFlow: numberOrNull(row.free_cash_flow),
    };
  });
}

function daysOld(period: string): number {
  const milliseconds = Date.now() - new Date(`${period}T00:00:00Z`).getTime();
  return Math.max(0, Math.floor(milliseconds / 86_400_000));
}

const SQL = `
with ranked_assets as (
  select a.id, a.ticker symbol, a.name, a.sector, a.exchange, a.currency,
         q.price, q.change_pct, q.as_of quote_as_of,
         row_number() over (
           partition by a.country, upper(a.ticker)
           order by (a.exchange = 'NSE') desc,
                    (q.asset_id is not null) desc,
                    a.created_at asc
         ) listing_rank
    from public.assets a
    left join public.latest_quotes q on q.asset_id = a.id
   where a.country = $1
     and a.asset_class = 'STOCK'
     and a.is_active
     and exists (select 1 from public.asset_financial_reports f where f.asset_id = a.id)
),
universe as (
  select * from ranked_assets where listing_rank = 1
),
quarterly_ranked as (
  select f.*,
         row_number() over (partition by f.asset_id order by f.period_end_date desc) report_rank
    from public.asset_financial_reports f
    join universe u on u.id = f.asset_id
   where f.report_type = 'QUARTERLY'
),
latest_quarter as (
  select * from quarterly_ranked where report_rank = 1
),
ttm as (
  select asset_id,
         sum(net_profit) filter (where report_rank <= 4) ttm_net_profit,
         count(*) filter (where report_rank <= 4) ttm_quarters
    from quarterly_ranked
   group by asset_id
),
annual_ranked as (
  select f.*,
         row_number() over (partition by f.asset_id order by f.period_end_date desc) report_rank
    from public.asset_financial_reports f
    join universe u on u.id = f.asset_id
   where f.report_type = 'ANNUAL'
),
annual as (
  select ar.asset_id,
         jsonb_agg(
           jsonb_build_object(
             'period', ar.period_end_date,
             'revenue', ar.revenue,
             'net_profit', ar.net_profit,
             'roce', ar.roce,
             'operating_cash_flow', cf.operating_cash_flow,
             'free_cash_flow', cf.free_cash_flow
           )
           order by ar.period_end_date desc
         ) filter (where ar.report_rank <= 10) annual_series
    from annual_ranked ar
    left join public.asset_cash_flow_statements cf
      on cf.asset_id=ar.asset_id and cf.period_end_date=ar.period_end_date
     and cf.report_type=ar.report_type
   group by ar.asset_id
),
latest_annual_health as (
  select ar.asset_id,
         case when bs.asset_id is not null or cf.asset_id is not null
              then ar.period_end_date end statement_period,
         ar.ebit annual_ebit, ar.ebitda annual_ebitda,
         ar.interest_expense annual_interest_expense,
         ar.net_profit annual_net_profit,
         bs.total_assets, bs.current_assets, bs.cash_and_equivalents,
         bs.receivables, bs.current_liabilities, bs.total_debt,
         bs.shareholders_equity, cf.operating_cash_flow annual_operating_cash_flow
    from annual_ranked ar
    left join public.asset_balance_sheets bs
      on bs.asset_id=ar.asset_id and bs.period_end_date=ar.period_end_date
     and bs.report_type=ar.report_type
    left join public.asset_cash_flow_statements cf
      on cf.asset_id=ar.asset_id and cf.period_end_date=ar.period_end_date
     and cf.report_type=ar.report_type
   where ar.report_rank=1
),
last_bar as (
  select distinct on (o.asset_id) o.asset_id, o.close, o.date
    from public.daily_ohlcv o
    join universe u on u.id = o.asset_id
   order by o.asset_id, o.date desc
),
year_high as (
  select o.asset_id, max(o.high) high_52w
    from public.daily_ohlcv o
    join universe u on u.id = o.asset_id
   where o.date >= current_date - interval '1 year'
   group by o.asset_id
)
select u.id asset_id, u.symbol, u.name, u.sector, u.exchange, u.currency,
       coalesce(u.price, b.close) ltp, u.change_pct change_pct_1d,
       coalesce(u.quote_as_of, b.date) quote_as_of,
       case when yh.high_52w > 0
            then (coalesce(u.price, b.close) - yh.high_52w) / yh.high_52w * 100 end pct_from_52w_high,
       lq.period_end_date report_period, lq.updated_at fundamentals_updated_at, lq.source,
       lq.currency report_currency,
       lq.cmp, lq.market_cap provider_market_cap, lq.pe_ratio provider_pe,
       lq.roe, lq.debt_to_equity, lq.dividend_yield, lq.free_cash_flow,
       lq.sales_variance_yoy revenue_growth_yoy,
       lq.profit_variance_yoy profit_growth_yoy,
       t.ttm_net_profit, t.ttm_quarters,
       ah.statement_period, ah.annual_ebit, ah.annual_ebitda,
       ah.annual_interest_expense, ah.annual_net_profit,
       ah.total_assets, ah.current_assets, ah.cash_and_equivalents,
       ah.receivables, ah.current_liabilities, ah.total_debt,
       ah.shareholders_equity, ah.annual_operating_cash_flow,
       coalesce(an.annual_series, '[]'::jsonb) annual_series
  from universe u
  join latest_quarter lq on lq.asset_id = u.id
  left join ttm t on t.asset_id = u.id
  left join annual an on an.asset_id = u.id
  left join latest_annual_health ah on ah.asset_id = u.id
  left join last_bar b on b.asset_id = u.id
  left join year_high yh on yh.asset_id = u.id
 order by u.symbol
`;

export async function getLongTermData(market: LongTermMarket): Promise<LongTermDataRecord[]> {
  const cached = dataCache.get(market);
  if (cached && cached.expiresAt > Date.now()) return cached.records;

  const rows = await query<LongTermDataRow>(SQL, [market]);
  const records = rows.map((row) => {
    const ltp = numberOrNull(row.ltp);
    const providerMarketCap = numberOrNull(row.provider_market_cap);
    const cmp = numberOrNull(row.cmp);
    const adjustedMarketCap =
      providerMarketCap !== null && cmp !== null && cmp > 0 && ltp !== null && ltp > 0
        ? providerMarketCap * ltp / cmp
        : providerMarketCap;
    const ttmProfit = Number(row.ttm_quarters) >= 4 ? numberOrNull(row.ttm_net_profit) : null;
    const providerPe = numberOrNull(row.provider_pe);
    const priceAdjustedProviderPe =
      providerPe !== null && providerPe > 0 && cmp !== null && cmp > 0 && ltp !== null && ltp > 0
        ? providerPe * ltp / cmp
        : providerPe;
    const sameReportingCurrency = !row.report_currency || row.report_currency === row.currency;
    const peRatio = priceAdjustedProviderPe ?? (
      sameReportingCurrency && adjustedMarketCap !== null && ttmProfit !== null && ttmProfit > 0
        ? adjustedMarketCap / ttmProfit
        : null
    );
    const freeCashFlow = numberOrNull(row.free_cash_flow);
    const freeCashFlowYield =
      sameReportingCurrency && freeCashFlow !== null && adjustedMarketCap !== null && adjustedMarketCap > 0
        ? freeCashFlow / adjustedMarketCap * 100
        : null;
    const reportPeriod = dateOnly(row.report_period) ?? "1970-01-01";
    const history = deriveHistoricalMetrics(parseAnnualSeries(row.annual_series));
    const annualEbit = numberOrNull(row.annual_ebit);
    const annualEbitda = numberOrNull(row.annual_ebitda);
    const annualInterestExpense = numberOrNull(row.annual_interest_expense);
    const annualNetProfit = numberOrNull(row.annual_net_profit);
    const totalAssets = numberOrNull(row.total_assets);
    const currentAssets = numberOrNull(row.current_assets);
    const cash = numberOrNull(row.cash_and_equivalents);
    const receivables = numberOrNull(row.receivables);
    const currentLiabilities = numberOrNull(row.current_liabilities);
    const totalDebt = numberOrNull(row.total_debt);
    const equity = numberOrNull(row.shareholders_equity);
    const annualOperatingCashFlow = numberOrNull(row.annual_operating_cash_flow);
    const ratio = (numerator: number | null, denominator: number | null): number | null =>
      numerator !== null && denominator !== null && denominator !== 0 ? numerator / denominator : null;
    const currentRatio = ratio(currentAssets, currentLiabilities);
    const quickRatio = cash !== null && receivables !== null
      ? ratio(cash + receivables, currentLiabilities)
      : null;
    const netDebtToEbitda = cash !== null && totalDebt !== null
      ? ratio(totalDebt - cash, annualEbitda)
      : null;
    const interestCoverage = ratio(annualEbit, annualInterestExpense === null ? null : Math.abs(annualInterestExpense));
    const priceToBook = sameReportingCurrency ? ratio(adjustedMarketCap, equity) : null;
    const enterpriseValue = sameReportingCurrency && adjustedMarketCap !== null && totalDebt !== null && cash !== null
      ? adjustedMarketCap + totalDebt - cash
      : null;
    const ebitEnterpriseValueYield = ratio(annualEbit, enterpriseValue);
    const accrualRatio = annualNetProfit !== null && annualOperatingCashFlow !== null
      ? ratio(annualNetProfit - annualOperatingCashFlow, totalAssets)
      : null;

    return {
      assetId: row.asset_id,
      symbol: row.symbol,
      name: row.name,
      sector: row.sector,
      exchange: row.exchange,
      currency: row.currency,
      ltp,
      changePct1d: numberOrNull(row.change_pct_1d),
      quoteAsOf: dateOnly(row.quote_as_of),
      reportPeriod,
      statementPeriod: dateOnly(row.statement_period),
      fundamentalsUpdatedAt: iso(row.fundamentals_updated_at),
      source: row.source,
      marketCap: adjustedMarketCap,
      fundamentals: {
        ...history,
        peRatio,
        roe: numberOrNull(row.roe),
        debtToEquity: numberOrNull(row.debt_to_equity),
        dividendYield: numberOrNull(row.dividend_yield),
        marketCap: adjustedMarketCap,
        freeCashFlowYield,
        currentRatio,
        quickRatio,
        netDebtToEbitda,
        interestCoverage,
        priceToBook,
        ebitEnterpriseValueYield: ebitEnterpriseValueYield === null ? null : ebitEnterpriseValueYield * 100,
        accrualRatioPct: accrualRatio === null ? null : accrualRatio * 100,
        revenueGrowthYoY: numberOrNull(row.revenue_growth_yoy),
        profitGrowthYoY: numberOrNull(row.profit_growth_yoy),
        pctFrom52wHigh: numberOrNull(row.pct_from_52w_high),
        reportAgeDays: daysOld(reportPeriod),
        sector: row.sector,
      },
    };
  });
  dataCache.set(market, { expiresAt: Date.now() + CACHE_TTL_MS, records });
  return records;
}
