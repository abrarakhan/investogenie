# Adaptive Allocation module

Adaptive Allocation is research, not a signal engine. It selects a pair of assets and applies
Universal Portfolio mathematics - an online allocation method that rebalances between two assets
without forecasting either - to ask how that pair would have performed under cost-aware rebalancing.
Users can save a strategy and, separately and explicitly, enable it for buy-only broker automation.
The research surface and the execution settings are deliberately distinct: a backtest result never
becomes an order by itself.

## Boundaries and invariants

- Owns pair selection, Universal Portfolio backtests, saved strategies and explicitly enabled buy-only automation.
- Web entry: `app/terminal/[market]/adaptive-allocation/page.tsx`.
- Server loaders: `lib/adaptiveAllocation.ts`; contracts: `lib/analytics/adaptiveAllocationSelection.ts`, `lib/analytics/universalPortfolio.ts`.
- Sole calculation authority: `pipelines/strategy_math/adaptive_allocation.py`.
- Research/backtest results must remain separate from broker execution settings.
- Mobile target: research, saved strategies and run history before any execution controls.
- Focused checks: `pipelines/test_adaptive_allocation_math.py`, Python bridge and action tests.
