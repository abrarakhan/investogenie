// Latest-quarter fundamentals snapshot by asset id → Map, via direct SQL.
import { query } from "@/lib/db";
import type { FinancialSnapshot } from "@/lib/types";

interface Row {
  asset_id: string;
  period_end_date: string | Date | null;
  fiscal_period: string | null;
  pe_ratio: string | number | null;
  market_cap: string | number | null;
  roce: string | number | null;
  profit_variance_yoy: string | number | null;
  sales_variance_yoy: string | number | null;
  revenue: string | number | null;
  net_profit: string | number | null;
}

const n = (v: string | number | null): number | null =>
  v === null || v === undefined ? null : Number(v);

const isoDate = (value: string | Date | null): string => {
  if (!value) return "";
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
};

export async function getFundamentalsByAssetIds(
  ids: string[],
): Promise<Map<string, FinancialSnapshot>> {
  const map = new Map<string, FinancialSnapshot>();
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return map;

  const rows = await query<Row>(
    `select asset_id, period_end_date, fiscal_period, pe_ratio, market_cap, roce,
            profit_variance_yoy, sales_variance_yoy, revenue, net_profit
       from public.latest_financials
      where asset_id = any($1)`,
    [unique],
  );
  for (const r of rows) {
    map.set(r.asset_id, {
      periodEndDate: isoDate(r.period_end_date),
      fiscalPeriod: r.fiscal_period ?? null,
      peRatio: n(r.pe_ratio),
      marketCap: n(r.market_cap),
      roce: n(r.roce),
      profitVarianceYoY: n(r.profit_variance_yoy),
      salesVarianceYoY: n(r.sales_variance_yoy),
      revenue: n(r.revenue),
      netProfit: n(r.net_profit),
    });
  }
  return map;
}
