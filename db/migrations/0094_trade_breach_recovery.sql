-- Phase 1: Trade Breach Audit History & Persisted Recovery Context
-- Keeps original frozen trade plan, verified first stop-breach history,
-- and separate recovery context strictly decoupled.

alter table public.swing_trade_ledger
  add column if not exists first_stop_breached_at timestamptz,
  add column if not exists first_stop_breach_price numeric,
  add column if not exists first_stop_breach_source text;

create table if not exists public.swing_trade_recovery_state (
  trade_id uuid primary key references public.swing_trade_ledger(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  market text not null check (market in ('IN', 'US')),
  asset_id uuid not null references public.assets(id) on delete cascade,
  recovery_status text not null check (recovery_status in ('NONE', 'REBOUND_DETECTED', 'STOP_RECLAIMED', 'UNVERIFIED')),
  headline text,
  move_2d_pct numeric,
  volume_pace numeric,
  relative_strength_20d numeric,
  sector_thrust_group text,
  related_news jsonb not null default '[]'::jsonb,
  quote_price numeric,
  quote_source text,
  quote_at timestamptz,
  first_detected_at timestamptz,
  evaluated_at timestamptz not null default now()
);

create index if not exists swing_trade_recovery_state_user_market_idx
  on public.swing_trade_recovery_state (user_id, market, evaluated_at desc);

alter table public.swing_trade_recovery_state enable row level security;
alter table public.swing_trade_recovery_state force row level security;

drop policy if exists swing_trade_recovery_state_tenant_isolation on public.swing_trade_recovery_state;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'investogenie_web') then
    execute 'grant select, insert, update, delete on public.swing_trade_recovery_state to investogenie_web';
    execute 'create policy swing_trade_recovery_state_tenant_isolation
      on public.swing_trade_recovery_state
      for all to investogenie_web
      using (user_id = nullif(current_setting(''app.current_user_id'', true), '''')::uuid)
      with check (user_id = nullif(current_setting(''app.current_user_id'', true), '''')::uuid)';
  else
    execute 'create policy swing_trade_recovery_state_tenant_isolation
      on public.swing_trade_recovery_state
      for all
      using (user_id = nullif(current_setting(''app.current_user_id'', true), '''')::uuid)
      with check (user_id = nullif(current_setting(''app.current_user_id'', true), '''')::uuid)';
  end if;
end
$$;
