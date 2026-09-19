create table if not exists public.mobile_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token_hash text not null unique,
  device_name text not null default 'InvestoGenie mobile',
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create index if not exists mobile_sessions_user_active_idx
  on public.mobile_sessions(user_id, expires_at desc)
  where revoked_at is null;

