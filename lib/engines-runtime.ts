// Server-side glue: pull market data out of Supabase and run the analytical
// engines, scoped to a single market (US or India). Executes on the server with
// the user's RLS-scoped client; market/reference tables are public-read.

import type { SupabaseClient } from "@supabase/supabase-js";
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

type DB = SupabaseClient;

export interface TopSetup {
  ticker: string;
  verdict: string;
  score: number;
  reason: string;
  entry: number | null;
  target: number | null;
  stopLoss: number | null;
}

/** Top active swing setups for a market, read from the precomputed table. */
export async function getTopSwingSetups(
  supabase: DB,
  country: string,
  limit = 6,
): Promise<TopSetup[]> {
  const { data } = await supabase
    .from("swing_signals")
    .select("ticker,verdict,score,reason,entry_price,target_price,stop_loss")
    .eq("country", country)
    .neq("verdict", "NO_SETUP")
    .order("score", { ascending: false })
    .limit(limit);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ticker: r.ticker as string,
    verdict: r.verdict as string,
    score: Number(r.score),
    reason: (r.reason as string) ?? "",
    entry: r.entry_price === null ? null : Number(r.entry_price),
    target: r.target_price === null ? null : Number(r.target_price),
    stopLoss: r.stop_loss === null ? null : Number(r.stop_loss),
  }));
}

/** Look-through fund overlap. Indian mutual-fund data, so India-only. */
export async function getFundOverlap(supabase: DB): Promise<OverlapReport | null> {
  const { data: mfh } = await supabase
    .from("mutual_fund_holdings")
    .select("fund_asset_id,stock_asset_id,weight_percentage");
  if (!mfh || mfh.length === 0) return null;

  // Resolve only the ids we need (avoids the 1k-row cap over the 17k catalog).
  const ids = [
    ...new Set(
      (mfh as Record<string, unknown>[]).flatMap((r) => [
        r.fund_asset_id as string,
        r.stock_asset_id as string,
      ]),
    ),
  ];
  const { data: assets } = await supabase
    .from("assets")
    .select("id,ticker")
    .in("id", ids);
  const idToTicker = new Map<string, string>(
    ((assets ?? []) as { id: string; ticker: string }[]).map((a) => [a.id, a.ticker]),
  );

  const lookThrough: FundStockWeight[] = (mfh as Record<string, unknown>[])
    .map((r) => ({
      fundTicker: idToTicker.get(r.fund_asset_id as string) ?? "",
      stockTicker: idToTicker.get(r.stock_asset_id as string) ?? "",
      weightPercentage: Number(r.weight_percentage),
    }))
    .filter((r) => r.fundTicker && r.stockTicker);

  const { data: meta } = await supabase
    .from("mutual_fund_meta")
    .select("asset_id,expense_ratio,plan_type");
  const metaList = ((meta ?? []) as Record<string, unknown>[]).map((m) => ({
    ticker: idToTicker.get(m.asset_id as string) ?? "",
    expenseRatio: m.expense_ratio === null ? undefined : Number(m.expense_ratio),
    planType: (m.plan_type as "DIRECT" | "REGULAR") ?? undefined,
  }));
  const metaByTicker = new Map(metaList.map((m) => [m.ticker, m]));

  const fundTickers = [...new Set(lookThrough.map((l) => l.fundTicker))];
  const sampleNav: Record<string, number> = { IGBLUE: 95.2, IGFLEXI: 210.4 };
  const portfolio: UserFundHolding[] = fundTickers.map((t, i) => ({
    fundTicker: t,
    units: 1000 - i * 400,
    navValue: sampleNav[t] ?? 100,
    planType: metaByTicker.get(t)?.planType,
  }));

  return analyzeFundOverlap(portfolio, lookThrough, metaList);
}

/** OHLCV close series for one ticker (used as a sector proxy). */
async function tickerCloseSeries(
  supabase: DB,
  ticker: string,
): Promise<{ date: string; value: number }[]> {
  const { data: asset } = await supabase
    .from("assets")
    .select("id")
    .eq("ticker", ticker)
    .limit(1)
    .maybeSingle();
  if (!asset) return [];
  const { data: bars } = await supabase
    .from("daily_ohlcv")
    .select("date,close")
    .eq("asset_id", (asset as { id: string }).id)
    .order("date", { ascending: true });
  return ((bars ?? []) as Record<string, unknown>[]).map((b) => ({
    date: b.date as string,
    value: Number(b.close),
  }));
}

/** Macro lead/lag matrix scoped to the market's representative sector. */
export async function getMacroMatrix(
  supabase: DB,
  market: MarketId,
): Promise<MacroMatrix | null> {
  const { data: macro } = await supabase
    .from("macro_indicators")
    .select("indicator_type,date,value")
    .order("date", { ascending: true });
  if (!macro || macro.length === 0) return null;

  const indicatorMap = new Map<string, SeriesInput>();
  for (const m of macro as Record<string, unknown>[]) {
    const key = m.indicator_type as string;
    if (!indicatorMap.has(key)) indicatorMap.set(key, { key, points: [] });
    indicatorMap.get(key)!.points.push({ date: m.date as string, value: Number(m.value) });
  }

  const sectorTicker = market === "US" ? "NVDA" : "RELIANCE";
  const sectorLabel = market === "US" ? "US_TECH" : "IN_LARGECAP";
  const points = await tickerCloseSeries(supabase, sectorTicker);
  if (points.length === 0) return null;

  return buildMacroMatrix([...indicatorMap.values()], [{ key: sectorLabel, points }]);
}
