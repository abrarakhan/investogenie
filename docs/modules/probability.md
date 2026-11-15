# Probability module

- Owns exploratory return probability, price ranges, volatility and calibration warnings.
- Web entry: `app/terminal/[market]/probability/page.tsx`.
- Current production implementation: `lib/probability-runtime.ts` in TypeScript; Python migration is planned.
- Output is research-only and must retain the calibration warning until a promoted model exists.
- Forward tests and email digest consume the same server result.
- Mobile target: forecast, range, evidence and calibration state.
- Focused checks: probability runtime and forward-test tests.
