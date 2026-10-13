-- Immutable server-held plans for Strong Swing and Momentum Ignition purchases.
create table if not exists public.swing_execution_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  market text not null check (market in ('IN','US')),
  strategy_key text not null check (strategy_key in ('STRONG_SWING','MOMENTUM_IGNITION')),
  status text not null,
  session_date date not null,
  plan_hash text not null check (plan_hash ~ '^[0-9a-f]{64}$'),
  captured_at timestamptz not null default now(),
  entry_price numeric(20,6) not null check (entry_price > 0),
  projected_target numeric(20,6) not null,
  projected_stop numeric(20,6) not null check (projected_stop >= 0),
  projected_trailing_stop numeric(20,6),
  projected_atr numeric(20,6) not null,
  trailing_distance numeric(20,6),
  expected_holding_days integer not null check (expected_holding_days between 1 and 365),
  signal_as_of date not null,
  signal_score numeric(8,6),
  snapshot jsonb not null default '{}'::jsonb,
  check (projected_target > entry_price),
  check (projected_stop < entry_price),
  unique (user_id, asset_id, strategy_key, plan_hash)
);

create index if not exists swing_execution_plans_user_asset_idx
  on public.swing_execution_plans(user_id, asset_id, strategy_key, captured_at desc);

create or replace function public.swing_execution_plans_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'swing_execution_plans rows are immutable; insert a new version instead';
end;
$$;

drop trigger if exists swing_execution_plans_no_update on public.swing_execution_plans;
create trigger swing_execution_plans_no_update
  before update on public.swing_execution_plans
  for each row execute function public.swing_execution_plans_immutable();
