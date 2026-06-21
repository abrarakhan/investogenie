-- Supabase exposes tables to the REST API through the `anon` / `authenticated`
-- roles; RLS policies only take effect once those roles also hold table-level
-- privileges. Hosted projects get these GRANTs by default, but a pure-migration
-- local stack (supabase start) does not — without them every PostgREST read is
-- "permission denied". Row access is still governed by the RLS policies defined
-- in the earlier migrations; these grants just make the tables reachable.
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

notify pgrst, 'reload schema';
