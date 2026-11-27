-- Phase 2: Automated Strategy Rechecks for Recovering Open Trades
-- Stores fresh-setup qualification (with its own entry/stop/target and first-qualified timestamp)
-- or the main blocker when no strategy qualifies, without touching the original frozen plan.

alter table public.swing_trade_recovery_state
  add column if not exists fresh_setup_status text not null default 'NONE'
    check (fresh_setup_status in ('NONE', 'QUALIFIED', 'BLOCKED')),
  add column if not exists fresh_setup_engine text,
  add column if not exists fresh_setup_label text,
  add column if not exists fresh_setup_entry numeric,
  add column if not exists fresh_setup_stop numeric,
  add column if not exists fresh_setup_target numeric,
  add column if not exists fresh_setup_route text,
  add column if not exists fresh_setup_blocker text,
  add column if not exists fresh_setup_first_qualified_at timestamptz,
  add column if not exists fresh_setup_checked_at timestamptz;
