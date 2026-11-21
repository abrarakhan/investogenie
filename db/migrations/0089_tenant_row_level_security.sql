-- Database-enforced tenant isolation for every user-owned domain table.
--
-- The Node web pool SET ROLEs to this non-owner role. Authenticated requests
-- supply investogenie.user_id transaction-locally; authenticated cron work
-- supplies investogenie.worker=on. Python ingestion continues to connect as
-- the database owner and is therefore not constrained by tenant policies.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'investogenie_web') then
    raise exception 'investogenie_web role is missing; provision it with deploy/lightsail before migration 0089';
  end if;
end
$$;

grant usage on schema public to investogenie_web;
grant select, insert, update, delete on all tables in schema public to investogenie_web;
grant usage, select, update on all sequences in schema public to investogenie_web;
grant execute on all functions in schema public to investogenie_web;

alter default privileges in schema public
  grant select, insert, update, delete on tables to investogenie_web;
alter default privileges in schema public
  grant usage, select, update on sequences to investogenie_web;
alter default privileges in schema public
  grant execute on functions to investogenie_web;

do $$
declare
  table_name text;
  tenant_tables constant text[] := array[
    'adaptive_allocation_strategies',
    'armed_swing_plans',
    'breeze_auto_buy_settings',
    'breeze_broker_snapshots',
    'breeze_broker_syncs',
    'breeze_order_actions',
    'breeze_order_events',
    'breeze_order_intents',
    'browser_notification_events',
    'candidate_signal_observations',
    'cas_holding_details',
    'cas_import_rejected_holdings',
    'email_digest_deliveries',
    'email_preferences',
    'gmail_attachment_imports',
    'gmail_connections',
    'gmail_disclosure_attachments',
    'gmail_oauth_states',
    'holdings',
    'mobile_alert_preferences',
    'mobile_candidate_alert_state',
    'mobile_mutation_idempotency',
    'mobile_notification_log',
    'mobile_push_tokens',
    'mobile_trade_alert_state',
    'portfolios',
    'saved_screens',
    'swing_execution_plans',
    'swing_pending_order_fills',
    'swing_pending_orders',
    'swing_trade_exits',
    'swing_trade_ledger',
    'transactions',
    'user_credentials',
    'user_fund_mappings',
    'user_mutual_fund_holdings',
    'user_news_providers',
    'user_swing_settings',
    'watchlist_items',
    'watchlists'
  ];
begin
  foreach table_name in array tenant_tables loop
    if to_regclass(format('public.%I', table_name)) is null then
      raise exception 'RLS target public.% is missing', table_name;
    end if;
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists tenant_isolation on public.%I', table_name);
    execute format(
      'create policy tenant_isolation on public.%I for all to investogenie_web '
      'using (current_setting(''investogenie.worker'', true) = ''on'' '
      'or user_id = nullif(current_setting(''investogenie.user_id'', true), '''')::uuid) '
      'with check (current_setting(''investogenie.worker'', true) = ''on'' '
      'or user_id = nullif(current_setting(''investogenie.user_id'', true), '''')::uuid)',
      table_name
    );
  end loop;
end
$$;

-- Global forward-test rows (user_id NULL) are shared research output. A user
-- may read them, but only the worker context may create or mutate them.
alter table public.forward_test_positions enable row level security;
drop policy if exists forward_test_tenant_read on public.forward_test_positions;
create policy forward_test_tenant_read on public.forward_test_positions
  for select to investogenie_web
  using (
    current_setting('investogenie.worker', true) = 'on'
    or user_id is null
    or user_id = nullif(current_setting('investogenie.user_id', true), '')::uuid
  );

-- Child rows inherit ownership through their saved adaptive strategy.
alter table public.adaptive_allocation_runs enable row level security;
drop policy if exists adaptive_run_tenant_isolation on public.adaptive_allocation_runs;
create policy adaptive_run_tenant_isolation on public.adaptive_allocation_runs
  for all to investogenie_web
  using (
    current_setting('investogenie.worker', true) = 'on'
    or exists (
      select 1 from public.adaptive_allocation_strategies s
       where s.id=strategy_id
         and s.user_id=nullif(current_setting('investogenie.user_id', true), '')::uuid
    )
  )
  with check (
    current_setting('investogenie.worker', true) = 'on'
    or exists (
      select 1 from public.adaptive_allocation_strategies s
       where s.id=strategy_id
         and s.user_id=nullif(current_setting('investogenie.user_id', true), '')::uuid
    )
  );
drop policy if exists forward_test_tenant_write on public.forward_test_positions;
create policy forward_test_tenant_write on public.forward_test_positions
  for all to investogenie_web
  using (
    current_setting('investogenie.worker', true) = 'on'
    or user_id = nullif(current_setting('investogenie.user_id', true), '')::uuid
  )
  with check (
    current_setting('investogenie.worker', true) = 'on'
    or user_id = nullif(current_setting('investogenie.user_id', true), '')::uuid
  );

-- These bootstrap tables are deliberately outside tenant RLS because identity
-- is not known until their opaque token hashes have been resolved. They remain
-- protected by indexed random-token lookup and are never list endpoints.
--   public.mobile_sessions
--   public.password_reset_tokens
