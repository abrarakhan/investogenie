# Swing, Strong Swing and Armed Strong Swing: rules and review

_Rules as deployed 14 November 2026 at revision `f33f256` (Strong Swing model `strong-swing-v4-breakout-bar`). The review that led to them began at revision `30e6dd4`; production evidence below is explicitly dated._

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

`lib/swingTradeProjection.ts` freezes the plan at the buy price. `calculateRecommendedGttStop` in `lib/swingTradeLedger.ts` is direction-sensitive: long protection may only rise and short protection may only fall. EMA/SMA strategy lines are completed-close exits, not intraday broker stops. Qullamaggie, Minervini, Darvas and PTJ plan a 50% first-target scale-out; Simons plans the full allocation.

| Strategy | Trail (trades bought from 14 November 2026) |
| --- | --- |
| Default Swing, Strong Swing, Momentum, Armed, Trend Continuation | highest completed high after entry − `trailAtrMult` × ATR |
| Qullamaggie | completed close below the 10-day EMA |
| Minervini | completed close below SMA50 |
| PTJ | completed close below SMA200 for long; above SMA200 for short |
| Darvas | one tick under the bottom of the newest box built since entry (`darvasTrailingBottom`) |
| Simons | none; the target is min(frozen target, current 20-day mean) |

The moving-average line is evaluated only after a completed close. It does not replace the separate live catastrophic/broker stop. Trades opened before 14 November 2026 keep their prior follow-up contract.

## 2. Strong Swing (`/terminal/[market]/strong-swing`)

Sources: `pipelines/strategy_math/strong_swing.py` (authoritative), `lib/analytics/strongSwing.ts` (contract), `lib/strongSwing.ts` (inputs, snapshot), `lib/resultsCalendar.ts`, `lib/swingExecutionPlans.ts` (purchase validation), `workers/breeze_auto_buy.py`, `pipelines/strong_swing_parity.py`.

Universe: every long base-classifier setup, plus every stock whose last two completed closes are above the highest high of the 20 sessions before them, whatever the base scan calls it. NSE only for India. Bars are completed sessions; today's bar is excluded while the market is open.

```
breakout level = highest high of the 20 completed sessions ending two bars back
entry          = breakout level + 0.25 × ATR(14)
stop           = entry − stopAtrMult × ATR        (default 1.5)
target         = entry + targetRR × (entry − stop) (default 2)
breakout bar   = the latest bar if it broke out, else the previous bar if it did
```

Blocking technical gates: structural breakout on either of the last two bars; close > SMA50 and SMA200, SMA20 > SMA50 > SMA200, SMA50 rising; 20-session return above the benchmark's; **on the breakout bar**: close ≥ level + 0.25 ATR, close in the top 30% of its range, volume ≥ 1.5× the 20 sessions before it; both latest closes ≥ entry; participation (5-session volume ≥ 1.2× the 20-session average with price up, or OI +5%).

The open session, when it is beyond the newest completed bar, is judged on its direction and
not only its last price (model `strong-swing-v6-session-reversal`):

```
session hold     live price ≥ the newest completed close      → otherwise WAIT_FOR_ENTRY
session reversal today's high − live price ≤ 0.50 × ATR(14)    → otherwise RISK_OFF
```

The entry band (v7) has a floor as well as a ceiling: the live price must sit between
0.25 and 0.75 ATR above the confirmed entry. The old rule was a ceiling alone, on the
reasoning that nearer the trigger is a better price. The historical replay
(`pipelines/strong_swing_replay.py`) says the reverse, in both halves of a decade split
before the thresholds were chosen: fills in the first 0.25 ATR returned -0.41% per trade
in 2017-22 and -0.32% in 2023-26, against +0.68% and +0.87% for 0.25-0.75 ATR, and those
flat fills were 44% of every signal. A trigger only just exceeded is not a cheap entry,
it is an unconvincing one. The ceiling moved to 0.75 ATR because the effect holds there
and collapses beyond it on a sample too thin to read. The buy-zone check in
`lib/swingExecutionPlans.ts` mirrors both edges; they must not drift apart.

The opening price (v8) is held to the same band. The band's edge belongs specifically to
days that *gapped* into it. One-minute paths for 1,295 entries over the decade
(`pipelines/intraday_entry_study.py`) separate the cases:

