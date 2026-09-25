# InvestoGenie

InvestoGenie is a self-hosted market intelligence and trade-management platform for Indian and US
equities. It combines technical screening, execution-gated Strong Swing candidates, source-linked
News & AI analysis, long-term fundamentals, live market data, mutual-fund look-through, and a
broker-reconciled trade ledger in one server-authoritative system.

The active production deployment runs on AWS Lightsail. The same codebase supports local macOS
development and an alternate Ubuntu/Oracle-compatible deployment.

## Current Production

- Next.js 16.3 App Router, React 19 and TypeScript.
- PostgreSQL as the system of record; direct access through `pg`.
- AWS Lightsail with systemd, Nginx/HTTPS and recurring ingestion workers.
- India-first market coverage with NSE/BSE trading-session and holiday awareness.
- ICICI Breeze for priority live market data and read-only broker reconciliation.
- Bhavcopy, Yahoo and Google fallbacks plus exchange-close OHLCV maintenance.
- Android/iOS client backed by versioned server APIs; analytics remain on the server.
- Current product revision: `9f77b09`; documentation follows `main`.

Detailed live status is maintained in [STATUS.md](STATUS.md), capabilities in
[CAPABILITIES.md](CAPABILITIES.md), and system boundaries in [ARCHITECTURE.md](ARCHITECTURE.md).

## Core Workspaces

| Workspace | Purpose |
| --- | --- |
| Market overview | India/US quotes, breadth, charts and market context |
| Stock Screener | Fundamental and price-action filters, presets, saved screens and exports |
| Swing Candidates | Broad strategy discovery with frozen entry, target, stop and holding window |
| Strong Swing | Stricter execution-readiness, liquidity, regime and exchange-safety gates |
| News & AI Swing | Strong Swing base with bounded, source-linked event intelligence |
| Long-Term Candidates | Multi-year financial evidence and investor-inspired rankings |
| Probability | 21-session return distribution, upside probability and drawdown range |
| Trade Ledger | Purchases, partial/final sales, revised plans, news risk, P&L, ROI and XIRR |
| Fund Mapping | CAS holdings, AMFI identities, AMC disclosures and stock-overlap analysis |
| Data Health | Source freshness, coverage gaps, backfill queue and repair controls |

## Trade Ledger Accounting

The ledger stores gross trade data and broker-reconciled acquisition value, sale proceeds and
realized P&L. It distinguishes:

- **Capital employed:** external capital inferred chronologically after recycling retained sale
  proceeds.
- **Trade turnover:** cumulative acquisition value across every purchase.
- **ROI:** overall P&L divided by capital employed; it is not annualized.
- **XIRR:** annualized money-weighted return using dated capital additions and ending retained
  cash plus current open-position value.

The ICICI Direct reconciliation through 22 September 2026 currently records INR 3,83,657.44 of
capital employed, INR 8,76,695.04 of trade turnover and INR 22,712.85 of realized profit. This is
5.92% ROI over 18 August-22 September 2026; the short-period XIRR is 170.91% annualized.

Trade-ledger accounting does not alter Swing, Strong Swing, News & AI, target, stop or ranking
calculations.

## Data And Automation

The scheduler in `scripts/run-with-nse-sync.mjs` runs alongside Next.js and coordinates:

- five-minute priority quote/OHLCV refreshes during Indian and US market hours;
- ledger/visible/actionable-stock priority ordering for bounded intraday provider calls;
- hourly ledger-focused news assessment during active sessions;
- NSE/BSE and US exchange-close quote/history synchronization;
- market-calendar-aware freshness and catch-up jobs;
- persistent OHLCV backfill workers and auditable exclusions;
- fundamentals, macro, swing-scan and forward-test maintenance;
- daily Strong Swing email digest;
- Gmail discovery for the latest CAS and AMC monthly disclosures.

Provider credentials are encrypted per user where supported. Secrets and production environment
files are never committed.

## Main Routes

| Route | Purpose |
| --- | --- |
| `/terminal/in` | India terminal |
| `/terminal/us` | US terminal |
| `/terminal/[market]/stocks` | Stock screener |
| `/terminal/[market]/strong-swing` | Strong Swing and Momentum Ignition |
| `/terminal/[market]/news-swing` | News & AI Swing |
| `/terminal/[market]/trade-ledger` | Trade Ledger and broker reconciliation |
| `/terminal/[market]/long-term` | Long-Term Candidates |
| `/terminal/[market]/probability` | Probability workspace |
| `/portfolio/fund-mapping` | CAS/AMC mapping and fund overlap |
| `/data/health` | Data coverage and backfill health |
| `/settings` | User, provider, Breeze and Gmail settings |
| `/help` | Product and methodology guides |

## Technology

| Layer | Technology |
| --- | --- |
| Web/API | Next.js 16.3, React 19, TypeScript |
| Mobile | React Native / Expo SDK 57, locally generated native projects |
| Database | PostgreSQL |
| UI | Tailwind CSS 4, Lightweight Charts |
| Ingestion | Node.js and Python workers |
| Production | AWS Lightsail, systemd, Nginx, HTTPS |
| Authentication | Signed web sessions and hashed expiring mobile tokens |
| Credential storage | AES-256-GCM encrypted per-user secrets |

## Local Development

Requirements: Node.js, Python 3, PostgreSQL, and the environment variables documented in
`.env.example`.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Useful verification commands:

```bash
npm test
npm run lint
npm run build
```

The current suite contains 238 passing tests across 33 files. Integration tests require the local
PostgreSQL test environment.

## Deployment

Production releases are committed to `main`, pushed to GitHub, and deployed on AWS with:

```bash
sudo bash /opt/investogenie/app/deploy/oracle/deploy-release.sh
```

The historical directory name is retained for compatibility; the script is the active shared
Ubuntu deployment path for AWS and Oracle-compatible hosts. It installs locked dependencies,
builds the application, applies migrations through `0046_trade_ledger_returns.sql`, verifies the
schema, and restarts `investogenie.service`.

See [DEPLOYMENT.md](DEPLOYMENT.md), [deploy/local/README.md](deploy/local/README.md), and
[deploy/oracle/README.md](deploy/oracle/README.md).

## Mobile

The mobile client displays the same server-ranked Strong Swing and News & AI candidates and the
same server-calculated ledger results. Approved builds are generated locally with Expo Prebuild and
then signed through Gradle/Android Studio or Xcode; source is not uploaded to EAS Build and Expo
Updates is not enabled.

See [mobile/README.md](mobile/README.md) and [mobile/PRIVACY.md](mobile/PRIVACY.md).

## Important Boundary

InvestoGenie is a personal research and trade-management system. Targets, stops, probabilities,
news classifications and AI assessments are decision support, not guarantees or autonomous broker
instructions. Broker/exchange restrictions and executable order state must still be confirmed.
