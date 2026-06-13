// Server-side glue: pull market data out of Supabase and run the three
// analytical engines on it. Imported by the dashboard (a Server Component), so
// it executes on the server with the user's RLS-scoped client. Market/reference
// tables are public-read, so these queries succeed for any authenticated user.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  scanSwingUniverse,
  type SwingSignal,
} from "@/lib/analytics/swingClassifier";
import {
  analyzeFundOverlap,
  type OverlapReport,
} from "@/lib/analytics/fundOverlap";
import {
  buildMacroMatrix,
  type MacroMatrix,
  type SeriesInput,
} from "@/lib/analytics/macroCorrelator";
import type { OHLCV, FundStockWeight, UserFundHolding } from "@/lib/types";

// The loose (untyped) client returns `any` rows; keep a thin alias for clarity.
type DB = SupabaseClient;

interface AssetRow {
  id: string;
  ticker: string;
  asset_class: string;
}

async function loadOhlcvByTicker(supabase: DB): Promise<Map<string, OHLCV[]>> {
  const { data: assets } = await supabase
    .from("assets")
    .select("id,ticker,asset_class");
  const idToTicker = new Map<string, string>(
    ((assets ?? []) as AssetRow[]).map((a) => [a.id, a.ticker]),
  );

  const { data: bars } = await supabase
    .from("daily_ohlcv")
    .select("asset_id,date,open,high,low,close,volume,open_interest")
    .order("date", { ascending: true });

  const byTicker = new Map<string, OHLCV[]>();
  for (const b of (bars ?? []) as Record<string, unknown>[]) {
    const ticker = idToTicker.get(b.asset_id as string);
    if (!ticker) continue;
    if (!byTicker.has(ticker)) byTicker.set(ticker, []);
    byTicker.get(ticker)!.push({
      date: b.date as string,
      open: Number(b.open),
      high: Number(b.high),
      low: Number(b.low),
      close: Number(b.close),
      volume: Number(b.volume),
      openInterest: b.open_interest === null ? null : Number(b.open_interest),
    });
  }
  return byTicker;
}

export async function getSwingSignals(
  supabase: DB,
): Promise<{ ticker: string; signal: SwingSignal }[]> {
  const byTicker = await loadOhlcvByTicker(supabase);
  const universe = [...byTicker.entries()].map(([ticker, bars]) => ({ ticker, bars }));
  try {
    return scanSwingUniverse(universe);
  } catch {
    return [];
  }
}

export async function getFundOverlap(supabase: DB): Promise<OverlapReport | null> {
  const { data: assets } = await supabase
    .from("assets")
    .select("id,ticker,asset_class");
  const idToTicker = new Map<string, string>(
    ((assets ?? []) as AssetRow[]).map((a) => [a.id, a.ticker]),
  );

  const { data: mfh } = await supabase
    .from("mutual_fund_holdings")
    .select("fund_asset_id,stock_asset_id,weight_percentage");
  if (!mfh || mfh.length === 0) return null;

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

  // Sample investor portfolio: holds every fund we have look-through for.
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

export async function getMacroMatrix(supabase: DB): Promise<MacroMatrix | null> {
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

  // Use real equity price paths as the "sector" series.
  const byTicker = await loadOhlcvByTicker(supabase);
  const sectors: SeriesInput[] = [];
  const sectorMap: Record<string, string> = { NVDA: "US_TECH", RELIANCE: "IN_LARGECAP" };
  for (const [ticker, label] of Object.entries(sectorMap)) {
    const bars = byTicker.get(ticker);
    if (bars) sectors.push({ key: label, points: bars.map((b) => ({ date: b.date, value: b.close })) });
  }
  if (sectors.length === 0) return null;

  return buildMacroMatrix([...indicatorMap.values()], sectors);
}
