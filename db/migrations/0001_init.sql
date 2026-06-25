-- InvestoGenie initial schema
-- Full stocks portal: reference stocks + per-user watchlists, portfolios,
-- holdings, and transactions using local application-managed users.

-- Required for gen_random_uuid()
create extension if not exists pgcrypto;

create table if not exists public.users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  password_hash text not null,
  created_at    timestamptz not null default now()
);

-- =========================================================================
-- Reference data: shared catalog of tradable stocks (not user-owned)
-- =========================================================================
create table if not exists public.stocks (
  id          uuid primary key default gen_random_uuid(),
  symbol      text not null unique,
  name        text,
  exchange    text,
  currency    text not null default 'USD',
  sector      text,
  created_at  timestamptz not null default now()
);

-- =========================================================================
-- Per-user: portfolios
-- =========================================================================
create table if not exists public.portfolios (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,
  name        text not null default 'My Portfolio',
  created_at  timestamptz not null default now()
);
create index if not exists portfolios_user_id_idx on public.portfolios (user_id);

-- =========================================================================
-- Per-user: holdings (current positions within a portfolio)
-- =========================================================================
create table if not exists public.holdings (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users (id) on delete cascade,
  portfolio_id  uuid not null references public.portfolios (id) on delete cascade,
  stock_id      uuid not null references public.stocks (id) on delete restrict,
  quantity      numeric(20, 6) not null default 0,
  avg_cost      numeric(20, 6),
  updated_at    timestamptz not null default now(),
  unique (portfolio_id, stock_id)
);
create index if not exists holdings_user_id_idx on public.holdings (user_id);
create index if not exists holdings_portfolio_id_idx on public.holdings (portfolio_id);

-- =========================================================================
-- Per-user: transactions (buy/sell ledger)
-- =========================================================================
create table if not exists public.transactions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users (id) on delete cascade,
  portfolio_id  uuid not null references public.portfolios (id) on delete cascade,
  stock_id      uuid not null references public.stocks (id) on delete restrict,
  side          text not null check (side in ('buy', 'sell')),
  quantity      numeric(20, 6) not null check (quantity > 0),
  price         numeric(20, 6) not null check (price >= 0),
  executed_at   timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
create index if not exists transactions_user_id_idx on public.transactions (user_id);
create index if not exists transactions_portfolio_id_idx on public.transactions (portfolio_id);

-- =========================================================================
-- Per-user: watchlists + items
-- =========================================================================
create table if not exists public.watchlists (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,
  name        text not null default 'My Watchlist',
  created_at  timestamptz not null default now()
);
create index if not exists watchlists_user_id_idx on public.watchlists (user_id);

create table if not exists public.watchlist_items (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users (id) on delete cascade,
  watchlist_id  uuid not null references public.watchlists (id) on delete cascade,
  stock_id      uuid not null references public.stocks (id) on delete cascade,
  created_at    timestamptz not null default now(),
  unique (watchlist_id, stock_id)
);
create index if not exists watchlist_items_user_id_idx on public.watchlist_items (user_id);

-- =========================================================================
-- Seed a few well-known stocks into the shared catalog
-- =========================================================================
insert into public.stocks (symbol, name, exchange, currency, sector) values
  ('AAPL',  'Apple Inc.',            'NASDAQ', 'USD', 'Technology'),
  ('MSFT',  'Microsoft Corporation', 'NASDAQ', 'USD', 'Technology'),
  ('GOOGL', 'Alphabet Inc.',         'NASDAQ', 'USD', 'Communication Services'),
  ('AMZN',  'Amazon.com, Inc.',      'NASDAQ', 'USD', 'Consumer Discretionary'),
  ('TSLA',  'Tesla, Inc.',           'NASDAQ', 'USD', 'Consumer Discretionary'),
  ('NVDA',  'NVIDIA Corporation',    'NASDAQ', 'USD', 'Technology')
on conflict (symbol) do nothing;
