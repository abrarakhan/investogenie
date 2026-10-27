import unittest
from datetime import date
import pandas as pd

from screener_technical_features import compute_features, history_start_date


class ScreenerTechnicalFeatureTests(unittest.TestCase):
    def test_incremental_history_is_bounded_but_keeps_indicator_lookback(self):
        today = date(2026, 10, 27)
        self.assertEqual((today - history_start_date(today, 5, True)).days, 440)
        self.assertEqual((today - history_start_date(today, 5, False)).days, 2150)

    def test_point_in_time_indicators_and_forward_returns(self):
        n = 260
        df = pd.DataFrame({
            "date": pd.date_range("2025-01-01", periods=n, freq="B").date,
            "open": range(1, n + 1), "high": range(2, n + 2),
            "low": range(0, n), "close": range(1, n + 1),
            "volume": [100] * n,
        })
        out = compute_features(df)
        self.assertAlmostEqual(out.iloc[199]["sma_200"], 100.5)
        self.assertGreater(out.iloc[220]["distance_sma_200_pct"], 0)
        self.assertGreater(out.iloc[220]["sma_20_vs_200_pct"], 0)
        self.assertGreater(out.iloc[220]["distance_ema_50_pct"], 0)
        self.assertAlmostEqual(out.iloc[220]["volume_ratio_20"], 1.0)
        self.assertAlmostEqual(out.iloc[200]["forward_return_20d"], (221 / 201 - 1) * 100)

    def test_no_future_data_in_current_features(self):
        base = pd.DataFrame({"date": pd.date_range("2025-01-01", periods=220, freq="B").date,
                             "open": 10, "high": 11, "low": 9, "close": 10, "volume": 100})
        changed = base.copy()
        changed.loc[219, "close"] = 1000
        self.assertEqual(compute_features(base).iloc[200]["sma_200"], compute_features(changed).iloc[200]["sma_200"])


if __name__ == "__main__":
    unittest.main()
