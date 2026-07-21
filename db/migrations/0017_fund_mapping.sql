-- Explicit user fund -> AMC disclosure scheme mappings.
-- This replaces the previous implicit fund_schemes.asset_id join used by the
-- Fund X-Ray, while keeping imported CAS holdings and loaded AMC snapshots
-- separate and auditable.

create table if not exists public.user_fund_mappings (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users (id) on delete cascade,
  user_holding_id uuid not null references public.holdings (id) on delete cascade,
  scheme_code     text references public.fund_schemes (scheme_code) on delete set null,
  status          text not null check (status in ('matched', 'rejected')),
  match_method    text not null default 'manual',
  confidence      numeric(5,4),
  matched_at      timestamptz,
  matched_by      uuid references public.users (id) on delete set null,
  rejected_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint user_fund_mappings_status_shape check (
    (status = 'matched' and scheme_code is not null and matched_at is not null)
    or status = 'rejected'
  ),
  unique (user_id, user_holding_id)
);

create index if not exists user_fund_mappings_user_status_idx
  on public.user_fund_mappings (user_id, status);

create index if not exists user_fund_mappings_scheme_idx
  on public.user_fund_mappings (scheme_code);

-- Backfill mappings from legacy AMC imports that linked fund_schemes.asset_id
-- directly to a held CAS fund asset. If multiple snapshots exist for the same
-- holding, keep the most recent one.
insert into public.user_fund_mappings (
  user_id,
  user_holding_id,
  scheme_code,
  status,
  match_method,
  confidence,
  matched_at,
  matched_by
)
select distinct on (h.user_id, h.id)
       h.user_id,
       h.id,
       fs.scheme_code,
       'matched',
       'legacy_asset_link',
       1.0000,
       now(),
       h.user_id
  from public.holdings h
  join public.assets a on a.id = h.asset_id and a.asset_class = 'MUTUAL_FUND'
  join public.fund_schemes fs on fs.asset_id = h.asset_id
 where h.quantity > 0
 order by h.user_id, h.id, fs.latest_month desc nulls last, fs.created_at desc
on conflict (user_id, user_holding_id) do nothing;
