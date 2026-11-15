# Swing module

- Owns Base Swing discovery, named strategies, cross-sectional ranks and live trade levels.
- Web entry: `app/terminal/[market]/screener/page.tsx`.
- Server: `lib/ingest/signals.ts`, `lib/screener.ts`; Python: `pipelines/strategy_math/swing_scan.py`.
- `swing_signals` is the persisted read model.
- Python owns verdicts, scores, ranks, tags and levels. TypeScript should load, persist and render only.
- Remaining task: remove legacy TypeScript Swing/named-strategy formula oracles after equivalent Python tests exist.
- Focused checks: Swing scan Python tests/parity, `lib/screener.test.ts`, screen component tests.
