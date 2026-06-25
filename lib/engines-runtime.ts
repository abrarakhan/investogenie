// Server-side glue: pull market data out of Postgres and run the analytical
// engines, scoped to a single market (US or India). Direct SQL; user-owned
// queries are scoped by the session user id (no RLS in plain Postgres).

import { query } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import {
  analyzeFundOverlap,
  type OverlapReport,
} from "@/lib/analytics/fundOverlap";
import {
  buildMacroMatrix,
  type MacroMatrix,
  type SeriesInput,
} from "@/lib/analytics/macroCorrelator";
import type { MarketId, FundStockWeight, UserFundHolding } from "@/lib/types";
import { deriveLevels, type SwingSetup, type TradeDirection } from "@/lib/analytics/swingClassifier";
import { DEFAULT_SETTINGS, type SwingSettings } from "@/lib/settings";

export interface TopSetup {
  ticker: string;
  verdict: string;
  direction: TradeDirection;
  score: number;
  reason: string;
  entry: number;
  target: number;
  stopLoss: number;
  trailingStop: number;
  expectedDays: number;
}

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

/** Top active swing setups for a market, with per-user levels applied. */
export async function getTopSwingSetups(
  country: string,
  settings: SwingSettings = DEFAULT_SETTINGS,
  limit = 6,
): Promise<TopSetup[]> {
  const rows = await query<Record<string, unknown>>(
    `select ticker, verdict, score, reason, bias, current_price, atr,
            long_trigger, short_trigger, hh22, ll22, daily_velocity
       from public.swing_signals
      where country = $1 and verdict <> 'NO_SETUP'
      order by score desc
      limit $2`,
    [country, limit * 2],
  );
  return rows
    .filter((r) => settings.includeShort || (r.bias as string) !== "SHORT")
    .slice(0, limit)
    .map((r) => {
      const direction: TradeDirection = (r.bias as string) === "SHORT" ? "SHORT" : "LONG";
      const setup: SwingSetup = {
        currentPrice: num(r.current_price), atr: num(r.atr),
        longTrigger: num(r.long_trigger), shortTrigger: num(r.short_trigger),
        hh22: num(r.hh22), ll22: num(r.ll22), dailyVelocity: num(r.daily_velocity),
      };
      const lv = deriveLevels(setup, direction, settings);
      return {
        ticker: r.ticker as string,
        verdict: r.verdict as string,
        direction,
        score: num(r.score),
        reason: (r.reason as string) ?? "",
        entry: lv.entry, target: lv.target, stopLoss: lv.stopLoss,
        trailingStop: lv.trailingStop, expectedDays: lv.expectedDays,
      };
    });
}

/** Look-through fund overlap for the signed-in user's actual fund positions. */
export async function getFundOverlap(): Promise<OverlapReport | null> {
  const user = await getSessionUser();
  if (!user) return null;

  const heldFunds = (
    await query<{ ticker: string; asset_class: string; quantity: string | number; avg_cost: string | number | null }>(
      `select a.ticker, a.asset_class, h.quantity, h.avg_cost
         from public.holdings h
         join public.assets a on a.id = h.asset_id
        where h.user_id = $1`,
      [user.id],
    )
  )
    .map((h) => ({ ticker: h.ticker, assetClass: h.asset_class, units: Number(h.quantity), nav: Number(h.avg_cost ?? 0) }))
    .filter((h) => h.assetClass === "MUTUAL_FUND" && h.ticker && h.units > 0);
  if (heldFunds.length === 0) return null;

  const mfh = await query<{ fund_asset_id: string; stock_asset_id: string; weight_percentage: string | number }>(
    "select fund_asset_id, stock_asset_id, weight_percentage from public.mutual_fund_holdings",
  );
  if (mfh.length === 0) return null;

  const ids = [...new Set(mfh.flatMap((r) => [r.fund_asset_id, r.stock_asset_id]))];
  const assets = await query<{ id: string; ticker: string }>(
    "select id, ticker from public.assets where id = any($1)",
    [ids],
  );
  const idToTicker = new Map(assets.map((a) => [a.id, a.ticker]));

  const lookThrough: FundStockWeight[] = mfh
    .map((r) => ({
      fundTicker: idToTicker.get(r.fund_asset_id) ?? "",
      stockTicker: idToTicker.get(r.stock_asset_id) ?? "",
      weightPercentage: Number(r.weight_percentage),
    }))
    .filter((r) => r.fundTicker && r.stockTicker);

  const meta = await query<{ asset_id: string; expense_ratio: string | number | null; plan_type: string | null }>(
    "select asset_id, expense_ratio, plan_type from public.mutual_fund_meta",
  );
  const metaList = meta.map((m) => ({
    ticker: idToTicker.get(m.asset_id) ?? "",
    expenseRatio: m.expense_ratio === null ? undefined : Number(m.expense_ratio),
    planType: (m.plan_type as "DIRECT" | "REGULAR") ?? undefined,
  }));
  const metaByTicker = new Map(metaList.map((m) => [m.ticker, m]));

  const portfolio: UserFundHolding[] = heldFunds.map((h) => ({
    fundTicker: h.ticker,
    units: h.units,
    navValue: h.nav > 0 ? h.nav : 100,
    planType: metaByTicker.get(h.ticker)?.planType,
  }));

  return analyzeFundOverlap(portfolio, lookThrough, metaList);
}

/** OHLCV close series for one ticker (used as a sector proxy). */
async function tickerCloseSeries(ticker: string): Promise<{ date: string; value: number }[]> {
  const rows = await query<{ date: string; close: string | number }>(
    `select o.date, o.close
       from public.daily_ohlcv o
       join public.assets a on a.id = o.asset_id
      where a.ticker = $1
      order by o.date asc`,
    [ticker],
  );
  return rows.map((b) => ({ date: String(b.date).slice(0, 10), value: Number(b.close) }));
}

/** Macro lead/lag matrix scoped to the market's representative sector. */
export async function getMacroMatrix(market: MarketId): Promise<MacroMatrix | null> {
  const macro = await query<{ indicator_type: string; date: string; value: string | number }>(
    "select indicator_type, date, value from public.macro_indicators order by date asc",
  );
  if (macro.length === 0) return null;

  const indicatorMap = new Map<string, SeriesInput>();
  for (const m of macro) {
    if (!indicatorMap.has(m.indicator_type)) indicatorMap.set(m.indicator_type, { key: m.indicator_type, points: [] });
    indicatorMap.get(m.indicator_type)!.points.push({ date: String(m.date).slice(0, 10), value: Number(m.value) });
  }

  const sectorTicker = market === "US" ? "NVDA" : "RELIANCE";
  const sectorLabel = market === "US" ? "US_TECH" : "IN_LARGECAP";
  const points = await tickerCloseSeries(sectorTicker);
  if (points.length === 0) return null;

  return buildMacroMatrix([...indicatorMap.values()], [{ key: sectorLabel, points }]);
}
