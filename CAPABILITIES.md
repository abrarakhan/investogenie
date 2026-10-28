# InvestoGenie Capabilities

_Code and production baseline reviewed 26 October 2026 through runtime revision `1c7aac3`. Implemented means present in source; provider access, continuing data coverage and installed mobile binaries still require runtime checks._

## Market research

| Surface | Implemented behavior | Main sources |
| --- | --- | --- |
| Market overview | India/US quotes, breadth and charts | `app/markets/`, `components/market-overview/` |
| Stock Screener | Whitelisted AND filters, presets, universes, saved screens, CSV/Excel exports and natural-language filters | `lib/screener/`, `lib/screener-actions.ts` |
| Swing Candidates | Buy-side setups with strategy tags and frozen levels; India NSE top 20 | `lib/screener.ts`, market screener page |
| Strong Swing | Confirmation, liquidity, market and execution gates with deterministic ranking | `lib/strongSwing.ts`, `lib/analytics/strongSwing.ts` |
| Momentum Ignition | Legacy and V2 discovery with completed-session bases, separately verified live-session input and explicit execution blocking; V2 includes Momentum Ready, First Thrust, Pre-Ignition, Retest, Late Risk and Failed states | `lib/momentumIgnition*.ts` |
| Trend Continuation | Python-owned multi-session impulse, continuation-watch, ready and extended-risk observation states; never creates an execution or auto-buy plan | `pipelines/trend_continuation.py`, `lib/trendContinuation.ts` |
| Armed Strong Swing | Earlier stage-2 breakout plans, live volume pace, structural stops and results blackout | `lib/armedSwing.ts`, `lib/analytics/armedSwing.ts` |
| News & AI Swing | Source-linked event overlay on existing technical candidates | `lib/news/`, `lib/newsSwing.ts` |
| Long-Term Candidates | Multi-year statement evidence and investor-inspired rankings | `lib/analytics/longTermStrategies.ts` |
| Probability | 21-session return and risk distributions | `lib/probability-runtime.ts`, `lib/analytics/probability/` |
| Adaptive Allocation | Two-asset, cost-aware Universal Portfolio research and saved strategies | `lib/adaptiveAllocation.ts`, `lib/analytics/universalPortfolio.ts` |
| Forward tests | Recorded signal outcomes and comparison views | market forward-test page |

The Stock Screener is at `/terminal/[market]/stocks`; `/terminal/[market]/screener` is Swing Candidates. AI dispatch supports Anthropic, OpenAI, Google and DeepSeek. Generated filters go through schema/filter validation and sanitization rather than becoming arbitrary SQL.

## Armed Swing and execution plans

Armed Swing scans eligible active stocks, ranks relative strength and assesses a bounded shortlist of 250. Bases use completed sessions; current-session volume contributes to breakout pace. India benchmarks prefer NIFTY then NIFTYBEES; the US benchmark is SPY.

States are `BUY_ZONE`, `TRIGGERED_UNCONFIRMED`, `ARMED`, `UNVERIFIED`, `FORMING`, `EXTENDED`, `RISK_OFF` and `INVALIDATED`. Missing live quotes, bid/ask depth, circuit bands or verified results coverage blocks entry. India requires Breeze live execution data. Results within three trading sessions block new entries.

Server-held Armed plans freeze levels and gate evidence in immutable versions. Pending buy-stops require a same-session `ARMED` plan captured within 30 minutes. Direct Armed purchases require a matching `BUY_ZONE` plan and a purchase price within its trigger/limit band, subject to rounding tolerance.

Strong Swing and Momentum purchase validation likewise uses stored execution plans: actionable status, matching stock/market/strategy, current session, capture age at most 30 minutes, price at or above confirmed entry within tolerance and below target.

## Trade Ledger and broker behavior

