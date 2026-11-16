-- Days the replay judged ready on everything except where the price sat.
--
-- The replay judges the entry band once, at the open. The live screen judges it against
-- the quote all session, so a stock that opens outside the band and walks into it later
-- is offered to the user and never entered the replay's sample. Recording those days is
-- the first half of measuring that gap; their intraday path decides the rest.
--
-- A near miss carries its plan levels and no outcome: there is no entry price until the
-- intraday path says whether the band was reached at all.
alter table public.strong_swing_replay_signals
  add column if not exists near_miss boolean not null default false;

comment on column public.strong_swing_replay_signals.near_miss is
  'True when every blocking gate except entry_zone passed: a day the live screen could have offered intraday but the open-only replay could not take.';
