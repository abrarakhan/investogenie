import { query, queryOne } from "@/lib/db";
import { latestExpectedSessionDate, refreshMarketHolidays } from "@/lib/market-calendar.mjs";
import { backtestUniversalPortfolio, type UniversalBacktestResult, type UniversalPricePoint } from "@/lib/analytics/universalPortfolio";
import { selectAdaptiveAllocationPair, type AdaptivePairSelection, type AdaptiveSelectionCandidate } from "@/lib/analytics/adaptiveAllocationSelection";
import type { MarketId } from "@/lib/types";

interface AssetRow { id: string; ticker: string; name: string | null; exchange: string | null }
interface PriceRow { date: string | Date; close: string | number }

export interface AdaptiveBacktest {
  assetA: AssetRow;
  assetB: AssetRow;
  result: UniversalBacktestResult;
  expectedSessionDate: string;
  latestCommonDate: string;
  warning: string | null;
}

export interface AutomaticAdaptiveSelection {
  tickerA: string;
  tickerB: string;
  poolSize: number;
  correlation: number;
  returnA12mPct: number;
  returnB12mPct: number;
  commonSessions: number;
  sectorA: string | null;
  sectorB: string | null;
}

export interface SavedAdaptiveStrategy {
  id: string;
  name: string;
  market: MarketId;
  tickerA: string;
  tickerB: string;
  initialCapital: number;
  feeBps: number;
  noTradeBandPct: number;
  lookbackYears: number;
  status: "ACTIVE" | "PAUSED";
  latestAsOf: string | null;
  latestVerdict: UniversalBacktestResult["verdict"] | null;
  latestWeightA: number | null;
}

const isoDate = (value: string | Date) => typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);

export async function getAutomaticAdaptiveSelection(
  market: MarketId,
  lookbackYears: number,
): Promise<AutomaticAdaptiveSelection> {
  await refreshMarketHolidays(market);
  const expectedSessionDate = latestExpectedSessionDate(market);
  const assets = await query<AssetRow & { sector: string | null }>(
    `select a.id,a.ticker,a.name,a.exchange,s.sector
       from public.assets a
       left join public.stock_snapshot s on s.asset_id=a.id
      where a.country=$1 and a.asset_class='STOCK'
        and ($1 <> 'IN' or a.exchange='NSE')
        and exists (
          select 1 from public.daily_ohlcv recent
           where recent.asset_id=a.id and recent.date=$2::date
        )
      order by s.market_cap desc nulls last,s.trade_value desc nulls last,a.ticker
      limit 14`,
    [market, expectedSessionDate],
  );
  if (assets.length < 2) {
    throw new Error(`Fewer than two liquid ${market} stocks have history through ${expectedSessionDate}. Refresh market data and try again.`);
  }
  const years = Math.max(1, Math.min(20, Math.round(lookbackYears)));
  const rows = await query<PriceRow & { asset_id: string }>(
    `select asset_id,date,close
       from public.daily_ohlcv
      where asset_id=any($1::uuid[]) and date >= current_date - ($2::text || ' years')::interval
      order by asset_id,date`,
    [assets.map((asset) => asset.id), years],
  );
  const pricesByAsset = new Map<string, AdaptiveSelectionCandidate["prices"]>();
  for (const row of rows) {
    const prices = pricesByAsset.get(row.asset_id) ?? [];
    prices.push({ date: isoDate(row.date), close: Number(row.close) });
    pricesByAsset.set(row.asset_id, prices);
  }
  const candidates: AdaptiveSelectionCandidate[] = assets.map((asset, index) => ({
    ...asset,
    liquidityRank: index + 1,
    prices: pricesByAsset.get(asset.id) ?? [],
  }));
  const selected: AdaptivePairSelection = selectAdaptiveAllocationPair(candidates);
  return {
    tickerA: selected.assetA.ticker,
    tickerB: selected.assetB.ticker,
    poolSize: candidates.length,
    correlation: selected.correlation,
    returnA12mPct: selected.returnA12mPct,
    returnB12mPct: selected.returnB12mPct,
    commonSessions: selected.commonSessions,
    sectorA: selected.assetA.sector,
    sectorB: selected.assetB.sector,
  };
}

