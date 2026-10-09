import unittest
from decimal import Decimal

from ml.features import FeatureBar, build_feature_vector, liquidity_bucket


D = Decimal


class FeatureTests(unittest.TestCase):
    def test_normalized_vector_is_deterministic_and_has_no_raw_price(self):
        bars = [FeatureBar(D(i), D(i - 1), D(i + 1), D(i - 2), D("1000")) for i in range(10, 70)]
        metrics = {
            "atrPct": 2, "relativeStrength20Pct": 3.5, "volumeRatio": 1.7,
            "closeLocation": 0.8, "fiveDayReturnPct": 4, "tenDayReturnPct": 6,
            "stopRiskPct": 3, "entryExtensionAtr": 0.2, "circuitLikeSessions20": 1,
            "marketRegimePositive": True,
        }
        first = build_feature_vector(bars, metrics)
        second = build_feature_vector(bars, metrics)
        self.assertEqual(first, second)
        self.assertEqual(first["market_regime_positive"], 1)
        self.assertNotIn("ticker", first)
        self.assertNotIn("close", first)
        self.assertIsNotNone(first["macd_atr"])

    def test_liquidity_buckets_are_frozen(self):
        self.assertEqual(liquidity_bucket(None), "UNKNOWN")
        self.assertEqual(liquidity_bucket(D("49999999")), "LOW")
        self.assertEqual(liquidity_bucket(D("50000000")), "MEDIUM")
        self.assertEqual(liquidity_bucket(D("250000000")), "HIGH")


if __name__ == "__main__":
    unittest.main()
