-- One-time, expiring sign-up invitations issued by an admin. Self-service
-- sign-up is otherwise closed. As with password-reset tokens, only the SHA-256
-- of the token is stored. An invitation may be bound to one email address.
-- Idempotent: deploys reapply it.
create table if not exists public.user_invitations (
  id          uuid primary key default gen_random_uuid(),
  token_hash  text not null unique,
  email       text,
  created_by  uuid not null references public.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  used_by     uuid references public.users(id) on delete set null,
  revoked_at  timestamptz,
  constraint user_invitations_expiry_check check (expires_at > created_at)
);

create index if not exists user_invitations_open_idx
  on public.user_invitations (created_at desc)
  where used_at is null and revoked_at is null;
