# Armed Strong Swing module

Armed Strong Swing acts one stage earlier than Strong Swing. Where Strong Swing waits for a
confirmed breakout with two closes holding above the entry, Armed prepares for a breakout that has
not happened yet: it finds stocks near a pivot, ranks them on market-relative strength, and shortlists
at most 250 for full assessment. Its states are BUY_ZONE, TRIGGERED_UNCONFIRMED, ARMED, UNVERIFIED,
FORMING, EXTENDED, RISK_OFF and INVALIDATED.

Because it acts before confirmation, it demands more live evidence, not less. Entry needs a fresh
broker quote, bid/ask depth, circuit bands and verified results-calendar coverage; India additionally
requires Breeze live data. Current-session volume is judged against a market-specific, versioned
time-of-day curve built from at least 40 complete sessions, so "heavy volume" means heavy for this
time of day rather than heavy by close. Missing evidence produces an unverified or blocked state
rather than an optimistic one. India production has an active 40-session Breeze curve; US Armed
remains fail-closed because no equivalent US depth and intraday source is configured.

## Boundaries and invariants

- Owns near-pivot preparation, live execution evidence, volume-pace checks and pending buy-stop plans.
- Web entry: `app/terminal/[market]/armed-swing/page.tsx`.
- Public assessment boundary: `features/armed-swing/service.ts` and `features/armed-swing/contracts.ts`.
- Transitional server implementation: `lib/armedSwing.ts`; protected plans remain in `lib/armedSwingPlans.ts`; Python: `pipelines/strategy_math/armed_swing.py`.
- Tables: `armed_swing_plans`, `market_volume_curves`, pending-order tables.
- Missing depth, curve, results coverage or fresh quotes must fail closed.
- Mobile target: pending-order creation, fill and cancellation through immutable plan IDs.
- Focused checks: Armed Python tests, plan tests, pending-order action tests.
