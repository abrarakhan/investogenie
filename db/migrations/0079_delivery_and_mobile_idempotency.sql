-- Durable deduplication for external email delivery and mobile mutations.

create table if not exists public.email_digest_deliveries (
  user_id uuid not null references public.users(id) on delete cascade,
  market_date date not null,
  status text not null check (status in ('PROCESSING','SENT','FAILED')),
  claimed_at timestamptz not null default now(),
  completed_at timestamptz,
  error text,
  primary key (user_id, market_date)
);

create table if not exists public.mobile_mutation_idempotency (
  user_id uuid not null references public.users(id) on delete cascade,
  idempotency_key uuid not null,
  operation text not null,
  request_hash text not null,
  status text not null check (status in ('PROCESSING','COMPLETED')),
  response_status integer,
  response_body jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (user_id, idempotency_key)
);

create index if not exists mobile_mutation_idempotency_created_idx
  on public.mobile_mutation_idempotency(created_at);

comment on table public.email_digest_deliveries is
  'One durable daily-digest claim per user and India market date; prevents cron retries from sending duplicates.';
comment on table public.mobile_mutation_idempotency is
  'Durable response ledger for authenticated mobile mutations retried with the same UUID key.';
