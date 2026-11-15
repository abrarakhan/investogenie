# Strong Swing module

- Owns confirmed Swing assessment, gates, ranking, immutable plans and capture auditing.
- Public boundary: `features/strong-swing/service.ts` and `features/strong-swing/contracts.ts`.
- Transitional server implementation: `lib/strongSwing.ts`; internal contracts: `lib/analytics/strongSwing.ts`.
- Python authority: `pipelines/strategy_math/strong_swing.py`; independent audit: `pipelines/strong_swing_parity.py`.
- Tables: `strong_swing_snapshots`, `swing_execution_plans`, results-calendar tables.
- TypeScript must not derive status, levels or gates.
- Mobile uses server-ranked results and protected plan IDs.
- Focused checks: strong-swing parity/Python tests and capture upsert tests.
