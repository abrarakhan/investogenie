alter table public.latest_quotes add column if not exists best_bid numeric;
alter table public.latest_quotes add column if not exists best_ask numeric;
alter table public.latest_quotes add column if not exists bid_quantity numeric;
alter table public.latest_quotes add column if not exists ask_quantity numeric;
alter table public.latest_quotes add column if not exists total_buy_quantity numeric;
alter table public.latest_quotes add column if not exists total_sell_quantity numeric;
alter table public.latest_quotes add column if not exists lower_circuit numeric;
alter table public.latest_quotes add column if not exists upper_circuit numeric;
