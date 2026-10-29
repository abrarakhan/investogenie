-- Preserve point-in-time history across verified exchange ticker changes.
--
-- The listing feeds correctly created the replacement symbols, but the former
-- symbols remained active with their old history and index membership. That
-- made Data Health retry identifiers the exchange no longer publishes and left
-- the replacement assets without enough history for strategy calculations.

create table if not exists public.asset_symbol_changes (
  old_asset_id uuid primary key references public.assets(id) on delete restrict,
  new_asset_id uuid not null references public.assets(id) on delete restrict,
  old_symbol text not null,
  new_symbol text not null,
  exchange text not null,
  effective_date date not null,
  source text not null,
  recorded_at timestamptz not null default now(),
  check (old_asset_id <> new_asset_id)
);

create unique index if not exists asset_symbol_changes_new_old_idx
  on public.asset_symbol_changes(new_asset_id, old_asset_id);

insert into public.asset_symbol_changes
  (old_asset_id,new_asset_id,old_symbol,new_symbol,exchange,effective_date,source)
select old_asset.id,new_asset.id,rename.old_symbol,rename.new_symbol,rename.exchange,
       rename.effective_date,'NSE_BHAVCOPY_VERIFIED'
  from (values
    ('HEG','HEGAM','NSE',date '2026-09-24'),
    ('HEG','HEGAM','BSE',date '2026-09-24'),
    ('ICICIPRULI','ICICILIFE','NSE',date '2026-10-24'),
    ('ICICIPRULI','ICICILIFE','BSE',date '2026-10-24')
  ) rename(old_symbol,new_symbol,exchange,effective_date)
  join public.assets old_asset
    on old_asset.exchange=rename.exchange and old_asset.ticker=rename.old_symbol
  join public.assets new_asset
    on new_asset.exchange=rename.exchange and new_asset.ticker=rename.new_symbol
on conflict (old_asset_id) do update set
  new_asset_id=excluded.new_asset_id,
  old_symbol=excluded.old_symbol,
  new_symbol=excluded.new_symbol,
  exchange=excluded.exchange,
  effective_date=excluded.effective_date,
  source=excluded.source;

-- The replacement asset becomes the continuous price series. Existing rows on
-- and after the rename date remain authoritative; only missing older dates are
-- inherited from the former symbol.
insert into public.daily_ohlcv
  (asset_id,date,open,high,low,close,volume,open_interest,source)
select change.new_asset_id,bar.date,bar.open,bar.high,bar.low,bar.close,
       bar.volume,bar.open_interest,bar.source
  from public.asset_symbol_changes change
  join public.daily_ohlcv bar on bar.asset_id=change.old_asset_id
 where bar.date < change.effective_date
on conflict (asset_id,date) do nothing;

-- Keep point-in-time company statements attached to the replacement asset.
insert into public.asset_financial_reports
select (jsonb_populate_record(
  null::public.asset_financial_reports,
  to_jsonb(report) || jsonb_build_object('asset_id',change.new_asset_id)
)).*
  from public.asset_symbol_changes change
  join public.asset_financial_reports report on report.asset_id=change.old_asset_id
on conflict (asset_id,period_end_date,report_type) do nothing;

insert into public.asset_balance_sheets
select (jsonb_populate_record(
  null::public.asset_balance_sheets,
  to_jsonb(statement) || jsonb_build_object('asset_id',change.new_asset_id)
)).*
  from public.asset_symbol_changes change
  join public.asset_balance_sheets statement on statement.asset_id=change.old_asset_id
on conflict (asset_id,period_end_date,report_type) do nothing;

insert into public.asset_cash_flow_statements
select (jsonb_populate_record(
  null::public.asset_cash_flow_statements,
  to_jsonb(statement) || jsonb_build_object('asset_id',change.new_asset_id)
)).*
  from public.asset_symbol_changes change
  join public.asset_cash_flow_statements statement on statement.asset_id=change.old_asset_id
on conflict (asset_id,period_end_date,report_type) do nothing;

-- Transfer every index/universe membership and update the stored symbol. Insert
-- first so a pre-existing replacement membership wins without a constraint
-- failure, then remove the obsolete membership row.
insert into public.universe_members(universe,country,symbol,asset_id)
select membership.universe,membership.country,change.new_symbol,change.new_asset_id
  from public.asset_symbol_changes change
  join public.universe_members membership on membership.asset_id=change.old_asset_id
on conflict (universe,symbol) do update set
  country=excluded.country,
  asset_id=excluded.asset_id;

delete from public.universe_members membership
 using public.asset_symbol_changes change
 where membership.asset_id=change.old_asset_id;

-- Preserve known results dates and recent verification state where the new
-- listing record has not yet been checked independently.
insert into public.corporate_events(asset_id,event_type,event_date,source,fetched_at)
select change.new_asset_id,event.event_type,event.event_date,event.source,event.fetched_at
  from public.asset_symbol_changes change
  join public.corporate_events event on event.asset_id=change.old_asset_id
on conflict (asset_id,event_type,event_date) do nothing;

insert into public.corporate_event_sync_state(asset_id,last_attempt_at,last_success_at,error)
select change.new_asset_id,state.last_attempt_at,state.last_success_at,state.error
  from public.asset_symbol_changes change
  join public.corporate_event_sync_state state on state.asset_id=change.old_asset_id
on conflict (asset_id) do nothing;

-- Retain the obsolete records for audit and any historical foreign keys, but
-- exclude them from live strategies, health gaps and future repair attempts.
insert into public.asset_tracking_exclusions
  (asset_id,reason_code,reason,source,metadata)
select change.old_asset_id,'ticker_renamed',
       change.old_symbol || ' renamed to ' || change.new_symbol || ' on ' || change.effective_date,
       change.source,
       jsonb_build_object(
         'replacementAssetId',change.new_asset_id,
         'replacementSymbol',change.new_symbol,
         'effectiveDate',change.effective_date
       )
  from public.asset_symbol_changes change
on conflict (asset_id) do update set
  reason_code=excluded.reason_code,
  reason=excluded.reason,
  source=excluded.source,
  excluded_at=now(),
  review_after=null,
  metadata=excluded.metadata;

update public.assets old_asset
   set is_active=false
  from public.asset_symbol_changes change
 where old_asset.id=change.old_asset_id;

update public.assets new_asset
   set is_active=true
  from public.asset_symbol_changes change
 where new_asset.id=change.new_asset_id;

update public.backfill_queue queue
   set status='skipped',
       completed_at=coalesce(queue.completed_at,now()),
       last_error='Ticker renamed; replacement is ' || change.new_symbol
  from public.asset_symbol_changes change
 where queue.asset_id=change.old_asset_id
   and queue.status in ('pending','in_progress','failed','skipped');

