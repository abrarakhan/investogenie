# Armed Strong Swing module

- Owns near-pivot preparation, live execution evidence, volume-pace checks and pending buy-stop plans.
- Web entry: `app/terminal/[market]/armed-swing/page.tsx`.
- Public assessment boundary: `features/armed-swing/service.ts` and `features/armed-swing/contracts.ts`.
- Transitional server implementation: `lib/armedSwing.ts`; protected plans remain in `lib/armedSwingPlans.ts`; Python: `pipelines/strategy_math/armed_swing.py`.
- Tables: `armed_swing_plans`, `market_volume_curves`, pending-order tables.
- Missing depth, curve, results coverage or fresh quotes must fail closed.
- Mobile target: pending-order creation, fill and cancellation through immutable plan IDs.
- Focused checks: Armed Python tests, plan tests, pending-order action tests.
