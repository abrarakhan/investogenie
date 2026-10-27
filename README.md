# InvestoGenie

InvestoGenie is a self-hosted market research and trade-management application for Indian and US equities. Next.js serves the web terminal and mobile APIs; PostgreSQL stores market data, user portfolios, frozen trade plans and operational history.

_Code and production baseline reviewed 26 October 2026 through runtime revision `1c7aac3`. See [STATUS.md](STATUS.md) for the dated verification boundary._

## Workspaces

| Route | Purpose |
| --- | --- |
| `/markets/in`, `/markets/us` | Market overview and charts |
| `/terminal/[market]` | India (`in`) or US (`us`) terminal |
| `/terminal/[market]/stocks` | Fundamental and price-action Stock Screener, saved screens, natural-language queries and exports |
| `/terminal/[market]/screener` | Buy-side Swing Candidates; India is NSE-only and capped to the top 20 |
| `/terminal/[market]/strong-swing` | Strong Swing, legacy/V2 Momentum Ignition and Python Trend Continuation observation |
| `/terminal/[market]/armed-swing` | Earlier pre-breakout Armed Strong Swing plans |
| `/terminal/[market]/news-swing` | Strong Swing with source-linked news and AI assessment |
| `/terminal/[market]/trade-ledger` | Purchases, pending buy-stops, partial fills/exits, reconciliation and returns |
| `/terminal/[market]/long-term` | Multi-year fundamentals and investor-inspired rankings |
| `/terminal/[market]/probability` | 21-session probability forecasts |
| `/terminal/[market]/adaptive-allocation` | Cost-aware two-asset backtests and saved strategies |
| `/terminal/[market]/forward-test` | Forward measurement of recorded signals |
| `/terminal/in/cas`, `/portfolio/fund-mapping` | CAS import, Gmail disclosures, AMFI mapping and fund overlap |
| `/data/health`, `/admin/sync` | Freshness, coverage and ingestion health |
| `/settings`, `/help` | Account/provider configuration and product guidance |

## Execution and accounting

Analytics run on the server. Strong Swing and Momentum purchase flows use stored execution plans; Armed Swing stores its own immutable trigger, limit, stop, target and gate snapshot. Pending buy-stops are ledger records: creating one sends no broker order and creates no position or P&L. Confirmed partial fills create separate purchased trades while preserving the unfilled remainder.

Armed setups require verified results-calendar coverage and live execution data. Missing evidence blocks actionable states. India execution quotes require `BREEZE_LIVE`; a fallback quote alone cannot authorize an Armed entry.

The ledger separates cumulative purchase turnover from external capital employed after recycling retained sale proceeds. ROI uses capital employed; XIRR uses dated contributions and terminal cash plus open-position value. Broker-reconciled acquisition/proceeds/P&L can replace gross values.

Breeze automatic buying is a separate, disabled-by-default, explicitly enabled path for capped NSE cash limit buys from Strong Swing and saved Adaptive Allocation strategies. It does not automatically sell or rebalance. Research projections and notification delivery do not place orders.

## Stack

| Layer | Repository dependency/configuration |
| --- | --- |
| Web | Next.js 16.4.2, React 19.2.4, TypeScript |
| UI | Tailwind CSS 4, Lightweight Charts, Three.js |
| Database | PostgreSQL through `pg` |
| Mobile | Expo ~57.0.24, React Native 0.86.3, React 19.2.3 |
| Jobs | Node scheduler and Python pipelines/workers |
| Credentials | AES-256-GCM per-user encrypted secrets |
| Deployment package | macOS launchd or Ubuntu systemd/Nginx; Linux scripts support AWS/Oracle hosts |

## Local setup

The supplied local commands target macOS/Linux. Use a current compatible Node.js runtime, Python 3 and PostgreSQL; several package scripts expect `.venv/bin/python`.

```bash
cp .env.example .env.local
npm ci
python3 -m venv .venv
.venv/bin/pip install -r pipelines/requirements.txt -r workers/requirements.txt
```

Create the database named in `DATABASE_URL`. Set distinct random `SESSION_SECRET`, `CRON_SECRET` and `CREDENTIAL_ENCRYPTION_KEY` values. Set one nonempty `NEXT_PUBLIC_APP_URL` (the example currently contains two declarations, so remove or replace the blank one). For a fresh database, apply the ordered SQL migrations before starting; see [local setup](deploy/local/README.md).

```bash
npm run deploy:check:local
npm run dev
```

Open `http://localhost:3000`. Both `npm run dev` and `npm start` run the scheduler wrapper. `dev:next` and `start:next` start only Next.js.

## Jobs and providers

The wrapper coordinates market-hours quotes, EOD ingestion, history repair, fundamentals, macro, AMFI, scans, forward tests, news, email, mobile alerts, Gmail processing, results calendars and scheduled ML snapshots. Breeze supplies live India data; exchange Bhavcopy, Yahoo/Google and FRED support the other ingestion paths. News providers include Marketaux, GNews, NewsAPI and Alpha Vantage.

Momentum scans run during market hours even when an account has no registered push device. India actionability uses a separately verified current-session Breeze OHLCV/volume bar; completed history remains immutable during the session. Candidate state changes are retained for audit, while push delivery still requires an enabled mobile token.

The ML implementation is a Python feature/label foundation and lifecycle schema. The repository does not include a complete training, promotion or inference pipeline. See [ML methodology](docs/ml-methodology.md).

## Verification and deployment

```bash
npm test
npm run lint
npm run build
```

Database checks need a configured PostgreSQL instance. Linux releases use `deploy/oracle/deploy-release.sh`; it applies its explicit migration list from 0033 through 0059 and assumes the earlier schema already exists. After updating the checkout, it re-executes the checked-out release script once so same-release migration additions are honored. It runs dependency audit/build/schema checks, but does not run the test suite.

See [architecture](ARCHITECTURE.md), [capabilities](CAPABILITIES.md), [status](STATUS.md), [deployment](DEPLOYMENT.md), [Stock Screener](README-screener.md), [email setup](docs/EMAIL_SETUP.md), and [mobile](mobile/README.md).
