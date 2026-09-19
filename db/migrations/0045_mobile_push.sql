create table if not exists public.mobile_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  mobile_session_id uuid references public.mobile_sessions(id) on delete set null,
  expo_push_token text not null unique,
  platform text not null check (platform in ('android', 'ios')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists mobile_push_tokens_user_enabled_idx
  on public.mobile_push_tokens(user_id) where enabled;

create table if not exists public.mobile_trade_alert_state (
  user_id uuid not null references public.users(id) on delete cascade,
  trade_id uuid not null references public.swing_trade_ledger(id) on delete cascade,
  market text not null check (market in ('IN', 'US')),
  last_signature text not null,
  last_recommendation text not null,
  last_sent_at timestamptz not null default now(),
  primary key (user_id, trade_id)
);

create table if not exists public.mobile_notification_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  trade_id uuid references public.swing_trade_ledger(id) on delete set null,
  market text not null check (market in ('IN', 'US')),
  recommendation text not null,
  signature text not null,
  quote_updated_at timestamptz,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists mobile_notification_log_user_created_idx
  on public.mobile_notification_log(user_id, created_at desc);
