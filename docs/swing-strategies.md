# Swing, Strong Swing and Armed Strong Swing: rules and review

_Rules as of the strategy changes of 14 November 2026 (Strong Swing model `strong-swing-v4-breakout-bar`). The review that led to them was made on 13 November 2026 at revision `30e6dd4`; its production figures are from India (NSE) data of that date, read-only._

The named-strategy thresholds are frozen as policy `legendary-v2-2026-11-14`; Armed rules are `armed-v3-2026-11-14`. Changing a threshold requires a new version and replay.

The in-app Help articles carry the same rules in reader form (`lib/help/articles.tsx`). When this file and the source disagree, the source wins.

## 1. Swing Candidates (`/terminal/[market]/screener`)

Sources: `lib/analytics/swingClassifier.ts`, `lib/analytics/legendaryStrategies.ts`, `lib/ingest/signals.ts` (hourly scan into `swing_signals`), `lib/screener.ts` (read-time levels and entry states).

### Base classifier

| Item | Rule |
| --- | --- |
| Breakout | close > highest high of the prior 20 bars, or close > upper Bollinger band (20, 2σ) |
| Squeeze | Bollinger bandwidth in the lowest 25% of its own history |
| Build-up | derivatives: price up and OI +5% over 5 bars; cash: price up over 5 bars and their average volume ≥ 1.2× the 20 bars before |
| Score | breakout 0.35 + squeeze 0.25 + build-up 0.30 + latest volume ≥ 1.5× 20-bar average 0.10 |
| Entry | max(max(Donchian high, upper band), live price) |
| Stop / target | entry − 1.5 ATR(14); entry + 2 × risk |
| Trail | max(22-bar high, price) − 3 ATR |
| Entry state | `EXTENDED` when the live price is more than 1 ATR past the trigger |

### Legendary tags

A tag requires a 20-session average traded value of at least ₹1 crore (India) or $1M (US).

| Strategy | Match (all required) | Entry | Stop | Trail | Risk cap from the price paid |
| --- | --- | --- | --- | --- | --- |
| Qullamaggie | 40-session high ≥ 30% above the low of the prior 63 sessions; 10–40 sessions since; pullback ≤ 20%; later half of the consolidation holds a higher low in a range no wider; close > EMA10 > EMA20 with EMA20 rising; consolidation volume below the 20 sessions into the high; average daily range ≥ 4%; top 2% on 1/3/6-month return | consolidation high | max(consolidation low, entry − 1 ATR); on the breakout day, that day's low if higher | EMA10 | — |
| Minervini | Trend Template 8/8 (criterion 8 = RS rating ≥ 70); last 2–4 contractions each shallower, final ≤ 15%, none deeper than 35%; close within ±5% of the pivot; volume since the pivot below the 50-session average; once above the pivot, that bar's volume above the 50-session average | pivot (latest swing-peak high) | max(final contraction low, pivot × 0.92) | SMA50 | 8% |
| Darvas | 60-bar high that is also the 52-week high, ≥ 3 sessions old; first later low held by the next three sessions; that low unbroken; stop ≤ 15% below entry | one tick above the box top | one tick under the box bottom | the stop | 15% |
| PTJ | close above a rising SMA200 (vs 22 sessions ago), ≤ 15% above it, and the entry ≤ 15% above it; mirrored for shorts | 10-bar high | SMA200 | SMA200 | 15% |
| Simons | 20-day z-score ≤ −2.5 with close above SMA200 (long) or ≥ +2.5 with close below it (short); one σ ≤ 15% of the close | close | close ∓ 1σ | stop; target = 20-day mean | 15% |

Tick: ₹0.05 in India, $0.01 in the US.

**Breakout day (Qullamaggie, Darvas).** `withBreakoutDay` re-reads the setup as it stood before the scan bar. If that bar traded through the entry, the tag stays for that bar with `triggered`, the bar's volume against the prior 50-session average, and `confirmed` when it closed at or above the entry on ≥ 1.5× volume.

**Read-time levels and states.** Entry = max(trigger, live price); the structural stop is tightened to the strategy's risk cap from that entry; target = the strategy's own, else entry + targetRR × (entry − stop). Each level carries an entry state: `BELOW_STOP`, `EXTENDED`, `BREAKOUT_CONFIRMED`, `BREAKOUT_UNCONFIRMED` or none.

### After purchase

`lib/swingTradeProjection.ts` freezes the plan at the buy price. `calculateRecommendedGttStop` in `lib/swingTradeLedger.ts` recommends the highest of the frozen stop, the frozen trail, the trail below, and the buy price once a high reaches buy + 0.75R.

