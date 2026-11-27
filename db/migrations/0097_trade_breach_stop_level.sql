-- Store the stop level that was in force when the first verified stop breach was observed,
-- and allow RECENT_SIGNAL on fresh_setup_status for non-alerting same-day strategy signals.
alter table public.swing_trade_ledger
  add column if not exists first_stop_breach_stop_level numeric;

alter table public.swing_trade_recovery_state
  drop constraint if exists swing_trade_recovery_state_fresh_setup_status_check;

alter table public.swing_trade_recovery_state
  add constraint swing_trade_recovery_state_fresh_setup_status_check
  check (fresh_setup_status in ('NONE', 'QUALIFIED', 'RECENT_SIGNAL', 'BLOCKED'));
