// Latest quotes by asset id → Map<assetId, Quote>, via direct SQL.
import { query } from "@/lib/db";

export interface Quote {
  price: number;
  changePct: number | null;
  currency: string | null;
  asOf: string | null;
}

interface Row {
  asset_id: string;
  price: string | number;
  change_pct: string | number | null;
  currency: string | null;
  as_of: string | null;
}

export async function getQuotesByAssetIds(ids: string[]): Promise<Map<string, Quote>> {
  const map = new Map<string, Quote>();
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return map;

  const rows = await query<Row>(
    "select asset_id, price, change_pct, currency, as_of from public.latest_quotes where asset_id = any($1)",
    [unique],
  );
  for (const q of rows) {
    map.set(q.asset_id, {
      price: Number(q.price),
      changePct: q.change_pct === null ? null : Number(q.change_pct),
      currency: q.currency ?? null,
      asOf: q.as_of ?? null,
    });
  }
  return map;
}
