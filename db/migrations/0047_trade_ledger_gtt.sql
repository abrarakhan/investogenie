alter table public.swing_trade_ledger
  add column if not exists current_gtt_stop numeric(20, 6),
  add column if not exists gtt_updated_at timestamptz;

comment on column public.swing_trade_ledger.current_gtt_stop is
  'Last broker GTT stop confirmed manually by the user. InvestoGenie never changes broker orders automatically.';
comment on column public.swing_trade_ledger.gtt_updated_at is
  'Time the user confirmed that the broker GTT was updated.';
