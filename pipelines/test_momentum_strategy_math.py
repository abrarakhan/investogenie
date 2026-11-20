import math
import unittest
from datetime import date, timedelta

from strategy_math.momentum import assess_both


def bars(count: int, start: float = 100, slope: float = 0.35) -> list[dict]:
    first = date(2025, 1, 1)
    result = []
    for index in range(count):
        close = start + index * slope + math.sin(index / 4) * 1.2
        result.append({
            "date": str(first + timedelta(days=index)),
            "open": close - 0.4,
            "high": close + 1.2,
            "low": close - 1.1,
            "close": close,
            "volume": 1_000_000 + index * 4_000,
            "openInterest": None,
        })
    return result


def payload(count: int) -> dict:
    stock = bars(count)
    return {
        "currentPrice": stock[-1]["close"],
        "bars": stock,
        "benchmarkBars": bars(260, 200, 0.2),
        "currentSessionVolume": False,
        "sessionProgressFraction": 1,
        "benchmarkLabel": "Nifty",
        "liquidityFloor": 50_000_000,
        "liquidityRequirementLabel": "INR 5 crore",
        "priceFloor": 20,
        "marketOpen": False,
        "liveDataVerified": True,
        "stopAtrMult": 1.5,
        "targetRR": 2,
        "trailAtrMult": 3,
    }


class MomentumGoldenVectorTests(unittest.TestCase):
    def test_new_listing_vector(self):
        result = assess_both(payload(45))
        legacy, v2 = result["legacy"], result["v2"]
        self.assertEqual((legacy["modelType"], legacy["status"], legacy["score"]),
                         ("NEW_LISTING", "NOT_QUALIFIED", 45))
        self.assertAlmostEqual(legacy["atr14"], 2.3, places=10)
        self.assertAlmostEqual(legacy["entryTrigger"], 115.31600255849519, places=10)
        self.assertAlmostEqual(legacy["projectedVolumeRatio"], 1.037037037037037, places=10)
        self.assertTrue(legacy["marketRegimePositive"])
        self.assertEqual((v2["status"], v2["score"], v2["breakoutAgeSessions"]),
                         ("NOT_QUALIFIED", 5, 1))

    def test_established_vector(self):
        result = assess_both(payload(240))
        legacy, v2 = result["legacy"], result["v2"]
        self.assertEqual((legacy["modelType"], legacy["status"], legacy["score"]),
                         ("ESTABLISHED", "NOT_QUALIFIED", 50))
        self.assertAlmostEqual(legacy["atr14"], 2.3, places=10)
        self.assertAlmostEqual(legacy["entryTrigger"], 184.95693754442107, places=10)
        self.assertAlmostEqual(legacy["projectedVolumeRatio"], 1.0219435736677116, places=10)
        self.assertTrue(legacy["marketRegimePositive"])
        self.assertEqual((v2["status"], v2["score"], v2["breakoutAgeSessions"]),
                         ("NOT_QUALIFIED", 5, 9))

    def test_batch_result_is_deterministic(self):
        raw = payload(240)
        self.assertEqual(assess_both(raw), assess_both(raw))

    def test_requires_minimum_history(self):
        with self.assertRaisesRegex(ValueError, "at least 10 bars"):
            assess_both(payload(9))

    def test_new_listing_rejects_repeat_circuits_and_excludes_current_bar_from_accumulation(self):
        raw = payload(45)
        stock = raw["bars"]
        # Create two 10% upper-circuit-like closes inside the lookback window.
        for idx in (-8, -5):
            prev_close = stock[idx - 1]["close"]
            c = round(prev_close * 1.10, 2)
            stock[idx]["open"] = c
            stock[idx]["low"] = c
            stock[idx]["high"] = c
            stock[idx]["close"] = c
        # Make current bar a huge volume up-day while prior bars stay flat volume.
        for b in stock[:-1]:
            b["volume"] = 1_000_000
        stock[-1]["close"] = stock[-2]["close"] * 1.03
        stock[-1]["high"] = stock[-1]["close"]
        stock[-1]["volume"] = 5_000_000
        raw["currentPrice"] = stock[-1]["close"]
        res = assess_both(raw)["legacy"]
        self.assertFalse(res["qualifies"])
        self.assertEqual(res["accumulationDays10"], 0)


if __name__ == "__main__":
    unittest.main()
