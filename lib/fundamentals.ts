// Read-side helper: fetch the latest quarterly fundamentals snapshot for a set
// of asset ids → Map<assetId, FinancialSnapshot>. Reads the latest_financials
// view (one row per asset) and chunks the id filter like getQuotesByAssetIds.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FinancialSnapshot } from "@/lib/types";

const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

export async function getFundamentalsByAssetIds(
  supabase: SupabaseClient,
  ids: string[],
): Promise<Map<string, FinancialSnapshot>> {
  const map = new Map<string, FinancialSnapshot>();
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return map;

  const CHUNK = 100; // keep the in(...) URI under the local Kong gateway limit
  for (let i = 0; i < unique.length; i += CHUNK) {
    const slice = unique.slice(i, i + CHUNK);
    const { data } = await supabase
      .from("latest_financials")
      .select(
        "asset_id,period_end_date,fiscal_period,pe_ratio,market_cap,roce,profit_variance_yoy,sales_variance_yoy,revenue,net_profit",
      )
      .in("asset_id", slice);
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      map.set(r.asset_id as string, {
        periodEndDate: (r.period_end_date as string) ?? "",
        fiscalPeriod: (r.fiscal_period as string) ?? null,
        peRatio: numOrNull(r.pe_ratio),
        marketCap: numOrNull(r.market_cap),
        roce: numOrNull(r.roce),
        profitVarianceYoY: numOrNull(r.profit_variance_yoy),
        salesVarianceYoY: numOrNull(r.sales_variance_yoy),
        revenue: numOrNull(r.revenue),
        netProfit: numOrNull(r.net_profit),
      });
    }
  }
  return map;
}
