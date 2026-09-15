-- Read-only ICICI Breeze account snapshots. Broker state is intentionally
-- separate from the user-maintained trade ledger; reconciliation is advisory.
create table if not exists public.breeze_broker_syncs (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  status text not null check (status in ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED')),
  holdings_count integer not null default 0,
  positions_count integer not null default 0,
  orders_count integer not null default 0,
  trades_count integer not null default 0,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists breeze_broker_syncs_user_started_idx
  on public.breeze_broker_syncs (user_id, started_at desc);

create table if not exists public.breeze_broker_snapshots (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  snapshot_type text not null check (snapshot_type in ('FUNDS', 'HOLDING', 'POSITION', 'ORDER', 'TRADE')),
  external_key text not null,
  exchange_code text,
  stock_code text,
  order_id text,
  action text,
  status text,
  quantity numeric,
  average_price numeric,
  market_price numeric,
  amount numeric,
  raw_data jsonb not null,
  captured_at timestamptz not null default now(),
  unique (user_id, snapshot_type, external_key)
);

create index if not exists breeze_broker_snapshots_user_type_idx
  on public.breeze_broker_snapshots (user_id, snapshot_type, captured_at desc);
create index if not exists breeze_broker_snapshots_stock_idx
  on public.breeze_broker_snapshots (user_id, upper(stock_code))
  where stock_code is not null;

create table if not exists public.breeze_instrument_map (
  asset_id uuid primary key references public.assets(id) on delete cascade,
  exchange_code text not null,
  stock_code text not null,
  token text not null,
  updated_at timestamptz not null default now(),
  unique (exchange_code, stock_code)
);
