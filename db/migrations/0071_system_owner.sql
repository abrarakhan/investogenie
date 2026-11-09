-- The canonical system owner, distinct from the ADMIN permission. Shared
-- sources (cron news/AI fallbacks, SMTP, the Breeze market-data session) are
-- read from exactly this account, so promoting another ADMIN can never
-- silently switch them. At most one owner (unique partial index); the owner
-- must be an ADMIN. Set only by scripts/bootstrap-admin.mjs from
-- DEFAULT_USER_EMAIL. Idempotent: deploys reapply it.
alter table public.users
  add column if not exists is_system_owner boolean not null default false;

create unique index if not exists users_single_system_owner_idx
  on public.users ((true)) where is_system_owner;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.users'::regclass and conname = 'users_system_owner_is_admin_check'
  ) then
    alter table public.users
      add constraint users_system_owner_is_admin_check check (not is_system_owner or role = 'ADMIN');
  end if;
end $$;
