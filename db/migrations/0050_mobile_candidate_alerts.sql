create table if not exists public.mobile_candidate_alert_state (
  user_id uuid not null references public.users(id) on delete cascade,
  market text not null check (market in ('IN', 'US')),
  engine text not null check (engine in ('STRONG_SWING', 'MOMENTUM_IGNITION', 'MOMENTUM_IGNITION_V2')),
  asset_id uuid not null references public.assets(id) on delete cascade,
  last_status text not null,
  was_ready boolean not null default false,
  last_seen_at timestamptz not null default now(),
  last_sent_at timestamptz,
  primary key (user_id, market, engine, asset_id)
);

create index if not exists mobile_candidate_alert_state_user_ready_idx
  on public.mobile_candidate_alert_state(user_id, market, engine) where was_ready;

alter table public.mobile_notification_log
  add column if not exists asset_id uuid references public.assets(id) on delete set null,
  add column if not exists engine text;
