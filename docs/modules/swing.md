# Swing module

Base Swing is the discovery layer every confirmed engine builds on. It scans the universe, assigns
cross-sectional ranks, and tags setups against five named strategies - Qullamaggie, Minervini, Darvas,
PTJ and Simons - each with its own entry, target and stop logic. Strong Swing then re-ranks a subset
of these after confirmation and execution gates.

Python owns the verdicts, scores, ranks, tags and levels; TypeScript loads, persists and renders them.
`swing_signals` is the persisted read model that other features read rather than rescanning.

## Boundaries and invariants

- Owns Base Swing discovery, named strategies, cross-sectional ranks and live trade levels.
- Web entry: `app/terminal/[market]/screener/page.tsx`.
- Public boundary: `features/swing/service.ts` and `features/swing/contracts.ts`.
- Transitional server implementation: `lib/ingest/signals.ts`, `lib/screener.ts`; Python: `pipelines/strategy_math/swing_scan.py`.
- `swing_signals` is the persisted read model.
- Python owns verdicts, scores, ranks, tags and levels. TypeScript should load, persist and render only.
- Other features must depend on `features/swing/`, not the transitional implementation.
- Remaining task: remove legacy TypeScript Swing/named-strategy formula oracles after equivalent Python tests exist.
- Focused checks: Swing scan Python tests/parity, `lib/screener.test.ts`, screen component tests.
