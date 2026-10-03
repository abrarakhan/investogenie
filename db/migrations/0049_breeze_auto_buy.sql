create table if not exists public.breeze_auto_buy_settings (
  user_id uuid primary key references public.users(id) on delete cascade,
  enabled boolean not null default false,
  strong_swing_enabled boolean not null default false,
  adaptive_allocation_enabled boolean not null default false,
  daily_budget numeric(20,2) not null default 0 check (daily_budget >= 0),
  max_order_value numeric(20,2) not null default 0 check (max_order_value >= 0),
  max_orders_per_day integer not null default 1 check (max_orders_per_day between 1 and 20),
  limit_buffer_bps numeric(10,4) not null default 10 check (limit_buffer_bps between 0 and 100),
  acknowledged_at timestamptz,
  updated_at timestamptz not null default now(),
  check (not enabled or (acknowledged_at is not null and daily_budget > 0 and max_order_value > 0
    and (strong_swing_enabled or adaptive_allocation_enabled)))
);

create table if not exists public.breeze_order_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  source text not null check (source in ('STRONG_SWING','ADAPTIVE_ALLOCATION')),
  source_ref text not null,
  trade_date date not null,
  asset_id uuid not null references public.assets(id),
  stock_code text not null,
  exchange_code text not null default 'NSE' check (exchange_code='NSE'),
  quantity integer not null check (quantity > 0),
  limit_price numeric(20,4) not null check (limit_price > 0),
  estimated_value numeric(20,2) not null check (estimated_value > 0),
  status text not null check (status in ('PENDING','SUBMITTED','REJECTED','ERROR')),
  broker_order_id text,
  broker_response jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,source,source_ref,trade_date)
);

create index if not exists breeze_order_intents_user_date_idx
  on public.breeze_order_intents(user_id,trade_date,status);

comment on table public.breeze_order_intents is
  'Audited, idempotent NSE cash limit-order requests created only after explicit per-user auto-buy authorization.';

comment on table public.adaptive_allocation_strategies is
  'Saved allocation configurations. Live buy-only funding is possible only when separately authorized in Breeze auto-buy settings.';
