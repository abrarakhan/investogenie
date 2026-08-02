-- Per-symbol attempt tracking for the incremental US OHLCV history sync.
--
-- Why this exists: the sync used to choose its next batch by data staleness
-- (`order by last_date`). Symbols that are delisted or otherwise permanently
-- dead never get a newer bar, so their last_date never advances, so they stay
-- "most stale" and win that ordering on every single run — forever. In
-- practice ~150 dead tickers monopolised every hourly run and ~8,500 healthy
-- symbols were never reached at all (observed 2026-08-02: identical
-- `stocks=150 fetched=144 bars_written=257` output on 87 consecutive runs,
-- with only 53 of 8,703 US assets fresh).
--
-- Ordering by ATTEMPT time instead makes starvation structurally impossible:
-- attempting a symbol always moves it to the back of the queue, whether or not
-- it produced data. consecutive_empty then adds day-scale backoff so dead
-- tickers consume progressively fewer slots without ever being abandoned (a
-- ticker that resumes trading is retried at least every 14 days).

create table if not exists public.us_history_sync_state (
  asset_id          uuid        not null references public.assets (id) on delete cascade,
  provider          text        not null default 'yahoo',
  last_attempt_at   timestamptz not null default now(),
  last_success_at   timestamptz,
  -- Consecutive runs that fetched this symbol but wrote no new bars. Drives
  -- the backoff in the selection query; reset to 0 whenever bars land.
  consecutive_empty integer     not null default 0 check (consecutive_empty >= 0),
  last_error        text,
  primary key (asset_id, provider)
);

-- The selection query orders by last_attempt_at across the whole candidate set.
create index if not exists us_history_sync_state_attempt_idx
  on public.us_history_sync_state (last_attempt_at);
