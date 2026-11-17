# InvestoGenie Capabilities

_Code and production baseline reviewed 17 November 2026 through deployed revision `784f894`. Implemented means present in source; provider access, continuing data coverage and installed mobile binaries still require runtime checks._

This document is written to be read without the repository: it describes what the system does. [ARCHITECTURE.md](ARCHITECTURE.md) describes how it is built. File paths are given as provenance, not as required reading.

## Market research

| Surface | Implemented behavior | Main sources |
| --- | --- | --- |
| Market overview | India/US quotes, breadth and charts | `app/markets/`, `components/market-overview/` |
| Stock Screener | Whitelisted AND filters, presets, universes, saved screens, CSV/Excel exports and natural-language filters | `lib/screener/`, `lib/screener-actions.ts` |
| Swing Candidates | Buy-side setups with strategy tags, breakout-day and extended/void entry states, and frozen levels | `lib/screener.ts`, market screener page |
| Strong Swing | Python-authoritative confirmation, liquidity, market, results-blackout and execution gates, trade levels and deterministic ranking. The entry band (0.25-0.75 ATR above the confirmed entry) is read against both the live quote and the session's own opening price | `pipelines/strategy_math/strong_swing.py`, `lib/strongSwing.ts` |
| Momentum Ignition | Python-authoritative legacy and V2 discovery with completed-session bases, separately verified live-session input and explicit execution blocking; V2 includes Momentum Ready, First Thrust, Pre-Ignition, Retest, Late Risk and Failed states | `pipelines/strategy_math/momentum.py`, `lib/momentumIgnition*.ts` |
| Trend Continuation | Python-owned multi-session impulse, pre-impulse trend, continuation-watch, ready and extended-risk states; counter-trend rebounds cannot become ready; confirmed day-two breakouts may create an immutable manual plan after live execution and results gates; day one, pullbacks and auto-buy remain blocked | `pipelines/trend_continuation.py`, `lib/trendContinuation.ts` |
| Armed Strong Swing | Earlier stage-2 breakout plans, blocking RS/regime gates, versioned 40-session time-of-day volume pace, structural stops and results blackout | `lib/armedSwing.ts`, `lib/analytics/armedSwing.ts` |
| News & AI Swing | Source-linked event overlay on existing technical candidates | `lib/news/`, `lib/newsSwing.ts` |
| Long-Term Candidates | Multi-year statement evidence and investor-inspired rankings | `lib/analytics/longTermStrategies.ts` |
| Probability | 21-session return and risk distributions | `lib/probability-runtime.ts`, `lib/analytics/probability/` |
| Adaptive Allocation | Two-asset, cost-aware Universal Portfolio research and saved strategies | `lib/adaptiveAllocation.ts`, `lib/analytics/universalPortfolio.ts` |
| Forward tests | Live paper-trading of every engine's own calls, frozen at the moment they were made | `lib/forwardTestEngines.ts`, `lib/forwardTest.ts` |
| In-app help library | 23 long-form articles explaining every strategy's rules, formulas and thresholds | `lib/help/articles.tsx`, `/help` |

The Stock Screener is at `/terminal/[market]/stocks`; `/terminal/[market]/screener` is Swing Candidates. AI dispatch supports Anthropic, OpenAI, Google and DeepSeek. Generated filters go through schema/filter validation and sanitization rather than becoming arbitrary SQL.

### Workspace routes

`/terminal/[market]` is the market workspace; beneath it sit `stocks` (Stock Screener),
`screener` (Swing Candidates), `strong-swing`, `armed-swing`, `news-swing`, `long-term`,
`probability`, `adaptive-allocation`, `forward-test` and `trade-ledger`, plus `/terminal/in/cas`
for the India CAS import. Outside the terminal: `/markets/[market]` market overview, `/portfolio/mutual-funds`
and `/portfolio/fund-mapping`, `/settings`, `/data/health`, `/admin/sync`, `/help` and `/help/[slug]`,
`/about`, `/login` and `/login/reset`. Markets are `IN` (NSE/BSE) and `US`.

### In-app help library

23 articles across six categories - swing (5), execution (7), long-term (7), probability, engine and
data - explain each strategy in the reader's own terms: the rules, the exact thresholds, worked
formulas and the named trader or origin a strategy derives from. They are the user-facing
counterpart to this document and are served from the app itself rather than kept as external notes.

### Forward tests