```
opened inside the band             565 trades   48.8% win   +0.40% avg
opened below the floor, rose in    247 trades   41.7% win   -0.25% avg
opened above the ceiling, fell in  483 trades   48.0% win   -0.09% avg
```

Both of the later-entry halves lose, and it is not a timing effect: they are worse in
every part of the session, the opening minute included. The screen re-reads the band
against the live quote every minute, so before v8 it offered all three sets and the
per-trade edge was +0.09% rather than +0.40%. The `entry_open` gate requires the session's
own open to be in the band as well, which removes 730 of those 1,295 entries.

Two limits are deliberate. Outside an open session there is no next open to read, so the
gate stands aside exactly as the `live_*` gates do rather than making nothing actionable
out of hours. And a dated session whose opening price is missing *fails*: passing would
restore the v7 behaviour invisibly, on a data gap rather than a decision. The gate also
does not claim gapped-in days always work — that population still wins only 48.8% of the
time, and MEESHO on 2026-11-16 opened inside the band at 0.69 ATR and reversed anyway
(pinned in `pipelines/test_strong_swing_session.py`).

The session rules (`session_hold`, `session_reversal`) are advisory from v7. They were
added in v6 because the session reached the gates only as the live price, tested for its
distance from the trigger but never for direction: MEESHO gapped up on 2026-11-16, failed
at the high and handed the move back while still sitting above a trigger it never
breached, and ranked first as EXECUTION_READY through the morning. A controlled replay
then measured them — one arm withholding the session, one not, identical in every other
respect — and found an identical 47.3% win rate while the gates removed four of every
five signals. They are reported, in plain sight, and no longer decide. A MEESHO-shaped
setup reads EXECUTION_READY again with both gates failing on screen; that is the
deliberate trade. Both are inert outside a live session, and a session dated at the newest
completed bar is not a live session — that comparison would be circular.
`pipelines/testdata/meesho_2026_11_16.json` holds the bars, replayed by
`pipelines/test_strong_swing_session.py`.

Blocking execution gates: fresh data; price >= Rs 20 / $2; 20-session traded value >= Rs 1 crore / $1M; live price between entry + 0.25 ATR and entry + 0.75 ATR; 5-session return <= 30%; 10-session <= 50%; <= 15% above SMA20; ATR <= 5%; stop <= 7%; fewer than two circuit-like sessions in 20; benchmark not down 4% in two sessions; India: verified results calendar with no results within three sessions; India live session: Breeze quote <= 5 min, spread <= 0.75%, >= 3% above the lower circuit when the band is known. Advisory: market regime (benchmark above a rising SMA50), the two session rules, and the results check in the US, where the calendar has no coverage.

Status order: `INVALIDATED` (latest close < level - 1 ATR) -> `RISK_OFF` (hard execution gate, results included) -> `UNVERIFIED` (benchmark absent, behind the market or too short for its 50-SMA) -> `WAIT_FOR_ENTRY` (technically confirmed, but the live price or the session's open is outside the entry band, or it is above the SMA20 limit) -> `EXECUTION_READY` -> `WATCHLIST`.

Purchase validation refuses a fill outside the entry band (below entry + 0.25 ATR, above entry + 0.75 ATR) or at/above the target. Auto-buy additionally requires the market-regime gate to pass and the current model version.

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
| 7 | Strong Swing stayed ready below its entry; purchases had no upper bound short of the target. | Outside the entry band is `WAIT_FOR_ENTRY`; purchases outside entry + 0.25 to 0.75 ATR are refused. |
| 8 | The screen read the band against the live quote all session, so it also offered the 730 days that walked into the band rather than opening in it — measured at -0.15% per trade against +0.40%. | `entry_open` holds the session's open to the same band; outside an open session it stands aside. |
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

### Production evidence and remaining observation

Revision `f33f256` is deployed. India results-calendar verification covered 2,943 of 2,945 active NSE assets (99.93%) at the 14 November check. The active India Armed curve `in-median-2026-09-16-2026-11-13-40s` contains 1,425 complete Breeze asset-sessions across 40 eligible sessions; the short special session was excluded by the completeness rule. US Armed remains fail-closed because Breeze does not supply US equities and no equivalent US depth/intraday source is configured. Five genuine scheduled Strong Swing v4 captures are still required to establish post-deploy candidate frequency; they must not be reconstructed after the fact.
