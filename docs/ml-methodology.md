# InvestoGenie ML Methodology — Production Contract v1

## Purpose and boundary

The ML layer estimates the probability that an already eligible Strong Swing candidate reaches its frozen target before its frozen stop. It is an advisory rank only. It cannot create a candidate, bypass a technical or execution gate, send an alert while in shadow, or place a broker order.

Python is the only calculation runtime for feature construction, labeling, training, calibration, evaluation and inference. Next.js schedules Python jobs and reads persisted results; web and mobile clients only render them. A calculation must not be independently reimplemented in TypeScript.

## Frozen v1 policies

| Contract | Version/value |
| --- | --- |
| Feature version | `strong-swing-features-v1` |
| Label version | `strong-swing-first-touch-v1` |
| Entry fill policy | `strong-swing-entry-v1` |
| Trailing policy | `strong-swing-trailing-v1` |
| Inclusion policy | `strong-swing-entry-eligible-v1` |
| India calendar | `NSE-calendar-v1` |
| Canonical India decision time | 18:45 Asia/Kolkata, 30-minute grace |
| Included candidate statuses | `EXECUTION_READY`, `WAIT_FOR_ENTRY` |
| Maximum entry extension | 0.50 ATR |
| Break-even activation | 0.75 initial-risk multiple |
| Stop update timing | next expected trading session only |
| Entry slippage | 10 bps |
| Exit slippage | 10 bps |
| Round-trip charges | 10 bps |

Costs are conservative modeling assumptions, not broker invoices. Changing a value above requires a new policy or label version and complete re-evaluation.

## Canonical data

The scheduled collector writes at most one snapshot per `(market, market_date, decision_time, asset_id, source, feature_version)`. Page visits and ad-hoc evaluations are `interactive`; only `scheduled` rows are eligible for training or evaluation. The snapshot records its data cutoff, calendar version and scheduler run.

For India, `scripts/ml-snapshot-scheduler.mjs` waits for both the 18:45 decision point and a successful `eod-in` record for the same exchange session. It then freezes the candidate set and invokes `pipelines/ml/collect_snapshots.py`. Reruns reuse the canonical candidate key and never duplicate the immutable Python feature row.

Universe membership, liquidity and market-cap buckets are point-in-time data. Present-day `is_active` state and broker mappings must not determine historical eligibility. OHLCV uses the same split/bonus adjustment source as the portfolio engine. Delisted and renamed assets retain their immutable asset IDs. The v1 collector records a point-in-time liquidity bucket and explicitly marks market-cap as `UNKNOWN`; model training remains blocked until historical market-cap reconstruction is available or the registered feature contract excludes that field.

## Label semantics

Entry scanning starts on the first expected session after the decision. A crossing fills at the frozen confirmation entry. A gap at or above entry fills at the opening price only when it is no more than 0.50 ATR beyond entry; a more extended gap is skipped. The entry session counts as session one.

For every post-entry session, the labeler first applies the stop frozen from the preceding session. An opening gap below the stop exits at open; an opening gap above the target exits at open. Otherwise it evaluates the bar's low against the effective stop and high against the target. If both are touched, the raw outcome is `SAME_BAR_AMBIGUOUS` and the binary training target is zero. The current high may raise the stop only for the next session. Stops never decrease.

Outcomes are `TARGET_FIRST`, `STOP_FIRST`, `SAME_BAR_AMBIGUOUS`, `WINDOW_EXPIRED`, `NOT_ENTERED`, or `INVALID_DATA`. Holidays come from the recorded calendar and are not missing sessions. A missing expected session or invalid OHLC value is `INVALID_DATA`. MFE and MAE stop at the outcome bar. Returns are net of the frozen modeled costs.

The implementation is [`pipelines/ml/labeler.py`](../pipelines/ml/labeler.py). Decimal arithmetic and canonical JSON outputs make repeated runs deterministic. [`pipelines/ml/golden_vectors.json`](../pipelines/ml/golden_vectors.json) is the executable policy contract.

## Model lifecycle and serving

Models move through `CANDIDATE`, `SHADOW`, `VALIDATED`, `SUSPENDED`, and `RETIRED`. Lifecycle and serving are separate: `ml_serving_assignments` holds at most one served model per market, and rollback is an atomic pointer swap. Every transition or assignment requires a recorded promotion decision. Model artifacts are immutable and checksum verified before loading.

The first model is pooled across India candidates; ticker identity is prohibited. Permitted categoricals are point-in-time liquidity, market-cap and regime buckets. Training uses scheduled snapshots matching the declared inclusion, feature, label, trailing, entry and calendar versions.

Walk-forward folds are `training → purge → calibration → purge/embargo → test`. Both gaps are at least the maximum holding window. Test decision dates do not overlap. Sigmoid calibration is the default. Test data never fits either model or calibrator.

## Registered promotion gates

These initial thresholds must be inserted before the final test is inspected:

- At least 1,000 independent test decision-date clusters and 200 positive clusters.
- At least five accepted folds; each accepted fold has 100 clusters and 20 positives.
- Top-decile precision improvement over baseline at least 5 percentage points, with a 95% bootstrap confidence-interval lower bound above zero.
- Top-decile net expectancy after frozen costs greater than zero, with a 95% bootstrap confidence-interval lower bound at least zero.
- Brier score at most 0.22 and 10-bin ECE at most 0.08.
- Adverse-regime precision deterioration versus its unranked baseline no worse than 5 percentage points.
- Fold top-decile precision-improvement standard deviation at most 10 percentage points; no accepted fold may be negative by more than 5 percentage points.

Insufficient folds are reported, never silently discarded. Threshold changes after test inspection invalidate the run.

## Monitoring and failure behavior

Production monitoring covers calibration, feature drift, invalid-label rate, ranked-versus-baseline performance and source freshness. Confirmed drift atomically removes the serving assignment, records the observation, notifies the operator and falls back to unranked Strong Swing. Data-pipeline failures alert separately. An unavailable or invalid model never blocks Strong Swing.

No model from this lifecycle may drive screen-based or broker buying. Any future execution use requires a separate specification and promotion process.
