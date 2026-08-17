-- Emailed password-reset tokens.
--
-- Only the SHA-256 of the token is stored, never the token itself: the value that arrives in
-- the user's inbox is the sole copy, so a leak of this table cannot be replayed to seize an
-- account. Tokens are single-use and short-lived, and requesting a new one retires any
-- outstanding ones for that account.

create table if not exists public.password_reset_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

-- Serves both the "retire outstanding tokens" update and the per-hour request throttle.
create index if not exists password_reset_tokens_user_created_idx
  on public.password_reset_tokens (user_id, created_at desc);

-- Lookup on redemption is by hash.
create index if not exists password_reset_tokens_hash_idx
  on public.password_reset_tokens (token_hash);
