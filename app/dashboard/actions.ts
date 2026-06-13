"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

async function client() {
  return createClient(await cookies());
}

/** Ensure the signed-in user has a default portfolio + watchlist; return ids. */
export async function ensureScaffold(): Promise<{
  userId: string;
  portfolioId: string;
  watchlistId: string;
} | null> {
  const supabase = await client();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  let { data: portfolio } = await supabase
    .from("portfolios")
    .select("id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (!portfolio) {
    const { data } = await supabase
      .from("portfolios")
      .insert({ user_id: user.id, name: "My Portfolio" })
      .select("id")
      .single();
    portfolio = data;
  }

  let { data: watchlist } = await supabase
    .from("watchlists")
    .select("id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (!watchlist) {
    const { data } = await supabase
      .from("watchlists")
      .insert({ user_id: user.id, name: "My Watchlist" })
      .select("id")
      .single();
    watchlist = data;
  }

  if (!portfolio || !watchlist) return null;
  return { userId: user.id, portfolioId: portfolio.id, watchlistId: watchlist.id };
}

export async function addToWatchlist(formData: FormData): Promise<void> {
  const assetId = String(formData.get("assetId") ?? "");
  if (!assetId) return;
  const scaffold = await ensureScaffold();
  if (!scaffold) return;
  const supabase = await client();
  await supabase.from("watchlist_items").insert({
    user_id: scaffold.userId,
    watchlist_id: scaffold.watchlistId,
    asset_id: assetId,
  }); // unique(watchlist_id, asset_id) makes re-adds a no-op error we ignore
  revalidatePath("/dashboard");
}

export async function removeWatchlistItem(formData: FormData): Promise<void> {
  const id = String(formData.get("itemId") ?? "");
  if (!id) return;
  const supabase = await client();
  await supabase.from("watchlist_items").delete().eq("id", id);
  revalidatePath("/dashboard");
}

/**
 * Record a buy/sell: append to the transactions ledger, then recompute the
 * holding's quantity and weighted-average cost.
 */
export async function recordTrade(formData: FormData): Promise<void> {
  const assetId = String(formData.get("assetId") ?? "");
  const side = String(formData.get("side") ?? "buy") as "buy" | "sell";
  const quantity = Number(formData.get("quantity"));
  const price = Number(formData.get("price"));
  if (!assetId || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price))
    return;

  const scaffold = await ensureScaffold();
  if (!scaffold) return;
  const supabase = await client();
  const { userId, portfolioId } = scaffold;

  await supabase.from("transactions").insert({
    user_id: userId,
    portfolio_id: portfolioId,
    asset_id: assetId,
    side,
    quantity,
    price,
  });

  const { data: existing } = await supabase
    .from("holdings")
    .select("id, quantity, avg_cost")
    .eq("portfolio_id", portfolioId)
    .eq("asset_id", assetId)
    .maybeSingle();

  if (side === "buy") {
    if (existing) {
      const oldQty = Number(existing.quantity);
      const oldAvg = Number(existing.avg_cost ?? 0);
      const newQty = oldQty + quantity;
      const newAvg = newQty === 0 ? 0 : (oldQty * oldAvg + quantity * price) / newQty;
      await supabase
        .from("holdings")
        .update({ quantity: newQty, avg_cost: newAvg, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
    } else {
      await supabase.from("holdings").insert({
        user_id: userId,
        portfolio_id: portfolioId,
        asset_id: assetId,
        quantity,
        avg_cost: price,
      });
    }
  } else {
    // sell: reduce quantity; remove the lot if it goes flat. Avg cost unchanged.
    if (existing) {
      const newQty = Number(existing.quantity) - quantity;
      if (newQty <= 0) {
        await supabase.from("holdings").delete().eq("id", existing.id);
      } else {
        await supabase
          .from("holdings")
          .update({ quantity: newQty, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
      }
    }
  }

  revalidatePath("/dashboard");
}