| Strategy | Trail (trades bought from 14 November 2026) |
| --- | --- |
| Default Swing, Strong Swing, Momentum, Armed, Trend Continuation | highest completed high after entry − `trailAtrMult` × ATR |
| Qullamaggie | 10-day EMA of completed closes |
| Minervini | SMA50 |
| PTJ | SMA200 |
| Darvas | one tick under the bottom of the newest box built since entry (`darvasTrailingBottom`) |
| Simons | none; the target is min(frozen target, current 20-day mean) |

The line is yesterday's completed value used as today's stop. Trades opened before 14 November 2026 keep the ATR trail.

## 2. Strong Swing (`/terminal/[market]/strong-swing`)

Sources: `pipelines/strategy_math/strong_swing.py` (authoritative), `lib/analytics/strongSwing.ts` (test oracle), `lib/strongSwing.ts` (inputs, snapshot), `lib/resultsCalendar.ts`, `lib/swingExecutionPlans.ts` (purchase validation), `workers/breeze_auto_buy.py`, `pipelines/strong_swing_parity.py`.

Universe: every long base-classifier setup, plus every stock whose last two completed closes are above the highest high of the 20 sessions before them, whatever the base scan calls it. NSE only for India. Bars are completed sessions; today's bar is excluded while the market is open.

```
breakout level = highest high of the 20 completed sessions ending two bars back
entry          = breakout level + 0.25 × ATR(14)
stop           = entry − stopAtrMult × ATR        (default 1.5)
target         = entry + targetRR × (entry − stop) (default 2)
breakout bar   = the latest bar if it broke out, else the previous bar if it did
```

Blocking technical gates: structural breakout on either of the last two bars; close > SMA50 and SMA200, SMA20 > SMA50 > SMA200, SMA50 rising; 20-session return above the benchmark's; **on the breakout bar**: close ≥ level + 0.25 ATR, close in the top 30% of its range, volume ≥ 1.5× the 20 sessions before it; both latest closes ≥ entry; participation (5-session volume ≥ 1.2× the 20-session average with price up, or OI +5%).

Blocking execution gates: fresh data; price ≥ ₹20 / $2; 20-session traded value ≥ ₹1 crore / $1M; live price ≥ entry × 0.999 and ≤ entry + 0.5 ATR; 5-session return ≤ 30%; 10-session ≤ 50%; ≤ 15% above SMA20; ATR ≤ 5%; stop ≤ 7%; fewer than two circuit-like sessions in 20; benchmark not down 4% in two sessions; India: verified results calendar with no results within three sessions; India live session: Breeze quote ≤ 5 min, spread ≤ 0.75%, ≥ 3% above the lower circuit when the band is known. Advisory: market regime (benchmark above a rising SMA50), and the results check in the US, where the calendar has no coverage.

Status order: `INVALIDATED` (latest close < level − 1 ATR) → `RISK_OFF` (hard execution gate, results included) → `WAIT_FOR_ENTRY` (technically confirmed, outside the buy zone or above the SMA20 limit) → `EXECUTION_READY` → `WATCHLIST`.

Purchase validation refuses a fill below entry × 0.999, above entry + 0.5 ATR, or at/above the target. Auto-buy additionally requires the market-regime gate to pass and the current model version.

## 3. Armed Strong Swing (`/terminal/[market]/armed-swing`)

Sources: `lib/analytics/armedSwing.ts`, `lib/armedSwing.ts`, `lib/armedSwingPlans.ts`.

Universe: active stocks with ≥ 60 bars, price and liquidity floors, price between 90% and 105% of the 20-session high; the 250 highest by relative strength are assessed.

```
pivot   = highest high of the last 20 completed sessions
trigger = pivot + 0.1 ATR;  limit = min(trigger + 0.25 ATR, pivot × 1.03)
stop    = min(low of the last 5 sessions − 0.1 ATR, trigger − 1 ATR)
target  = trigger + targetRR × (trigger − stop);  trail = max(stop, trigger − 3 ATR)
volume pace = today's volume ÷ (20-session average × expectedVolumeShare(session progress))
```

`expectedVolumeShare` uses the active curve for that market. Curves are versioned median cumulative-volume profiles built from at least 40 completed sessions; a triggered setup cannot confirm when its market has no valid curve.

Blocking technical gates: stage-2 trend (close > SMA50, SMA150 and SMA200; SMA50 > SMA150 > SMA200; SMA200 rising over 20 sessions; within 25% of the 52-week high; ≥ 30% above the low); RS percentile ≥ 80; RS line within 2% of its six-month high; base depth ≤ 18%; second-half range ≤ 75% of the first half or bandwidth in the lowest 25%; pivot high set ≥ 3 completed sessions ago; five-session volume ≤ 0.85× the 50-session average; within 1.5 ATR and 6% of the trigger; once triggered, volume pace ≥ 1.5×.

