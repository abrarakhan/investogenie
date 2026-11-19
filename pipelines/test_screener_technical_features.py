import unittest
from datetime import date
import pandas as pd

from screener_technical_features import compute_features, compute_fundamental_features, history_start_date


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
        self.assertTrue(pd.isna(out.iloc[0]["change_pct_1d"]))
        self.assertAlmostEqual(out.iloc[1]["change_pct_1d"], 100.0)
        self.assertAlmostEqual(out.iloc[200]["change_pct_1d"], (201 / 200 - 1) * 100)
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
        self.assertEqual(compute_features(base).iloc[200]["change_pct_1d"], compute_features(changed).iloc[200]["change_pct_1d"])

    def test_full_annual_history_drives_screener_growth_metrics(self):
        reports = pd.DataFrame({
            "asset_id": ["a"] * 6,
            "period_end_date": [date(year, 3, 31) for year in range(2021, 2027)],
            "revenue": [100, 110, 121, 133.1, 146.41, 161.051],
            "net_profit": [10, 11, 12.1, 13.31, 14.641, 16.1051],
            "roce": [15, 16, 17, 18, 19, 20],
            "operating_cash_flow": [12, 13.2, 14.52, 15.972, 17.5692, 19.32612],
            "free_cash_flow": [5, 5.5, 6.05, 6.655, 7.3205, 8.05255],
        })
        row = compute_fundamental_features(reports)[0]
        self.assertEqual(row[0], "a")
        self.assertEqual(row[1], date(2026, 3, 31))
        self.assertAlmostEqual(row[3], 10.0, places=5)
        self.assertAlmostEqual(row[4], 10.0, places=5)
        self.assertAlmostEqual(row[5], 10.0, places=5)
        self.assertAlmostEqual(row[6], 10.0, places=5)
        self.assertEqual(row[7], 100.0)
        self.assertAlmostEqual(row[8], 17.5)
        self.assertAlmostEqual(row[9], 1.2)
        self.assertAlmostEqual(row[10], 5.0)


if __name__ == "__main__":
    unittest.main()
