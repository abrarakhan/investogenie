-- Authorization roles. Every account is an ordinary USER unless explicitly
-- promoted. The owner is promoted by scripts/bootstrap-admin.mjs from
-- DEFAULT_USER_EMAIL during deployment (SQL cannot read the environment), and
-- that script never guesses an account. Idempotent: deploys reapply it.
alter table public.users
  add column if not exists role text not null default 'USER';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.users'::regclass and conname = 'users_role_check'
  ) then
    alter table public.users
      add constraint users_role_check check (role in ('USER', 'ADMIN'));
  end if;
end $$;