export async function resolveAdaptiveAsset(market: MarketId, rawTicker: string): Promise<AssetRow> {
  const ticker = rawTicker.trim().toUpperCase();
  if (!ticker) throw new Error("Enter both asset tickers.");
  const asset = await queryOne<AssetRow>(
    `select a.id,a.ticker,a.name,a.exchange
       from public.assets a
      where a.country=$1 and a.asset_class='STOCK' and upper(a.ticker)=$2
        and ($1 <> 'IN' or a.exchange='NSE')
      order by (select count(*) from public.daily_ohlcv o where o.asset_id=a.id) desc
      limit 1`,
    [market, ticker],
  );
  if (!asset) throw new Error(`${ticker} was not found in the ${market} market universe.`);
  return asset;
}

export async function getAdaptiveBacktest(input: {
  market: MarketId;
  tickerA: string;
  tickerB: string;
  lookbackYears: number;
  initialCapital: number;
  feeBps: number;
  noTradeBandPct: number;
}): Promise<AdaptiveBacktest> {
  await refreshMarketHolidays(input.market);
  const [assetA, assetB] = await Promise.all([
    resolveAdaptiveAsset(input.market, input.tickerA),
    resolveAdaptiveAsset(input.market, input.tickerB),
  ]);
  if (assetA.id === assetB.id) throw new Error("Choose two different assets.");
  const years = Math.max(1, Math.min(20, Math.round(input.lookbackYears)));
  const rows = await query<PriceRow & { asset_id: string }>(
    `select asset_id,date,close
       from public.daily_ohlcv
      where asset_id=any($1::uuid[]) and date >= current_date - ($2::text || ' years')::interval
      order by date asc`,
    [[assetA.id, assetB.id], years],
  );
  const prices = new Map<string, [number | null, number | null]>();
  for (const row of rows) {
    const date = isoDate(row.date);
    const pair = prices.get(date) ?? [null, null];
    pair[row.asset_id === assetA.id ? 0 : 1] = Number(row.close);
    prices.set(date, pair);
  }
  const points: UniversalPricePoint[] = [...prices.entries()]
    .filter((entry): entry is [string, [number, number]] => entry[1][0] !== null && entry[1][1] !== null)
    .map(([date, pair]) => ({ date, prices: pair }));
  if (points.length < 30) throw new Error("The pair has fewer than 30 common adjusted trading sessions.");
  const expectedSessionDate = latestExpectedSessionDate(input.market);
  const latestCommonDate = points.at(-1)!.date;
  if (latestCommonDate < expectedSessionDate) {
    throw new Error(`Common OHLCV ends on ${latestCommonDate}; expected ${expectedSessionDate}. Refresh history before trusting this backtest.`);
  }
  const result = backtestUniversalPortfolio(points, {
    initialCapital: input.initialCapital,
    feeBps: input.feeBps,
    noTradeBandPct: input.noTradeBandPct,
  });
  return { assetA, assetB, result, expectedSessionDate, latestCommonDate, warning: null };
}

export async function getSavedAdaptiveStrategies(userId: string, market: MarketId): Promise<SavedAdaptiveStrategy[]> {
  const rows = await query<{
    id: string; name: string; market: MarketId; ticker_a: string; ticker_b: string;
    initial_capital: string; fee_bps: string; no_trade_band_pct: string; lookback_years: number;
    status: "ACTIVE" | "PAUSED"; latest_as_of: string | Date | null; latest_verdict: UniversalBacktestResult["verdict"] | null;
    latest_weight_a: string | null;
  }>(
    `select s.id,s.name,s.market,a.ticker ticker_a,b.ticker ticker_b,s.initial_capital,s.fee_bps,
            s.no_trade_band_pct,s.lookback_years,s.status,r.as_of latest_as_of,r.verdict latest_verdict,
            r.target_weight_a latest_weight_a
       from public.adaptive_allocation_strategies s
       join public.assets a on a.id=s.asset_a_id
       join public.assets b on b.id=s.asset_b_id
       left join lateral (select * from public.adaptive_allocation_runs x where x.strategy_id=s.id order by x.as_of desc limit 1) r on true
      where s.user_id=$1 and s.market=$2 order by s.created_at desc`,
    [userId, market],
  );
  return rows.map((row) => ({
    id: row.id, name: row.name, market: row.market, tickerA: row.ticker_a, tickerB: row.ticker_b,
    initialCapital: Number(row.initial_capital), feeBps: Number(row.fee_bps), noTradeBandPct: Number(row.no_trade_band_pct),
    lookbackYears: row.lookback_years, status: row.status, latestAsOf: row.latest_as_of ? isoDate(row.latest_as_of) : null,
    latestVerdict: row.latest_verdict, latestWeightA: row.latest_weight_a === null ? null : Number(row.latest_weight_a),
  }));
}
