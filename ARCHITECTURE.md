# InvestoGenie Architecture

_Source and production baseline reviewed 26 October 2026 through runtime revision `1c7aac3`._

## System flow

```text
Exchange / Yahoo / Google / FRED / news / Breeze / AMFI / Gmail
                       |
             Node scheduler + Python jobs
                       |
                   PostgreSQL
                       |
        Next.js pages, actions and API routes
                  /                \
             Web terminal       Expo mobile client
```

The web stack is Next.js 16.4.2 App Router, React 19.2.4 and TypeScript. PostgreSQL is accessed through `pg`. Tailwind CSS 4, Lightweight Charts and Three.js support presentation. Mobile uses Expo ~57.0.24 / React Native 0.86.3; financial analytics remain server-owned.

## Repository boundaries

| Path | Responsibility |
| --- | --- |
| `app/` | Pages, server actions, cron handlers and mobile APIs |
| `components/` | Web presentation |
| `lib/analytics/` | Signal, ranking, risk and strategy calculations |
| `lib/screener/` | Fundamental/price-action snapshot and filter engine |
| `lib/news/` | Provider aggregation, evidence and classification |
| `lib/cas/`, `lib/funds/`, `lib/gmail/` | Portfolio parsing, identifiers, snapshots and disclosure processing |
| `lib/breeze/` | Broker integration and execution safety |
| `lib/backfill/` | Persistent OHLCV repair |
| `lib/mobile*.ts` | Sessions, ledger API support and notifications |
| `pipelines/`, `workers/` | Python ingestion and broker workers |
| `pipelines/ml/` | Deterministic ML feature collection and labels |
| `scripts/` | Scheduling, ingestion and operational checks |
| `db/migrations/` | Ordered schema through 0059 |
| `mobile/` | Isolated React Native client |
| `deploy/` | macOS and Ubuntu service/deployment packages |

