import unittest

from trade_recovery_targets import recovery_targets


def history(length=180):
    bars = []
    price = 100.0
    for index in range(length):
        change = [0.006, -0.002, 0.004, -0.001, 0.008][index % 5]
        close = price * (1 + change)
        bars.append((f"2026-01-{(index % 28) + 1:02d}", price, max(price, close) * 1.012, min(price, close) * 0.992, close))
        price = close
    return bars


class RecoveryTargetTests(unittest.TestCase):
    def test_returns_volatility_and_prior_path_targets(self):
        result = recovery_targets(history(), 120, 4, 0.8, 1.1, 10)
        self.assertEqual(result["recoveryTarget"], 124.0)
        self.assertGreater(result["historicalTarget"], 120)
        self.assertEqual(result["sampleSize"], 20)

    def test_fails_closed_without_price_or_atr(self):
        result = recovery_targets(history(), 120, 0, 1, 2, 10)
        self.assertIsNone(result["recoveryTarget"])
        self.assertIsNone(result["historicalTarget"])

    def test_requires_enough_fully_observed_analogues(self):
        result = recovery_targets(history(28), 120, 4, 1, 2, 10)
        self.assertIsNone(result["historicalTarget"])
        self.assertLess(result["sampleSize"], 12)


if __name__ == "__main__":
    unittest.main()
