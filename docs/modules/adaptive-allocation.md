# Adaptive Allocation module

- Owns pair selection, Universal Portfolio backtests, saved strategies and explicitly enabled buy-only automation.
- Web entry: `app/terminal/[market]/adaptive-allocation/page.tsx`.
- Server: `lib/adaptiveAllocation.ts`; current formulas: `lib/analytics/adaptiveAllocationSelection.ts`, `universalPortfolio.ts`.
- Current calculation authority is TypeScript; Python migration is planned.
- Research/backtest results must remain separate from broker execution settings.
- Mobile target: research, saved strategies and run history before any execution controls.
- Focused checks: adaptive selection, portfolio and action tests.
