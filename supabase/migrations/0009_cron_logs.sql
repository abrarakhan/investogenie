-- Persistent cron run log. Scheduled jobs write a row per execution (success or
-- failure) so a serverless invocation that hits a network dropout or a schema
-- validation error leaves a durable trail instead of failing silently.
create table if not exists public.cron_logs (
  id          bigint generated always as identity primary key,
  job         text        not null,          -- 'refresh-quotes' | 'scan' | 'backfill-us'
  status      text        not null,          -- 'ok' | 'error'
  detail      jsonb       not null default '{}'::jsonb,
  error       text,                          -- message when status='error'
  duration_ms integer,
  created_at  timestamptz not null default now()
);

create index if not exists cron_logs_job_created_idx
  on public.cron_logs (job, created_at desc);

-- Service-only: written via the direct Postgres connection (DATABASE_URL) which
-- bypasses RLS. Enabling RLS with no policy keeps it invisible to the anon/auth
-- REST roles so client sessions can never read operational logs.
alter table public.cron_logs enable row level security;

notify pgrst, 'reload schema';
