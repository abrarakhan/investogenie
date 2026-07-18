-- User-scoped mutual fund look-through uploads.
--
-- public.mutual_fund_holdings remains the global/seed/provider table. User-
-- uploaded AMC monthly portfolio disclosures belong here so one user's import
-- cannot overwrite another user's Fund Overlap X-Ray.

create table if not exists public.user_mutual_fund_holdings (
  user_id            uuid not null references public.users (id) on delete cascade,
  fund_asset_id      uuid not null references public.assets (id) on delete cascade,
  stock_asset_id     uuid not null references public.assets (id) on delete cascade,
  weight_percentage  numeric(7, 4) not null check (weight_percentage >= 0 and weight_percentage <= 100),
  as_of_date         date,
  imported_at        timestamptz not null default now(),
  source             text not null default 'AMC_DISCLOSURE',
  primary key (user_id, fund_asset_id, stock_asset_id)
);

create index if not exists user_mf_holdings_user_fund_idx
  on public.user_mutual_fund_holdings (user_id, fund_asset_id);

create index if not exists user_mf_holdings_stock_idx
  on public.user_mutual_fund_holdings (stock_asset_id);
