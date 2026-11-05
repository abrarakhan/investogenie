-- Swing ranking inputs. Scores take only a few discrete values, so the list
-- order (and the Strong Swing input pool) was decided by ticker name on ties.
-- These normalized breakout-quality inputs break ties instead, and record
-- whether a build-up was confirmed by open interest or by cash volume.
alter table public.swing_signals
  add column if not exists buildup_source text,
  add column if not exists participation_ratio numeric,
  add column if not exists volume_expansion numeric,
  add column if not exists breakout_clearance_atr numeric,
  add column if not exists rs_rating integer,
  add column if not exists rank_score numeric;

create index if not exists swing_signals_rank_idx
  on public.swing_signals (score desc, rank_score desc nulls last, ticker);