Blocking execution gates: fresh data, price, liquidity, ATR ≤ 5%, stop ≤ 8%, circuit behaviour, market shock, benchmark above a rising SMA50, verified results calendar with no results within three sessions, live quote, spread ≤ 0.75%, both circuit bands with ≥ 3% lower room and the limit inside the upper band.

## 4. Review findings and how each was closed

The review found no arithmetic error. The findings were places where the rules, the funnel or the follow-up after purchase departed from the method a strategy is named for.

| # | Finding (13 November 2026) | Change (14 November 2026) |
| --- | --- | --- |
| 1 | Strong Swing tested breakout-day volume, close and clearance on the hold day. No `EXECUTION_READY` in 14 sessions of scheduled captures. | Those three gates are measured on the bar that broke out. |
| 2 | Strong Swing assessed only current base setups; 43 of 90 NSE stocks holding a two-close breakout were `NO_SETUP` and never checked. | Stocks holding two closes above the breakout level join the universe. |
| 3 | The ledger trailed every strategy by ATR. | Qullamaggie, Minervini, PTJ and Darvas trades follow their own line; Simons follows the moving mean. New trades only. |
| 4 | Qullamaggie and Darvas tags vanished on the breakout, with no volume test. | The breakout day keeps the tag with a triggered state, its volume ratio and a confirmed flag; shown on the Swing page. |
| 5 | Darvas and PTJ stops had no width limit (average 25% and 11%). | Darvas boxes over 15% are not tagged; PTJ's 15% is measured from the entry; every strategy stop is capped from the price paid. |
| 6 | Strong Swing had no results-date gate. | Results blackout gate, blocking in India. |
| 7 | Strong Swing stayed ready below its entry; purchases had no upper bound short of the target. | Below the entry is `WAIT_FOR_ENTRY`; purchases above entry + 0.5 ATR are refused. |
| 8 | Strong Swing trend did not require SMA50 > SMA200; market regime blocked nothing. | SMA50 > SMA200 required. Regime stays advisory for manual entries; auto-buy requires it. |
| 9 | Minervini: 8% cap from the pivot, no breakout volume, unbounded first contraction. | Cap from the price paid; above-average volume once through the pivot; contractions ≤ 35%. |
| 10 | Armed: looser trend, advisory dry-up, no pivot age. | Full 50 > 150 > 200 stack with close above the 50-day; dry-up required; pivot ≥ 3 sessions old. |
| 11 | Armed volume pace was linear in time. | Pace against the time-of-day volume curve. |
| 12 | Simons: no trend filter, fixed target, very wide σ rows. | 200-day trend filter, σ ≤ 15% of price, liquidity floor, target follows the mean after purchase. |
| 13 | Base classifier: no extended state; a price below a strategy stop not flagged. | `EXTENDED` and `BELOW_STOP` entry states at read time. |
| 14 | Darvas used a 0.01 offset regardless of tick. | Entry and stop on the exchange tick. |

### Left as designed

- **Base classifier breakout and filters.** A close above the upper Bollinger band still counts as a breakout, and the base list still has no trend, liquidity or market filter. It is the discovery feed for Strong Swing, whose own gates require clearance of the 20-session high, a trend and liquidity; changing the feed would alter every downstream engine.
- **Completed-bar discovery with a live overlay.** The hourly scan calculates patterns only from completed daily bars. A fresh live quote may mark a frozen trigger as crossed, but that state remains unconfirmed until the completed bar supplies its close and volume.
- **Armed leadership and regime are blocking.** Weak relative strength or a weak market regime prevents an actionable Armed status.
- **Partial profit-taking is explicit.** Qullamaggie, Minervini, Darvas and PTJ plans schedule 50% at the first target; Simons exits the full mean-reversion allocation. Fills remain user-confirmed ledger events.
- **Close-only exits stay close-only.** EMA/SMA strategy lines are evaluated against completed closes and do not replace the live catastrophic broker stop.

### Not yet observed in production

The changes are tested but had not run on live data when this was written. On local 13 November data one stock (a prior-day breakout the base scan called `NO_SETUP`) passed every Strong Swing gate apart from a stale local benchmark; whether the gates now yield candidates at a useful rate needs the scheduled captures after deployment. The results gate depends on authoritative blackout-window coverage. Armed breakout confirmation also remains fail-closed until its market has a curve built from at least 40 completed sessions.