Forward testing records what each engine actually called, as it called it. A candidate from Strong
Swing, Momentum Ignition (legacy and V2), Trend Continuation, Trend day-two and its watch variant, or
Armed Swing becomes a frozen paper call: a resting buy order at that engine's own entry, carrying its
own target and stop. Nothing is recalculated afterwards, so the comparison measures the engine rather
than a later opinion of it. Results are stored in `forward_test_positions` and compared across engines.

## Armed Swing and execution plans

Armed Swing scans eligible active stocks, ranks relative strength and assesses a bounded shortlist of 250. Bases use completed sessions; current-session volume contributes to breakout pace against a market-specific, versioned curve containing at least 40 complete sessions. India benchmarks prefer NIFTY then NIFTYBEES; the US benchmark is SPY.

States are `BUY_ZONE`, `TRIGGERED_UNCONFIRMED`, `ARMED`, `UNVERIFIED`, `FORMING`, `EXTENDED`, `RISK_OFF` and `INVALIDATED`. Missing live quotes, bid/ask depth, circuit bands or verified results coverage blocks entry. India requires Breeze live execution data. Results within three trading sessions block new entries.

Server-held Armed plans freeze levels and gate evidence in immutable versions. Pending buy-stops require a same-session `ARMED` plan captured within 30 minutes. Direct Armed purchases require a matching `BUY_ZONE` plan and a purchase price within its trigger/limit band, subject to rounding tolerance.

Strong Swing and Momentum purchase validation likewise uses stored execution plans: actionable status, matching stock/market/strategy, current session, capture age at most 30 minutes, and a price inside the entry band - at or above entry + 0.25 ATR and at or below entry + 0.75 ATR, each within tolerance - and below target. The band's two edges are mirrored from the engine so the screen and the ledger cannot disagree.

## Trade Ledger and broker behavior

- Purchases, edit/delete, partial/final sales and sale correction.
- Direction-aware protection: long stops only tighten upward and short stops only tighten downward.
- Completed-close strategy exit lines and explicit planned first-target scale-outs for the five named strategy tags.
- Immutable purchase plans and current risk/news assessment.
- Pending buy-stop records with a default seven-calendar-day validity.
- Fill validation checks price band, remaining quantity and fill dates. Each confirmed partial fill creates its own purchased trade in the same database transaction.
- Unfilled pending orders have no position, capital employed or P&L. Cancelling the remainder preserves previous fills.
- Broker-reconciled acquisition value, proceeds and realized profit.
- Capital-employed ROI and annualized XIRR, with retained sale proceeds recycled before inferring new external capital.
- Breeze read-only holdings/positions/orders synchronization.
- Separately enabled automatic buying with spending limits and order intents for Strong Swing and saved Adaptive Allocation strategies; no automatic selling/rebalancing.

Recording a pending order or ledger fill does not submit a broker order.

## Measurement: does any of this work?

Three separate mechanisms answer that question, and they are deliberately different in kind.

**Historical replay** (`pipelines/strong_swing_replay.py`) runs the live engine itself over a decade
of daily history and grades every day it would have called EXECUTION_READY, entering at the next
session's open. It calls the same `assess` the screen calls rather than reimplementing the strategy,
and no bar after the signal date ever reaches the engine - a test asserts that against a real scan.
Three gates cannot be judged from history, because no broker quote was ever recorded for past days:
live quote, live spread and live circuit. Each run records which gates it could evaluate. The
benchmark series is the binding limit on how far back a replay reaches, since a day with no
benchmark behind it fails the benchmark gate.

The current India run covers 612 graded trades from 2017 to 2026 at a 49.3% win rate and +0.54% per
signal, held to a 20-session horizon. **Those figures are shown on the Strong Swing screen beside
the Buy button**, with their caveats stated: before brokerage, taxes and slippage; delisted stocks
are absent from the sample, which flatters every figure; and the gates that could not be replayed
make live trading stricter than the record. The note also warns when a stored run was measured under
an earlier model version than the one the gates are currently using.

**Intraday entry study** (`pipelines/intraday_entry_study.py`) re-grades a stored replay run against
one-minute Breeze candles, to ask what the screen offers that the replay does not. This is what
established that the entry band only pays on days that gapped into it, and produced the v8
`entry_open` gate. It must normalise each Breeze session onto the adjusted daily scale before
comparing: daily history is split- and dividend-adjusted while Breeze returns raw traded prices, and
for a 2017 signal those differ by a third.

