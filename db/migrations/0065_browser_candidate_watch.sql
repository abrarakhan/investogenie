-- Every deploy re-applies all migrations in order, so this list must already allow
-- every kind a later migration adds (ORDER_UPDATE, 0075): re-adding a narrower
-- check fails as soon as a row of the newer kind exists.
alter table public.browser_notification_events
  drop constraint if exists browser_notification_events_kind_check;

alter table public.browser_notification_events
  add constraint browser_notification_events_kind_check
  check (kind in ('CANDIDATE_READY','CANDIDATE_WATCH','TRADE_ACTION','ORDER_UPDATE'));
