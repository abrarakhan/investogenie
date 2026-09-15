import { query } from "@/lib/db";

export type LiveMarketSurface = "swing" | "strong_swing" | "news_swing" | "trade_ledger";

export async function markLiveMarketTargets(
  assetIds: ReadonlyArray<string>,
  surface: LiveMarketSurface,
): Promise<void> {
  const ids = [...new Set(assetIds.filter(Boolean))];
  if (!ids.length) return;
  await query(
    `insert into public.live_market_targets (asset_id,surface,last_seen_at)
     select unnest($1::uuid[]),$2,now()
     on conflict (asset_id,surface) do update set last_seen_at=excluded.last_seen_at`,
    [ids, surface],
  );
}

