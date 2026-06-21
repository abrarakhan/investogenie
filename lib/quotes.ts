import type { SupabaseClient } from "@supabase/supabase-js";

export interface Quote {
  price: number;
  changePct: number | null;
  currency: string | null;
  asOf: string | null;
}

/** Fetch latest quotes for a set of asset ids → Map<assetId, Quote>. */
export async function getQuotesByAssetIds(
  supabase: SupabaseClient,
  ids: string[],
): Promise<Map<string, Quote>> {
  const map = new Map<string, Quote>();
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return map;

  // Chunk the id list so the `in(...)` filter never blows past URL length limits
  // when the screener passes a couple thousand asset ids. 100 keeps the request
  // URI well under the local Supabase Kong gateway's limit (300 → HTTP 414).
  const CHUNK = 100;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const slice = unique.slice(i, i + CHUNK);
    const { data } = await supabase
      .from("latest_quotes")
      .select("asset_id,price,change_pct,currency,as_of")
      .in("asset_id", slice);
    for (const q of (data ?? []) as Record<string, unknown>[]) {
      map.set(q.asset_id as string, {
        price: Number(q.price),
        changePct: q.change_pct === null ? null : Number(q.change_pct),
        currency: (q.currency as string) ?? null,
        asOf: (q.as_of as string) ?? null,
      });
    }
  }
  return map;
}