- Purchases, edit/delete, partial/final sales and sale correction.
- Immutable purchase plans and current risk/news assessment.
- Pending buy-stop records with a default seven-calendar-day validity.
- Fill validation checks price band, remaining quantity and fill dates. Each confirmed partial fill creates its own purchased trade in the same database transaction.
- Unfilled pending orders have no position, capital employed or P&L. Cancelling the remainder preserves previous fills.
- Broker-reconciled acquisition value, proceeds and realized profit.
- Capital-employed ROI and annualized XIRR, with retained sale proceeds recycled before inferring new external capital.
- Breeze read-only holdings/positions/orders synchronization.
- Separately enabled automatic buying with spending limits and order intents for Strong Swing and saved Adaptive Allocation strategies; no automatic selling/rebalancing.

Recording a pending order or ledger fill does not submit a broker order.

## Funds, credentials and automation

CAS import preserves ISIN/folio identities. AMFI bridges fund identifiers to AMC snapshots; Fund Mapping exposes composition and cross-fund overlap. Gmail discovery can process the latest CAS and matching AMC disclosures automatically when auto-import is enabled; ambiguous documents need review. Revoked grants set reconnect state, and scan errors/timestamps are surfaced.

Secrets are encrypted per user with AES-256-GCM. Settings responses expose configuration metadata and presence flags rather than decrypted credentials. SMTP, AI/news, Breeze and Gmail integrations retain distinct credential paths.

The Node wrapper coordinates market data, repair queues, fundamentals, macro, scans, forward tests, AMFI, news, mobile alerts, Gmail, results calendars and ML snapshots. Email defaults to 07:00 IST and uses saved per-user SMTP credentials plus India Strong Swing/Probability results. See [email setup](docs/EMAIL_SETUP.md) for scheduling and retry limits.

Candidate scans evaluate every account whether or not it has an enabled Expo token. They persist status observations, refresh prioritized live-market targets and send a push only when an eligible enabled token exists. During an open India session, Momentum execution readiness requires both a fresh `BREEZE_LIVE` quote and a valid current-session Breeze OHLCV row with positive volume. Missing evidence leaves the candidate visible but execution-blocked.

## Mobile

Expo SDK 57 / React Native 0.86.3 consumes versioned server APIs. Implemented features include secure login, India/US workspaces, server-ranked Strong Swing and News & AI, ledger mutations, candles, biometric re-entry and opt-in push.

Authenticated web pages also provide opt-in browser notifications for candidate-ready transitions and material open-trade actions. They use one server event per signature and market day, stable browser tags, and single-tab polling to prevent duplicate delivery while an InvestoGenie tab remains open. Candidate alerts are evaluated only during the relevant open market session, are discarded before delivery if the candidate is no longer ready, and link to the exact strategy section that produced them.

Ledger push text is generic. Ready-candidate push text includes ticker, readiness state and engine; Expo receives that text and the push token. Prices, quantities and broker details are excluded. See [privacy](mobile/PRIVACY.md).

Local Prebuild/Gradle/Xcode is the documented distribution path. Existing package scripts still invoke EAS Build, and release validation reads EAS profile configuration; local builds require an explicitly supplied API URL. The source cannot establish which binary is installed.

## ML and operational limits

The ML foundation provides schema, scheduled snapshots, deterministic Python features/labels and golden vectors. Training/calibration, promotion automation, monitoring enforcement and inference remain design contracts rather than complete runtime implementations. ML does not currently control candidate eligibility or broker execution.

Migrations extend through 0059. Migration 0058 adds persisted screener technical history and 0059 adds candidate signal observations. The Linux release script explicitly applies 0033–0059 after assuming an existing earlier schema, and re-executes the checked-out script once after pulling so migrations introduced by that release are not skipped. Provider quotas and continuing runtime health remain deployment-specific.

See [architecture](ARCHITECTURE.md), [status](STATUS.md), [deployment](DEPLOYMENT.md) and [ML methodology](docs/ml-methodology.md).
