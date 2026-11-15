# Long-Term module

- Owns historical fundamental metrics and six investor-style scorecards.
- Web entry: `app/terminal/[market]/long-term/page.tsx`.
- Server: `lib/long-term-data.ts`, `lib/long-term-actions.ts`; current formulas: `lib/analytics/longTermStrategies.ts`.
- Current calculation authority is TypeScript; migration to Python is planned.
- Point-in-time statements and report age must remain explicit; missing values cannot be zero-filled.
- Mobile target: investor filter, score evidence and fundamental history.
- Focused checks: long-term analytics/data/action tests.
