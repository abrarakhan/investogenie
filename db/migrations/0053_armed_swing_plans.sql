-- Server-held, immutable Armed Swing plan versions.
--
-- Every actionable Armed Swing candidate shown to a user is recorded here with the plan the
-- server computed. Order and purchase actions reference a plan by id and the server reads the
-- trigger, limit, stop, target, trail and status from this table, so browser-supplied values
-- can never set or move them. Rows are never updated: each distinct calculation is a new
-- version keyed by a hash of its complete content plus its five-minute capture bucket. An
-- identical recalculation in the same bucket reuses the row; anything else is a new row. A plan
-- id therefore always means exactly the plan the user was shown, and plan freshness (actions
-- require a recent capture) is still measurable from captured_at.
create table if not exists public.armed_swing_plans (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users(id) on delete cascade,
  market            text not null check (market in ('IN', 'US')),
  asset_id          uuid not null references public.assets(id) on delete cascade,
  session_date      date not null,
  bucket_at         timestamptz not null,
  plan_hash         text not null check (plan_hash ~ '^[0-9a-f]{64}$'),
  captured_at       timestamptz not null default now(),
  status            text not null check (status in ('BUY_ZONE', 'TRIGGERED_UNCONFIRMED', 'ARMED')),
  current_price     numeric(20, 6) not null,
  trigger_price     numeric(20, 6) not null check (trigger_price > 0),
  limit_price       numeric(20, 6) not null,
  projected_target  numeric(20, 6) not null,
  projected_stop    numeric(20, 6) not null check (projected_stop >= 0),
  projected_trailing_stop numeric(20, 6),
  projected_atr     numeric(20, 6) not null,
  trailing_distance numeric(20, 6),
  expected_holding_days integer not null check (expected_holding_days between 1 and 365),
  latest_bar_date   date not null,
  strength_score    numeric(6, 2) not null,
  gates             jsonb not null default '[]'::jsonb,
  check (limit_price >= trigger_price),
  check (projected_target > limit_price),
  check (projected_stop < trigger_price),
  unique (user_id, asset_id, plan_hash)
);

-- Enforce immutability in the database, not just in application code.
create or replace function public.armed_swing_plans_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'armed_swing_plans rows are immutable; insert a new plan version instead';
end;
$$;

drop trigger if exists armed_swing_plans_no_update on public.armed_swing_plans;
create trigger armed_swing_plans_no_update
  before update on public.armed_swing_plans
  for each row execute function public.armed_swing_plans_immutable();

create index if not exists armed_swing_plans_user_asset_idx
  on public.armed_swing_plans(user_id, asset_id, captured_at desc);
create index if not exists armed_swing_plans_market_time_idx
  on public.armed_swing_plans(market, captured_at desc);
