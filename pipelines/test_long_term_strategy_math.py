import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from strategy_math.long_term import _score, historical_metrics, score_fundamentals


class LongTermStrategyMathTests(unittest.TestCase):
    def test_negative_target_lower_direction_scores_correctly(self):
        # Templeton Contrarian: pctFrom52wHigh <= -30% should score HIGH when deeper below high.
        self.assertAlmostEqual(_score(-30, -30, "lower"), 50.0, places=4)
        self.assertGreater(_score(-45, -30, "lower"), 80.0)
        self.assertLess(_score(0, -30, "lower"), 10.0)

    def test_extreme_outliers_never_overflow_math_exp(self):
        self.assertLess(_score(50000, 0.5, "lower"), 1e-6)
        self.assertLess(_score(-50000, 15, "higher"), 1e-6)
        self.assertGreater(_score(50000, 15, "higher"), 99.99)
        self.assertLess(_score(-50000, -30, "higher"), 1e-6)

    def test_negative_pe_pb_and_de_never_score_as_bargains(self):
        payload = {
            "market": "IN",
            "fundamentals": [
                {
                    "sector": "Industrials",
                    "marketCap": 2500,
                    "peRatio": -12.0,
                    "priceToBook": -2.0,
                    "debtToEquity": -1.5,
                    "reportAgeDays": 30,
                    "historyYears": 5,
                }
            ],
            "strategies": [
                {
                    "key": "GRAHAM_DEFENSIVE",
                    "criteria": [
                        {"label": "P/E ratio", "field": "peRatio", "target": 15, "direction": "lower", "weight": 1, "description": ""},
                        {"label": "Price-to-book", "field": "priceToBook", "target": 1.5, "direction": "lower", "weight": 0.8, "description": ""},
                        {"label": "Debt-to-equity", "field": "debtToEquity", "target": 0.5, "direction": "lower", "weight": 0.8, "description": ""},
                    ],
                }
            ],
        }
        result = score_fundamentals(payload)[0][0]
        self.assertEqual(result["matchedCriteria"], 0)
        for outcome in result["outcomes"]:
            self.assertTrue(outcome["dataMissing"])
            self.assertFalse(outcome["passed"])
            self.assertEqual(outcome["score"], 0)

    def test_leap_day_historical_metrics_does_not_raise(self):
        metrics = historical_metrics([
            {"period": "2024-02-29", "revenue": 200, "netProfit": 40, "roce": 20, "operatingCashFlow": 45, "freeCashFlow": 25},
            {"period": "2021-03-31", "revenue": 100, "netProfit": 20, "roce": 18, "operatingCashFlow": 22, "freeCashFlow": 12},
        ])
        self.assertIsNotNone(metrics["revenueCagr3y"])
        self.assertIsNotNone(metrics["profitCagr3y"])


if __name__ == "__main__":
    unittest.main()
