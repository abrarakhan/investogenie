# Adaptive Allocation module

- Owns pair selection, Universal Portfolio backtests, saved strategies and explicitly enabled buy-only automation.
- Web entry: `app/terminal/[market]/adaptive-allocation/page.tsx`.
- Server loaders: `lib/adaptiveAllocation.ts`; contracts: `lib/analytics/adaptiveAllocationSelection.ts`, `lib/analytics/universalPortfolio.ts`.
- Sole calculation authority: `pipelines/strategy_math/adaptive_allocation.py`.
- Research/backtest results must remain separate from broker execution settings.
- Mobile target: research, saved strategies and run history before any execution controls.
- Focused checks: `pipelines/test_adaptive_allocation_math.py`, Python bridge and action tests.
