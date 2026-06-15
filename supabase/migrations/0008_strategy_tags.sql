-- Legendary Trader Strategy module: tag each swing_signals row with the
-- legendary systems it matches, plus a per-strategy score/entry payload.
--
-- strategy_tags   : array of matched strategy keys (QULLAMAGGIE, MINERVINI, …)
-- strategy_scores : { "<KEY>": { "score": 0.0-1.0, "dir": "LONG|SHORT",
--                                 "entry": <custom trigger price | null> }, … }

alter table public.swing_signals
  add column if not exists strategy_tags   text[]  not null default '{}',
  add column if not exists strategy_scores jsonb   not null default '{}'::jsonb;

-- GIN index so a strategy filter (strategy_tags @> ARRAY['DARVAS']) stays fast
-- across the full universe.
create index if not exists swing_signals_strategy_tags_idx
  on public.swing_signals using gin (strategy_tags);

-- PostgREST keeps an in-memory schema cache; new columns are invisible to the
-- REST API until it reloads.
notify pgrst, 'reload schema';
