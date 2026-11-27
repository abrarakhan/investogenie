-- Store the stop level that was in force when the first verified stop breach was observed.
alter table public.swing_trade_ledger
  add column if not exists first_stop_breach_stop_level numeric;
