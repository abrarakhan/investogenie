# Long-Term module

- Owns historical fundamental metrics and six investor-style scorecards.
- Web entry: `app/terminal/[market]/long-term/page.tsx`.
- Server loaders: `lib/long-term-data.ts`, `lib/long-term-actions.ts`; sole calculation authority: `pipelines/strategy_math/long_term.py`.
- `lib/analytics/longTermStrategies.ts` contains contracts and declarative published thresholds only.
- Point-in-time statements and report age must remain explicit; missing values cannot be zero-filled.
- Mobile target: investor filter, score evidence and fundamental history.
- Focused checks: `pipelines/test_long_term_strategy_math.py` plus loader/action tests.
