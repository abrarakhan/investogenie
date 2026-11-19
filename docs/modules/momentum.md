# Momentum module

- Owns legacy Momentum discovery, V2 early-entry timing, execution vetoes, ranking and plans.
- Public boundary: `features/momentum/service.ts` and `features/momentum/contracts.ts`.
- Transitional server adapters: `lib/momentumIgnition.ts`, `lib/momentumIgnitionLegacy.ts`; internal contracts: `lib/analytics/momentumIgnition*.ts`.
- Sole calculation authority: `pipelines/strategy_math/momentum.py`.
- TypeScript modules contain contracts, data loading, persistence and presentation only.
- During an open India session, actionability requires fresh Breeze quote and live OHLCV/volume evidence.
- Mobile receives server-computed cards and protected plans.
- Web, mobile and alert consumers must import the feature boundary rather than the transitional adapters.
- Focused checks: `pipelines/test_momentum_strategy_math.py`, `lib/pythonStrategyMath.test.ts`, candidate/plan tests.
