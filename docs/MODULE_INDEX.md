# InvestoGenie Module Index

Use this file as the first routing step for focused work. Read only the linked module guide, its named entry points, and directly referenced dependencies. Do not scan the repository to rediscover these boundaries.

Each module guide now opens with a plain-language description of what that module does and why it is shaped that way, followed by the boundaries and invariants that constrain changes to it. A reader without the checkout can use the first part; an agent working in the repository needs both.

If you are reading this system without the source code, start instead with [CAPABILITIES.md](../CAPABILITIES.md) and [ARCHITECTURE.md](../ARCHITECTURE.md), which are written to stand alone.

| Module | Web entry | Server entry | Calculation owner | Guide |
| --- | --- | --- | --- | --- |
| Market dashboard | `app/terminal/[market]/page.tsx` | `lib/marketOverview.ts`, `lib/engines-runtime.ts` | Stored market data; Python Swing levels | [market](modules/market.md) |
| Stock Screener | `app/terminal/[market]/stocks/page.tsx` | `lib/screener/`, `/api/screener` | Python technical features; SQL filtering | [stock-screener](modules/stock-screener.md) |
| Swing Candidates | `app/terminal/[market]/screener/page.tsx` | `lib/screener.ts`, `lib/ingest/signals.ts` | Python `swing_scan.py` | [swing](modules/swing.md) |
| Strong Swing | Strong Swing section on Swing page | `lib/strongSwing.ts` | Python `strong_swing.py` | [strong-swing](modules/strong-swing.md) |
| Armed Strong Swing | `app/terminal/[market]/armed-swing/page.tsx` | `lib/armedSwing.ts` | Python `armed_swing.py` | [armed-swing](modules/armed-swing.md) |
| Momentum Ignition | Swing page sections | `lib/momentumIgnition*.ts` | Python `momentum.py` | [momentum](modules/momentum.md) |
| Trend Continuation | Swing page section | `lib/trendContinuation.ts` | Python continuation engines | [trend-continuation](modules/trend-continuation.md) |
| Trade Ledger | `app/terminal/[market]/trade-ledger/page.tsx` | `lib/swingTradeLedger*.ts` | Python `ledger.py` | [ledger](modules/ledger.md) |
| News & AI | `app/terminal/[market]/news-swing/page.tsx` | `lib/newsSwing.ts`, `lib/news/` | Python overlay; provider ingestion | [news](modules/news.md) |
| Long-Term | `app/terminal/[market]/long-term/page.tsx` | `lib/long-term-*.ts` | Python `long_term.py` | [long-term](modules/long-term.md) |
| Probability | `app/terminal/[market]/probability/page.tsx` | `lib/probability-runtime.ts` | Python `probability.py` | [probability](modules/probability.md) |
| Adaptive Allocation | `app/terminal/[market]/adaptive-allocation/page.tsx` | `lib/adaptiveAllocation.ts` | Python `adaptive_allocation.py` | [adaptive-allocation](modules/adaptive-allocation.md) |
| Portfolio & funds | Portfolio routes and `/terminal/in/cas` | `lib/portfolio*`, `lib/funds/`, `lib/cas/` | Server data services | [portfolio-funds](modules/portfolio-funds.md) |
| Notifications | Settings and browser/mobile delivery | `lib/mobileAlerts.ts`, notification routes | Server state transitions | [notifications](modules/notifications.md) |
| Mobile client | `mobile/App.tsx` | `/api/v1/mobile/`, `lib/mobileScreens.ts` | Server-authoritative | [mobile](modules/mobile.md) |
| Operations | `/data/health`, `/admin/sync` | `scripts/`, `pipelines/`, `workers/`, `deploy/` | Jobs and providers | [operations](modules/operations.md) |

## Shared boundaries

- PostgreSQL access: `lib/db.ts`; user-owned records must remain scoped by `user_id`.
- Python bridge: `lib/pythonStrategyMath.ts` and `pipelines/strategy_math_worker.py`.
- Market sessions: `lib/market-calendar.mjs`.
- Immutable execution plans: `lib/swingExecutionPlans.ts`, `lib/armedSwingPlans.ts`.
- Mobile contracts are versioned under `/api/v1/mobile/`; mobile must not calculate financial signals.

## Validation routing

Run focused tests named in the module guide during development. Before a release, run the full TypeScript tests, Python tests, typecheck, lint, build, and mobile typecheck when mobile files changed.
