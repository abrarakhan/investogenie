import unittest
from datetime import datetime, timedelta, timezone

from pipelines.trend_continuation import Bar, assess_trend_continuation, execution_data_verified


def bars(closes, volumes):
    result = []
    for index, (close, volume) in enumerate(zip(closes, volumes), 1):
        result.append(Bar(f"2026-10-{index:02d}", close - 1, close + 2, close - 2, close, volume))
    return result


class TrendContinuationTests(unittest.TestCase):
    def test_indhotel_style_impulse_is_detected(self):
        history = [700 + index * 0.5 for index in range(22)] + [725, 741, 772]
        volumes = [1_000_000] * 22 + [1_700_000, 5_000_000, 9_300_000]
        result = assess_trend_continuation(bars(history, volumes))
        self.assertIn(result["status"], ("IMPULSE_DETECTED", "CONTINUATION_WATCH", "TREND_CONTINUATION_READY", "EXTENDED_RISK"))
        self.assertGreaterEqual(result["metrics"]["move3_atr"], 1.5)

    def test_orderly_pullback_can_become_ready(self):
        history = [100 + index * 0.3 for index in range(21)] + [108, 110, 113, 111.5]
        volumes = [100_000] * 21 + [180_000, 190_000, 175_000, 160_000]
        result = assess_trend_continuation(bars(history, volumes))
        self.assertEqual(result["status"], "TREND_CONTINUATION_READY")
        self.assertTrue(result["ready"])

    def test_chase_is_blocked(self):
        history = [100 + index * 0.1 for index in range(22)] + [108, 116, 126]
        volumes = [100_000] * 22 + [250_000, 300_000, 350_000]
        result = assess_trend_continuation(bars(history, volumes))
        self.assertEqual(result["status"], "EXTENDED_RISK")
        self.assertFalse(result["ready"])

    def test_ready_requires_a_fresh_breeze_quote(self):
        now = datetime.now(timezone.utc)
        self.assertTrue(execution_data_verified("BREEZE_LIVE", now - timedelta(minutes=2), now))
        self.assertFalse(execution_data_verified("BREEZE_LIVE", now - timedelta(minutes=6), now))
        self.assertFalse(execution_data_verified("YAHOO_FINANCE_LIVE", now, now))

    def test_low_volume_path_is_evaluated_without_an_exception(self):
        history = [100 + index * 0.1 for index in range(25)]
        result = assess_trend_continuation(bars(history, [100_000] * 25))
        self.assertEqual(result["status"], "NOT_QUALIFIED")


if __name__ == "__main__":
    unittest.main()
