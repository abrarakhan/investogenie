# InvestoGenie external AI review handoff

_Prepared 14 November 2026 against deployed revision `f33f256`._

## Review objective

Review InvestoGenie for correctness, safety, data integrity, timing, coverage and maintainability. Separate defects from strategy preferences. Do not recommend loosening a fail-closed gate merely to produce more candidates. Every proposed financial-logic change should state the expected benefit, failure mode, evidence required, affected policy/model version and replay/forward-test plan.

InvestoGenie is a self-hosted India/US market-research and trade-ledger application. It is not an exchange or broker. Most actions record plans or ledger events; Breeze auto-buy is a separately enabled, capped India cash-limit path. There is no automatic selling.

## Read these files first

| Order | File | Purpose |
| --- | --- | --- |
| 1 | `AGENTS.md` | Repository rules, protected financial logic and deployment safety |
| 2 | `ARCHITECTURE.md` | Runtime boundaries, data flow and ownership |
| 3 | `docs/swing-strategies.md` | Exact Swing, Strong Swing, Armed and named-strategy rules |
| 4 | `docs/ml-methodology.md` | ML production contract and what is not implemented |
| 5 | `STATUS.md` | Dated source and production evidence |
| 6 | `CAPABILITIES.md` | Implemented product behavior |
| 7 | `DEPLOYMENT.md` | Promotion, migration and service boundaries |

Source code wins when documentation disagrees.

## Current production boundary

| Item | State at review handoff |
| --- | --- |
| Revision | `f33f256` on `main`, deployed to AWS Lightsail |
| Web/Breeze services | Active at the recorded check |
| Public health | HTTPS `/login` returned HTTP 200 |
| Schema | Migrations through 0077; production schema verification passed |
| India results calendar | 2,943/2,945 active NSE assets verified (99.93%) |
| India Armed volume curve | `in-median-2026-09-16-2026-11-13-40s`; 1,425 complete asset-sessions, 40 sessions |
| US Armed | Fail-closed: no US execution-depth/intraday provider |
| Strong Swing forward evidence | Five genuine scheduled v4 captures still required |
| ML serving | No validated serving assignment established |

The India curve uses Breeze historical one-minute candles. A short special session was excluded because it did not meet the full-session completeness rule. Breeze does not supply US equities.

## Calculation ownership

| Domain | Authority |
| --- | --- |
| Strong Swing and Momentum engines | Python under `pipelines/strategy_math/`; TypeScript is input/loading or a test oracle |
| Trend Continuation | Python persistence and execution gates |
| Base Swing and named-strategy tags | TypeScript under `lib/analytics/` |
| Armed Strong Swing | TypeScript `lib/analytics/armedSwing.ts` plus database loader |
| Ledger projection/follow-up | Server TypeScript `lib/swingTradeProjection.ts`, `lib/swingTradeLedger.ts` |
| ML features and labels | Python only |
| Web/mobile | Render server-produced results; must not independently calculate trades |

## High-impact invariants to review

1. Calculations that need a close or full-day volume use completed sessions; live quotes are a separate execution overlay.
2. Strong Swing independently recomputes ATR, breakout-bar evidence, entry, stop, target, invalidation and results blackout.
3. Purchase actions load immutable server plans and reject stale versions, mismatched assets/statuses and out-of-band prices.
4. India actionability requires fresh Breeze execution evidence where specified; missing evidence blocks rather than falls back.
5. Armed volume pace uses an active market-specific curve backed by at least 40 complete sessions.
6. Results safety requires an explicit upcoming result date or authoritative coverage spanning the entire three-session blackout window.
7. Long stops only tighten upward; short stops only tighten downward.
8. EMA/SMA strategy exits require a completed-close crossing and do not replace catastrophic live broker protection.
9. Simons moving targets are accepted only on the profitable side of entry for the trade direction.
10. Browser, mobile and email notifications do not create eligibility or place orders.

## Strategy lifecycle versions

