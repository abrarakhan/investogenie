-- Unify the user-owned tables onto the multi-asset `assets` catalog.
-- Migration 0001 pointed holdings/transactions/watchlist_items at a separate
-- `stocks` table; 0002 introduced the canonical `assets` catalog spanning all
-- asset classes. These tables are still empty (no user data yet), so we repoint
-- the foreign keys to `assets`, rename stock_id -> asset_id for clarity, and
-- drop the now-redundant `stocks` table.

-- holdings -----------------------------------------------------------------
alter table public.holdings drop constraint if exists holdings_stock_id_fkey;
alter table public.holdings rename column stock_id to asset_id;
alter table public.holdings
  add constraint holdings_asset_id_fkey
  foreign key (asset_id) references public.assets (id) on delete restrict;

-- transactions -------------------------------------------------------------
alter table public.transactions drop constraint if exists transactions_stock_id_fkey;
alter table public.transactions rename column stock_id to asset_id;
alter table public.transactions
  add constraint transactions_asset_id_fkey
  foreign key (asset_id) references public.assets (id) on delete restrict;

-- watchlist_items ----------------------------------------------------------
alter table public.watchlist_items drop constraint if exists watchlist_items_stock_id_fkey;
alter table public.watchlist_items rename column stock_id to asset_id;
alter table public.watchlist_items
  add constraint watchlist_items_asset_id_fkey
  foreign key (asset_id) references public.assets (id) on delete cascade;

-- Drop the redundant catalog now that nothing references it.
drop table if exists public.stocks;
