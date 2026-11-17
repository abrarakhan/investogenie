# Momentum module

Momentum Ignition looks for stocks entering an expansion move, including recent listings that the
confirmed Swing engines would not yet consider. Two models run side by side: a legacy discovery model
and a V2 model that aims at the first thrust or first retest over the next one to two sessions, with
states Momentum Ready, First Thrust, Pre-Ignition, Retest Setup, Late Risk and Failed. V2's timing
veto also applies to legacy execution.

Bases are built only from completed sessions; the in-progress bar is a separate input. During an open
India session a setup is actionable only with both a fresh Breeze quote and the matching current
session Breeze OHLCV row carrying positive volume. Without that evidence the setup stays visible but
execution-blocked - the user still sees it, they simply cannot act on unverified data.

## Boundaries and invariants

- Owns legacy Momentum discovery, V2 early-entry timing, execution vetoes, ranking and plans.
- Public boundary: `features/momentum/service.ts` and `features/momentum/contracts.ts`.
- Transitional server adapters: `lib/momentumIgnition.ts`, `lib/momentumIgnitionLegacy.ts`; internal contracts: `lib/analytics/momentumIgnition*.ts`.
- Sole calculation authority: `pipelines/strategy_math/momentum.py`.
- TypeScript modules contain contracts, data loading, persistence and presentation only.
- During an open India session, actionability requires fresh Breeze quote and live OHLCV/volume evidence.
- Mobile receives server-computed cards and protected plans.
- Web, mobile and alert consumers must import the feature boundary rather than the transitional adapters.
- Focused checks: `pipelines/test_momentum_strategy_math.py`, `lib/pythonStrategyMath.test.ts`, candidate/plan tests.