The [README route table](README.md#workspaces) maps each workspace. In particular, `stocks` is the filter/NL Stock Screener, `screener` is ordinary Swing Candidates, and `armed-swing` is the earlier Armed workflow.

## Calculations and candidate flow

`swingClassifier.ts` and `legendaryStrategies.ts` produce technical setups persisted in `swing_signals`. User risk settings, Strong Swing confirmation/execution gates and `candidateRanking.ts` produce ranked candidates. News & AI adds bounded source evidence to existing setups.

Momentum Ignition legacy and V2 have separate discovery modules. Armed Swing has a separate pure assessment in `lib/analytics/armedSwing.ts` and database loader in `lib/armedSwing.ts`. The loader scans market-relative strength and near-pivot candidates, then assesses at most 250 shortlisted stocks. It excludes the in-progress bar from base construction and uses live volume only for breakout pace.

Momentum discovery likewise separates completed history from the current-session bar. During an open India session, entry-ready classification requires a fresh `BREEZE_LIVE` quote plus the matching Breeze intraday OHLCV/volume row; otherwise the setup remains visible but execution-blocked. Scheduled candidate scans run for every account independently of Expo push-token registration, persist status transitions in `candidate_signal_observations`, and refresh `live_market_targets`. The Breeze worker reconciles its bounded subscription set every two minutes so newly discovered candidates receive live bars without a service restart.

Armed actionability depends on live execution quotes, bid/ask, circuit bands, liquidity, structure, regime and verified results-calendar coverage. India requires a fresh `BREEZE_LIVE` quote. Missing evidence produces unverified or blocked states. Results within three trading sessions block entries.

`pipelines/corporate_results_sync.py` imports the official NSE event calendar and supplements dates through Yahoo. Authoritative negative coverage requires a complete same-day window covering the required sessions; an empty Yahoo result alone does not verify safety.

Long-term, probability and Universal Portfolio calculations live in their own analytics modules. Adaptive Allocation is a research/backtest surface with saved strategies that can separately supply the explicitly enabled Breeze buy-only workflow.

## Immutable plans and ledger writes

`lib/armedSwingPlans.ts` persists immutable Armed calculations, including status, levels, ATR, gates and a five-minute capture bucket. Actions load plans by ID and user ownership rather than trusting browser-submitted levels.

- Pending Armed buy-stops require a same-session `ARMED` plan captured within 30 minutes.
- Direct Armed purchases require a matching `BUY_ZONE` plan and purchase date, with a fill inside the frozen trigger/limit band subject to tolerance.
- `lib/swingExecutionPlans.ts` persists Strong Swing/Momentum plans. Purchase validation checks matching asset/market/strategy, actionable state, current session, capture age and price range.
- Edits cannot move protected purchases below their frozen entry/trigger.

Pending-order actions in `app/terminal/[market]/trade-ledger/pendingOrderActions.ts` record orders without placing broker instructions. Default validity is seven calendar days. Fill recording locks the order row, validates remaining quantity/price/date, inserts a purchased ledger trade and fill audit, then updates the remainder atomically. Each partial fill is a separate trade; cancellation preserves filled trades.

Ledger projection/risk calculations are shared through `lib/swingTradeProjection.ts` and `lib/swingTradeLedger.ts`. Cash-flow accounting distinguishes turnover from external capital after retained proceeds are reused. ROI and XIRR use that capital model. Broker reconciliation and explicitly enabled capped NSE cash limit buying are separate paths; no automatic selling/rebalancing is implemented.

## News and fund data

News providers are queried independently and successful results merged. Watermarks, canonical deduplication and corroboration preserve provenance. Priority starts with open ledger trades, then Strong Swing, then broader Swing. Evidence quality and stock specificity constrain risk assessment; broad or unverified stories are cautionary.

CAS holdings use user/ISIN/folio identities. Explicit mappings and AMFI identifiers link them to AMC snapshots for look-through and overlap. Gmail uses read-only OAuth and encrypted tokens; enabled auto-import processes suitable CAS and disclosures, while ambiguous matches remain reviewable. Attachment bytes and email bodies are not retained as document storage. Revoked grants set `needs_reconnect`; scan failures record the latest error and timestamp.

## Schedulers and providers

`scripts/run-with-nse-sync.mjs` supervises Next.js and jobs under `dev`/`start`. Bare Next.js scripts skip this wrapper.

Schedules cover market-hours priority quotes, EOD Bhavcopy/history, repair queues, fundamentals, macro, AMFI, scans, forward tests, news, Gmail, mobile alerts, email and ML snapshots. Corporate results run at 07:00/17:00 IST plus startup work. Breeze can be embedded or supervised separately.

India live quotes prefer Breeze, with Yahoo/Google/exchange fallback elsewhere. Bhavcopy maintains EOD history; US recurring history uses Yahoo. The optional Tiingo history module is separate from that recurring Python path. Market-calendar helpers support session-aware freshness.

Email defaults to 07:00 IST with wrapper catch-up and retry limits. The actual digest uses per-user encrypted SMTP and India Strong Swing/Probability results. Stored user send times and last-sent timestamps are not enforced by the sender's enabled-user query; partial retries can duplicate successful deliveries.

## Mobile and secrets

Mobile APIs are under `/api/v1/mobile/`: login/logout, me, Strong Swing, News & AI, ledger and sale mutations, asset search, candles and push registration. Random 256-bit device tokens are held in SecureStore; the server stores SHA-256 hashes with 30-day expiry and revocation. Biometrics guard restored sessions when available.

Expo receives push tokens and notification text. Ledger alerts are generic; candidate alerts contain ticker, engine and readiness. Candidate details exclude price, quantity and portfolio/broker values. Notifications do not place orders.

App metadata is 0.1.1, Android version code 2 and iOS build 2; `mobile/package.json` remains 0.1.0. The documented local build path is Expo Prebuild then Gradle/Xcode. EAS scripts/configuration remain in source, and release validation checks EAS profile URLs; it does not prove a locally built binary uses the right URL.

Web sessions use signed HTTP-only cookies. Credentials use AES-256-GCM with a scrypt-derived key and random IV; `getUserCredentials()` returns metadata/presence flags. Server-only resolvers decrypt secrets when needed. Cron callers send the configured bearer secret; handlers must be reviewed individually rather than assumed to share identical checks.

## ML foundation

Migration 0051 defines snapshots, labels, models, promotion evidence, serving pointers and monitoring records. Node captures canonical Strong Swing candidates and invokes Python feature collection. Python implements features and first-touch labels with golden vectors.

Training, calibration, inference, model promotion and drift-response automation are specified in [the methodology contract](docs/ml-methodology.md), but complete runtime pipelines are not present. Schema existence does not establish an active model or monitoring service.

## Deployment and verification

Ubuntu packages use systemd, Nginx, external environment configuration and private PostgreSQL. The historical `deploy/oracle/` path also supports AWS hosts. macOS uses launchd and optional Tailscale access.

The release script fetches main, then re-executes the checked-out script once so the current release logic is used. It installs/audits/builds/prunes Node dependencies, installs Python requirements, applies an explicit 0033–0059 migration list, verifies required schema including candidate observations, installs service units, restarts and checks login. It assumes the earlier schema and does not execute lint/tests.

Use `npm test`, `npm run lint`, `npm run build` and deployment checks before promotion. Mobile has separate typecheck/release validation; Python suites need separate execution. Runtime coverage, installed builds and production revision require host/database inspection.

Heavy jobs share the web service process tree unless separately managed. Provider limits, missing execution depth, incomplete statements/fund mappings, Expo relay dependence and unfinished ML lifecycle runtime remain operational boundaries.
