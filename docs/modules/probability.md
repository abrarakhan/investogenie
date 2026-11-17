# Probability module

The Probability module produces a cross-sectional distribution of plausible 21-session returns and
price ranges, with volatility context. It is explicitly research output and carries a calibration
warning that must remain until a promoted, validated model exists - a distribution that has not been
checked against outcomes is a description of the past, not a forecast.

The email digest and forward tests consume the same server-computed result rather than recomputing
it.

## Boundaries and invariants

- Owns exploratory return probability, price ranges, volatility and calibration warnings.
- Web entry: `app/terminal/[market]/probability/page.tsx`.
- Loader: `lib/probability-runtime.ts`; sole calculation authority: `pipelines/strategy_math/probability.py`.
- Output is research-only and must retain the calibration warning until a promoted model exists.
- Forward tests and email digest consume the same server result.
- Mobile target: forecast, range, evidence and calibration state.
- Focused checks: `pipelines/test_probability_strategy_math.py`, Python bridge and forward-test tests.
