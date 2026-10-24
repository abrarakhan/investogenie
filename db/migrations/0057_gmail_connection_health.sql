-- Gmail connection health. Scan failures were previously swallowed into a "failed=1" count,
-- so an expired or revoked Google grant silently stopped CAS imports for weeks. The last error
-- (Google's message only, never a token) is kept, and a revoked grant flags the connection
-- for an explicit reconnect instead of failing the same way every day.
alter table public.gmail_connections
  add column if not exists last_error text,
  add column if not exists last_error_at timestamptz,
  add column if not exists needs_reconnect boolean not null default false;
