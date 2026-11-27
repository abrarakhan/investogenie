-- Allow NEWS_RISK high-impact news alerts in public.browser_notification_events.
alter table public.browser_notification_events
  drop constraint if exists browser_notification_events_kind_check;

alter table public.browser_notification_events
  add constraint browser_notification_events_kind_check
  check (
    kind in (
      'CANDIDATE_READY',
      'CANDIDATE_WATCH',
      'TRADE_ACTION',
      'ORDER_UPDATE',
      'NEWS_RISK',
      'TRADE_RECOVERY'
    )
  );
