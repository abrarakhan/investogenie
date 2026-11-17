-- Carry the point-in-time mid-way evidence into the current screener read model.
-- Migration 0084 added the historical columns, but the web screener reads
-- stock_snapshot; omitting these columns makes every screener request fail.
alter table public.stock_snapshot
  add column if not exists deliv_pct numeric(5,2),
  add column if not exists rel_deliv_20d numeric(8,2),
  add column if not exists nifty_alpha_1d numeric(6,2),
  add column if not exists ibs_close numeric(5,4),
  add column if not exists tod_rvol numeric(8,2),
  add column if not exists days_since_results integer,
  add column if not exists setup_variant text,
  add column if not exists catalyst_tag text;
