-- Add actionable swing-trade levels to the precomputed signals.
alter table public.swing_signals
  add column if not exists current_price numeric(20, 6),
  add column if not exists entry_price   numeric(20, 6),
  add column if not exists target_price  numeric(20, 6),
  add column if not exists stop_loss      numeric(20, 6),
  add column if not exists trailing_stop  numeric(20, 6),
  add column if not exists atr            numeric(20, 6),
  add column if not exists risk_reward    numeric(8, 2);
