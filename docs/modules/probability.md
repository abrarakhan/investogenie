# Probability module

- Owns exploratory return probability, price ranges, volatility and calibration warnings.
- Web entry: `app/terminal/[market]/probability/page.tsx`.
- Loader: `lib/probability-runtime.ts`; sole calculation authority: `pipelines/strategy_math/probability.py`.
- Output is research-only and must retain the calibration warning until a promoted model exists.
- Forward tests and email digest consume the same server result.
- Mobile target: forecast, range, evidence and calibration state.
- Focused checks: `pipelines/test_probability_strategy_math.py`, Python bridge and forward-test tests.
