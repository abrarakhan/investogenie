alter table public.browser_notification_events
  add column if not exists market_date date;

update public.browser_notification_events
   set market_date=(created_at at time zone case when market='IN' then 'Asia/Kolkata' else 'America/New_York' end)::date
 where market_date is null;

-- Retain the first audit event for an identical transition and remove only
-- redundant delivery rows. Trading, signal and ledger records are untouched.
delete from public.browser_notification_events duplicate
 using public.browser_notification_events original
 where duplicate.user_id=original.user_id
   and duplicate.signature=original.signature
   and duplicate.market_date=original.market_date
   and duplicate.id>original.id;

alter table public.browser_notification_events
  alter column market_date set not null;

create unique index if not exists browser_notification_events_daily_signature_uidx
  on public.browser_notification_events(user_id,signature,market_date);

