-- Session VWAP from the Breeze live feed. It arrives with every tick, alongside
-- the resting buy/sell totals whose columns (0041) were never written. Only a
-- BREEZE_LIVE row of the current session carries meaningful values.
alter table public.latest_quotes add column if not exists vwap numeric;
