-- Phase 3: Deduplicated trade recovery & fresh-setup transition alerts.

alter table public.swing_trade_recovery_state
  add column if not exists last_alerted_recovery_status text,
  add column if not exists last_alerted_fresh_setup_key text,
  add column if not exists last_alerted_at timestamptz;

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
