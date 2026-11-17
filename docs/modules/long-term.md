# Long-Term module

The Long-Term module is the only part of the system that looks at years rather than sessions. It
reads multi-year financial statements and derives historical metrics - revenue and profit CAGR over
three and five years, median ROCE, cash conversion and free-cash-flow margin, and the proportion of
years with positive profit - then scores each company against six investor-style scorecards:
Buffett (moat), Fisher (growth), Graham (defensive), Greenblatt (magic formula), Lynch (GARP) and
Templeton (contrarian).

The discipline that matters here is point-in-time honesty. Statement periods and report age stay
explicit, and a missing value is never filled with zero - a company that has not reported is not a
company that reported nothing.

## Boundaries and invariants

- Owns historical fundamental metrics and six investor-style scorecards.
- Web entry: `app/terminal/[market]/long-term/page.tsx`.
- Server loaders: `lib/long-term-data.ts`, `lib/long-term-actions.ts`; sole calculation authority: `pipelines/strategy_math/long_term.py`.
- `lib/analytics/longTermStrategies.ts` contains contracts and declarative published thresholds only.
- Point-in-time statements and report age must remain explicit; missing values cannot be zero-filled.
- Mobile target: investor filter, score evidence and fundamental history.
- Focused checks: `pipelines/test_long_term_strategy_math.py` plus loader/action tests.
