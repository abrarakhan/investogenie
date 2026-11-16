# Strong Swing module

- Owns confirmed Swing assessment, gates, ranking, immutable plans and capture auditing.
- Public boundary: `features/strong-swing/service.ts` and `features/strong-swing/contracts.ts`.
- Transitional server implementation: `lib/strongSwing.ts`; internal contracts: `lib/analytics/strongSwing.ts`.
- Python authority: `pipelines/strategy_math/strong_swing.py`; independent audit: `pipelines/strong_swing_parity.py`.
- Tables: `strong_swing_snapshots`, `swing_execution_plans`, results-calendar tables.
- TypeScript must not derive status, levels or gates.
- Mobile uses server-ranked results and protected plan IDs.
- Focused checks: strong-swing parity/Python tests and capture upsert tests.

## Historical replay

- `pipelines/strong_swing_replay.py` replays the engine over `daily_ohlcv` and grades
  every `EXECUTION_READY` day by entering at the next session's open.
- It calls the same `strategy_math.strong_swing.assess` the screen calls; it does not
  reimplement the strategy. No bar after the signal date ever reaches the engine, and
  `pipelines/test_strong_swing_replay.py` asserts that against a real scan.
- Three gates cannot be judged from history: `live_quote`, `live_spread` and
  `live_circuit` need a broker quote that was never recorded. `results_blackout` needs
  the corporate-results calendar, which only exists from late 2025; `--results strict`
  evaluates it where the calendar brackets the date. Each run records which it did in
  `strong_swing_replay_runs.results_mode` and `.live_execution_evaluated`.
- The v6 session gates are inert in a replay by construction: history has completed
  bars and no open session, so a replay measures the completed-bar edge only.
- The benchmark is the binding limit on how far back a replay reaches — a stock-day
  with no benchmark behind it fails `benchmark_data`. `pipelines/benchmark_history_backfill.py`
  extends that series; the daily sync only ever fetches forward.
- Tables: `strong_swing_replay_runs`, `strong_swing_replay_signals` (migration 0082).
  Nothing here feeds the live screen.