| Contract | Version |
| --- | --- |
| Strong Swing model | `strong-swing-v4-breakout-bar` |
| Strong Swing feature contract | `strong-swing-features-v2` |
| Strong Swing label | `strong-swing-first-touch-v1` |
| Legendary strategies | `legendary-v2-2026-11-14` |
| Armed Swing | `armed-v3-2026-11-14` |
| India volume curve | `in-median-2026-09-16-2026-11-13-40s` |

Any threshold, feature, label, entry, trailing, inclusion or calibration change needs a new version and fresh evidence.

## Validation already performed

| Check | Result |
| --- | --- |
| TypeScript/Vitest | 573 passed |
| Pipeline Python unittest discovery | 91 passed |
| Worker Python unittest discovery | 77 passed |
| TypeScript typecheck | Passed |
| ESLint | Passed |
| Next.js production build | Passed |
| Migration 0077 and schema verifier | Passed in production |
| Production services and HTTPS login | Passed at the recorded check |

Tests prove coded behavior, not profitability or continuing provider health.

## Known open evidence and enhancement areas

| Priority | Area | Current boundary | Suggested review question |
| --- | --- | --- | --- |
| High | Strong Swing forward evidence | Fewer than five post-v4 scheduled captures | Are candidate rate, precision, expectancy and calibration acceptable without changing gates post hoc? |
| High | US Armed | No US depth/circuit-halt/intraday source | Which licensed provider supplies point-in-time bid/ask, halts and intraday volume with auditable timestamps? |
| High | ML lifecycle | Schema/features/labels exist; training, calibration, serving and drift automation incomplete | What is the smallest production implementation that satisfies `docs/ml-methodology.md` without affecting eligibility? |
| High | Auto-buy safety | India buy-only, explicitly enabled and capped | Are idempotency, unknown-order reservation, broker reconciliation and regime sizing complete under retries? |
| Medium | Results calendar | India coverage high but provider health is external | How should source disagreement and late schedule changes be monitored and auto-suspended? |
| Medium | Curve maintenance | India curve is active; scheduler adds sessions | Should curves be segmented by liquidity bucket or session type without overfitting? |
| Medium | Ledger scale-outs | Planned quantities are advisory/user-confirmed | Should the UI add explicit fill reminders and reconciliation without sending sell orders? |
| Medium | Special sessions | Short sessions are excluded from regular curves | Should special-session curves be a separately versioned policy rather than treated as regular sessions? |
| Medium | Email delivery | Per-user send time/last-sent enforcement remains incomplete | Add durable exactly-once delivery keys and per-user schedules? |
| Low | Local metadata | `.claude/launch.json` is machine-local and uncommitted | Keep it excluded from release review. |

## Required format for reviewer findings

For every finding provide:

| Field | Required content |
| --- | --- |
| Severity | P0–P3 |
| File/line | Exact current source location |
| Broken invariant | Which documented contract is violated |
| Reproduction | Minimal deterministic fixture/query |
| User impact | Missed candidate, false candidate, wrong level, stale data, unsafe action or audit gap |
| Proposed fix | Smallest server-authoritative change |
| Tests | Unit, parity, replay and/or forward evidence required |
| Version impact | Whether model/policy/feature/label version must change |
| Rollout | Shadow, fail-closed behavior, migration and rollback |

Avoid claims based only on screenshots or hindsight. A chart that later rose does not prove it met point-in-time liquidity, freshness, volume, results, spread, regime and entry-geometry rules at the earlier decision time.

## Useful commands

```bash
npm test
npm run lint
npm run build
PYTHONPATH=pipelines:workers .venv/bin/python -m unittest discover -s pipelines -p 'test_*.py'
PYTHONPATH=pipelines:workers .venv/bin/python -m unittest discover -s workers -p 'test_*.py'
npm run audit:strategy-readiness
```

The readiness audit is expected to remain fail-closed until the required genuine Strong Swing captures exist and will continue to report US Armed missing until a proper US source is configured.
