"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { query, queryOne, tx } from "@/lib/db";

function revalidateTerminals() {
  revalidatePath("/terminal/us");
  revalidatePath("/terminal/in");
}

/** Ensure the signed-in user has a default portfolio + watchlist; return ids. */
export async function ensureScaffold(): Promise<{
  userId: string;
  portfolioId: string;
  watchlistId: string;
} | null> {
  const user = await getSessionUser();
  if (!user) return null;

  let portfolio = await queryOne<{ id: string }>(
    "select id from public.portfolios where user_id = $1 limit 1",
    [user.id],
  );
  if (!portfolio) {
    portfolio = await queryOne<{ id: string }>(
      "insert into public.portfolios (user_id, name) values ($1, 'My Portfolio') returning id",
      [user.id],
    );
  }

  let watchlist = await queryOne<{ id: string }>(
    "select id from public.watchlists where user_id = $1 limit 1",
    [user.id],
  );
  if (!watchlist) {
    watchlist = await queryOne<{ id: string }>(
      "insert into public.watchlists (user_id, name) values ($1, 'My Watchlist') returning id",
      [user.id],
    );
  }

  if (!portfolio || !watchlist) return null;
  return { userId: user.id, portfolioId: portfolio.id, watchlistId: watchlist.id };
}

export async function addToWatchlist(formData: FormData): Promise<void> {
  const assetId = String(formData.get("assetId") ?? "");
  if (!assetId) return;
  const scaffold = await ensureScaffold();
  if (!scaffold) return;
  await query(
    `insert into public.watchlist_items (user_id, watchlist_id, asset_id)
     values ($1, $2, $3) on conflict do nothing`,
    [scaffold.userId, scaffold.watchlistId, assetId],
  );
  revalidateTerminals();
}

export async function removeWatchlistItem(formData: FormData): Promise<void> {
  const id = String(formData.get("itemId") ?? "");
  if (!id) return;
  const user = await getSessionUser();
  if (!user) return;
  // Scope by user_id (no RLS) so one user can't delete another's item.
  await query("delete from public.watchlist_items where id = $1 and user_id = $2", [id, user.id]);
  revalidateTerminals();
}

/**
 * Record a buy/sell: append to the transactions ledger and recompute the
 * holding's quantity + weighted-average cost, atomically.
 */
export async function recordTrade(formData: FormData): Promise<void> {
  const assetId = String(formData.get("assetId") ?? "");
  const side = String(formData.get("side") ?? "buy");
  const quantity = Number(formData.get("quantity"));
  const price = Number(formData.get("price"));
  if (side !== "buy" && side !== "sell") return;
  if (!assetId || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price < 0)
    return;

  const scaffold = await ensureScaffold();
  if (!scaffold) return;
  const { userId, portfolioId } = scaffold;

  await tx(async (c) => {
    await c.query(
      `insert into public.transactions (user_id, portfolio_id, asset_id, side, quantity, price)
       values ($1, $2, $3, $4, $5, $6)`,
      [userId, portfolioId, assetId, side, quantity, price],
    );

    const existing = (
      await c.query<{ id: string; quantity: string; avg_cost: string | null }>(
        "select id, quantity, avg_cost from public.holdings where portfolio_id = $1 and asset_id = $2",
        [portfolioId, assetId],
      )
    ).rows[0];

    if (side === "buy") {
      if (existing) {
        const oldQty = Number(existing.quantity);
        const oldAvg = Number(existing.avg_cost ?? 0);
        const newQty = oldQty + quantity;
        const newAvg = newQty === 0 ? 0 : (oldQty * oldAvg + quantity * price) / newQty;
        await c.query(
          "update public.holdings set quantity = $1, avg_cost = $2, updated_at = now() where id = $3",
          [newQty, newAvg, existing.id],
        );
      } else {
        await c.query(
          `insert into public.holdings (user_id, portfolio_id, asset_id, quantity, avg_cost)
           values ($1, $2, $3, $4, $5)`,
          [userId, portfolioId, assetId, quantity, price],
        );
      }
    } else if (existing) {
      const newQty = Number(existing.quantity) - quantity;
      if (newQty <= 0) {
        await c.query("delete from public.holdings where id = $1", [existing.id]);
      } else {
        await c.query(
          "update public.holdings set quantity = $1, updated_at = now() where id = $2",
          [newQty, existing.id],
        );
      }
    }
  });

  revalidateTerminals();
}
