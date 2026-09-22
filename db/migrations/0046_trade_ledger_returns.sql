alter table public.swing_trade_ledger
  add column if not exists purchase_value numeric(20, 6);

alter table public.swing_trade_exits
  add column if not exists sale_value numeric(20, 6),
  add column if not exists realized_pnl numeric(20, 6);

update public.swing_trade_ledger
   set purchase_value = buy_price * quantity
 where purchase_value is null;

update public.swing_trade_exits
   set sale_value = exit_price * quantity
 where sale_value is null;

comment on column public.swing_trade_ledger.purchase_value is
  'Broker-reconciled acquisition value including charges when available; otherwise gross price times quantity.';
comment on column public.swing_trade_exits.sale_value is
  'Broker-reconciled net sale value when available; otherwise gross price times quantity.';
comment on column public.swing_trade_exits.realized_pnl is
  'Broker-reported realized P&L when available; otherwise derived from allocated acquisition cost.';