**Strategy retrospective** (`pipelines/strategy_retrospective.py`) is explicitly *not* a
reconstructed backtest. It grades only signals the production app actually recorded at the time,
entering at the next observed session open. It is the narrowest and most trustworthy of the three,
and correspondingly the smallest sample.

## Accounts, access and operations surfaces

Web sessions use signed HTTP-only cookies. The system supports login, password reset by token, and
invitation-based account creation; one account is the designated system owner and administrator.
`/data/health` reports provider coverage, quote and depth freshness, calendar coverage and provider
failures. `/admin/sync` exposes ingestion controls. Authenticated pages offer opt-in browser
notifications for candidate-ready transitions and material open-trade actions.

Scheduled work runs under a Node supervisor started by `npm run dev` and `npm start`; bare Next.js
scripts do not run it. Cron-style HTTP handlers under `/api/cron/` cover scans, quote refresh,
screener refresh, backfills for NSE, BSE and US, news intelligence, mobile alerts, Gmail disclosures,
forward tests, the Breeze auto-buy evaluator and the email digest. They authenticate with a
configured bearer secret.

## Funds, credentials and automation

CAS import preserves ISIN/folio identities. AMFI bridges fund identifiers to AMC snapshots; Fund Mapping exposes composition and cross-fund overlap. Gmail discovery can process the latest CAS and matching AMC disclosures automatically when auto-import is enabled; ambiguous documents need review. Revoked grants set reconnect state, and scan errors/timestamps are surfaced.

Secrets are encrypted per user with AES-256-GCM. Settings responses expose configuration metadata and presence flags rather than decrypted credentials. SMTP, AI/news, Breeze and Gmail integrations retain distinct credential paths.

The Node wrapper coordinates market data, repair queues, fundamentals, macro, scans, forward tests, AMFI, news, mobile alerts, Gmail, results calendars and ML snapshots. Email defaults to 07:00 IST and uses saved per-user SMTP credentials plus India Strong Swing/Probability results. See [email setup](docs/EMAIL_SETUP.md) for scheduling and retry limits.

Candidate scans evaluate every account whether or not it has an enabled Expo token. They persist status observations, refresh prioritized live-market targets and send a push only when an eligible enabled token exists. During an open India session, Momentum execution readiness requires both a fresh `BREEZE_LIVE` quote and a valid current-session Breeze OHLCV row with positive volume. Missing evidence leaves the candidate visible but execution-blocked.

## Mobile

Expo SDK 57 / React Native 0.86.3 consumes versioned server APIs. Implemented features include secure login, India/US workspaces, server-ranked Strong Swing and News & AI, ledger mutations, candles, biometric re-entry and opt-in push.

Authenticated web pages also provide opt-in browser notifications for candidate-ready transitions and material open-trade actions. They use one server event per signature and market day, stable browser tags, and single-tab polling to prevent duplicate delivery while an InvestoGenie tab remains open. Candidate alerts are evaluated only during the relevant open market session, are discarded before delivery if the candidate is no longer ready, and link to the exact strategy section that produced them.

Ledger push text is generic. Ready-candidate push text includes ticker, readiness state and engine; Expo receives that text and the push token. Prices, quantities and broker details are excluded. See [privacy](mobile/PRIVACY.md).

Local Prebuild/Gradle/Xcode is the documented distribution path. Release validation requires an explicitly supplied HTTPS API URL and aligned app/package/build metadata. Generated Android and iOS projects compile locally; signing and physical-device installation are still required to establish the behavior of a distributed binary.

## ML and operational limits

The ML foundation provides schema, scheduled snapshots, deterministic Python features/labels and golden vectors. Training/calibration, promotion automation, monitoring enforcement and inference remain design contracts rather than complete runtime implementations. ML does not currently control candidate eligibility or broker execution.

Migrations extend through 0083. Migration 0077 adds versioned market-specific volume curves, 0078 records the exact Strong Swing benchmark used by a capture, 0079 adds durable email-delivery and mobile-mutation idempotency, 0082 adds the Strong Swing historical replay tables and 0083 records whether a replayed day was a near miss. The Linux release script discovers and applies migrations from 0033 onward after assuming an existing earlier schema, and re-executes the checked-out script once after pulling so migrations introduced by that release are not skipped. Provider quotas and continuing runtime health remain deployment-specific.

See [AI review handoff](AI_REVIEW_HANDOFF.md), [architecture](ARCHITECTURE.md), [status](STATUS.md), [deployment](DEPLOYMENT.md), [ML methodology](docs/ml-methodology.md) and [swing strategy rules and review](docs/swing-strategies.md).
