"use server";

import { getSessionUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { ensureScaffold } from "@/app/dashboard/actions";
import type { Filter, SortSpec } from "@/lib/screener/filterEngine";

/** Add an asset to the user's default watchlist by id (screener row action). */
export async function addToWatchlistById(assetId: string): Promise<{ ok: boolean }> {
  if (!assetId) return { ok: false };
  const scaffold = await ensureScaffold();
  if (!scaffold) return { ok: false };
  await query(
    `insert into public.watchlist_items (user_id, watchlist_id, asset_id)
     values ($1, $2, $3) on conflict do nothing`,
    [scaffold.userId, scaffold.watchlistId, assetId],
  );
  return { ok: true };
}

export interface SavedScreen {
  id: string;
  name: string;
  market: string;
  universe: string;
  filters: Filter[];
  sort: SortSpec | null;
  columns: string[] | null;
  valueBelowSectorMedian?: boolean;
}

interface SavePayload {
  name: string;
  market: string;
  universe: string;
  filters: Filter[];
  sort: SortSpec | null;
  columns: string[] | null;
  valueBelowSectorMedian?: boolean;
}

/** All screens for the signed-in user, newest first. */
export async function listSavedScreens(): Promise<SavedScreen[]> {
  const user = await getSessionUser();
  if (!user) return [];
  const rows = await query<{
    id: string; name: string; market: string; universe: string;
    filters: unknown; sort: unknown; columns: unknown;
  }>(
    `select id, name, market, universe, filters, sort, columns
       from public.saved_screens where user_id = $1 order by updated_at desc`,
    [user.id],
  );
  return rows.map((r) => {
    const filters = (Array.isArray(r.filters) ? r.filters : []) as (Filter & { valueBelowSectorMedian?: boolean })[];
    return {
      id: r.id,
      name: r.name,
      market: r.market,
      universe: r.universe,
      filters: filters as Filter[],
      sort: (r.sort as SortSpec | null) ?? null,
      columns: (r.columns as string[] | null) ?? null,
    };
  });
}

/** Create or overwrite (by name) a saved screen for the current user. */
export async function saveScreen(payload: SavePayload): Promise<SavedScreen[]> {
  const user = await getSessionUser();
  if (!user) throw new Error("Not signed in");
  const name = payload.name.trim().slice(0, 80);
  if (!name) throw new Error("Name required");

  // Stash the value-preset flag inside the sort blob so the schema stays lean.
  const sortBlob = payload.sort
    ? { ...payload.sort, valueBelowSectorMedian: payload.valueBelowSectorMedian || undefined }
    : payload.valueBelowSectorMedian
      ? { valueBelowSectorMedian: true }
      : null;

  await query(
    `insert into public.saved_screens (user_id, name, market, universe, filters, sort, columns, updated_at)
     values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, now())
     on conflict (user_id, name) do update set
       market = excluded.market, universe = excluded.universe,
       filters = excluded.filters, sort = excluded.sort, columns = excluded.columns,
       updated_at = now()`,
    [
      user.id, name, payload.market, payload.universe,
      JSON.stringify(payload.filters ?? []),
      sortBlob ? JSON.stringify(sortBlob) : null,
      payload.columns ? JSON.stringify(payload.columns) : null,
    ],
  );
  return listSavedScreens();
}

export async function renameScreen(id: string, name: string): Promise<SavedScreen[]> {
  const user = await getSessionUser();
  if (!user) throw new Error("Not signed in");
  const clean = name.trim().slice(0, 80);
  if (!clean) throw new Error("Name required");
  await query("update public.saved_screens set name = $1, updated_at = now() where id = $2 and user_id = $3", [clean, id, user.id]);
  return listSavedScreens();
}

export async function deleteScreen(id: string): Promise<SavedScreen[]> {
  const user = await getSessionUser();
  if (!user) throw new Error("Not signed in");
  await query("delete from public.saved_screens where id = $1 and user_id = $2", [id, user.id]);
  return listSavedScreens();
}
