# InvestoGenie Status

_Code review: 25 October 2026. Source revision: `42eea8f3045a0114345d3df00d3733d783ee34d8` on main._

This is a repository status reference. No production host, live database, broker account or installed mobile binary was inspected for this update. Earlier deployment dates, account balances and coverage measurements do not establish current runtime state.

## Implemented in the reviewed source

- Next.js 16.4.2 / React 19.2.4 web application with India/US terminal routes.
- Fundamental/price-action Stock Screener, natural-language filtering, saved screens and exports.
- Swing, Strong Swing, legacy/V2 Momentum Ignition, News & AI, Long-Term and Probability research surfaces.
- Armed Strong Swing at `/terminal/[market]/armed-swing`, separate from the existing Strong Swing gates/rankings.
- Immutable Armed and protected execution plans, with server-side ownership/session/status/price validation.
- Ledger pending buy-stops, partial fills, remaining-quantity tracking and cancellation.
- Broker-reconciled cash flows, retained-proceeds capital employed, ROI and XIRR.
- Cost-aware Adaptive Allocation backtests and separately enabled capped Breeze buy-only automation.
- CAS/AMFI fund mapping, AMC disclosures, fund overlap and optional Gmail auto-import.
- Gmail revoked-grant detection and connection error/reconnect state.
- Server-authoritative Expo mobile client with ledger mutations, News & AI, candles, biometrics and deduplicated alerts.
- Python ML snapshot/feature/label foundation with golden-vector tests; no complete model training/inference runtime.

## Latest schema additions

| Migration | Purpose |
| --- | --- |
| 0051 | ML advisory foundation |
| 0052 | Corporate results calendar and sync state |
| 0053 | Immutable Armed Swing plans |
| 0054 | Pending buy-stop orders and fill audit |
| 0055 | Protected Strong Swing/Momentum execution plans |
| 0056 | Authoritative results-calendar coverage window |
| 0057 | Gmail last-error timestamps and reconnect flag |

The shared Linux release script applies an explicit 0033–0057 list. Fresh databases still need the full ordered schema. `scripts/verify-production-schema.mjs` checks required relations plus authoritative-calendar and Gmail-health columns.

## Current behavior that matters operationally

Armed entries fail closed when live execution evidence or results coverage is missing. India requires `BREEZE_LIVE`; calendar verification can use a complete same-day authoritative NSE window or usable dates under the fallback coverage policy. A successful request with no usable date is insufficient on its own.

Pending orders are application records, not broker submissions. They carry no holdings/P&L until a user records a confirmed fill. Each partial fill becomes a separate purchased ledger trade while the remainder stays pending.

The scheduler wrapper is used by both `npm run dev` and `npm start`. Bare Next.js scripts do not run those schedules. Corporate results refresh is scheduled at 07:00 and 17:00 IST with startup work; the official NSE calendar is attempted before the Yahoo supplement.

The digest scheduler uses one global target time, default 07:00 IST, with catch-up and bounded retries. Although per-user `send_time` and `last_sent_at` are stored, the sender selects all enabled users without enforcing those fields. Retrying a partial batch can resend to users who already received it.

Mobile candidate pushes disclose ticker/readiness/engine to Expo, while ledger alerts remain generic. The documented local build path coexists with EAS Build scripts/configuration. App metadata is 0.1.1, Android version code 2, iOS build 2; package version remains 0.1.0.

## Verification available in the repository

```bash
npm test
npm run lint
npm run build
npm run deploy:check:local
```

Mobile:

```bash
cd mobile
npm run typecheck
npm run validate:release
```

Focused tests exist for Armed Swing, plan validation, pending fills, execution plans, results-calendar ingestion, Gmail token errors and ML features/labels, alongside the wider analytics suite. Python tests are present in `pipelines/`, `workers/` and `scripts/`; they are not all invoked by `npm test`.

The Linux release runs production dependency audit, build and schema verification, then restarts services and checks `/login`. Tests and lint are separate pre-release steps. No application test run or provider-backed verification is claimed by this documentation review.

## Remaining work and runtime checks

- Verify the deployed revision and schema through 0057 on the intended host.
- Inspect Data Health, quote/depth freshness, calendar coverage and provider failures.
- Review unresolved CAS/fund mappings and Gmail documents needing manual review.
- Confirm daily Breeze session validity and separately authorized buying limits.
- Validate a newly generated mobile binary on physical devices; source metadata is not install evidence.
- Implement and validate ML training, calibration, serving and monitoring before treating the design contract as an active model.
- Check email retry/deduplication behavior before relying on exactly-once delivery or individual send times.

See [capabilities](CAPABILITIES.md), [architecture](ARCHITECTURE.md) and [deployment](DEPLOYMENT.md).
