import unittest
from datetime import datetime, timedelta, timezone

from pipelines.trend_continuation import (
    Bar, assess_trend_continuation, execution_data_verified, india_session_minutes, session_volume_share,
)


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

    def test_pullback_sold_into_the_close_is_not_an_entry(self):
        # Same pullback as above, but the session reverses and closes near its low.
        history = [100 + index * 0.3 for index in range(21)] + [108, 110, 113]
        volumes = [100_000] * 21 + [180_000, 190_000, 175_000]
        reversal = Bar("2026-10-25", 113.0, 113.5, 111.3, 111.5, 160_000)
        result = assess_trend_continuation(bars(history, volumes) + [reversal])
        self.assertFalse(result["ready"])
        self.assertFalse(result["metrics"]["pullback"])

    def test_chase_is_blocked(self):
        history = [100 + index * 0.1 for index in range(22)] + [108, 116, 126]
        volumes = [100_000] * 22 + [250_000, 300_000, 350_000]
        result = assess_trend_continuation(bars(history, volumes))
        self.assertEqual(result["status"], "EXTENDED_RISK")
        self.assertFalse(result["ready"])

    def test_countertrend_rebound_cannot_be_continuation_ready(self):
        history = [150 - index * 1.5 for index in range(21)] + [112, 125, 141, 136]
        volumes = [100_000] * 21 + [180_000, 220_000, 2_500_000, 180_000]
        result = assess_trend_continuation(bars(history, volumes))
        self.assertIn(result["status"], ("IMPULSE_DETECTED", "EXTENDED_RISK"))
        self.assertFalse(result["ready"])
        self.assertFalse(result["metrics"]["established_pre_impulse_trend"])
        self.assertTrue(any("pre-impulse EMA20" in reason for reason in result["reasons"]))

    def test_ready_requires_a_fresh_breeze_quote(self):
        now = datetime.now(timezone.utc)
        self.assertTrue(execution_data_verified("BREEZE_LIVE", now - timedelta(minutes=2), now))
        self.assertFalse(execution_data_verified("BREEZE_LIVE", now - timedelta(minutes=6), now))
        self.assertFalse(execution_data_verified("YAHOO_FINANCE_LIVE", now, now))

    def test_low_volume_path_is_evaluated_without_an_exception(self):
        history = [100 + index * 0.1 for index in range(25)]
        result = assess_trend_continuation(bars(history, [100_000] * 25))
        self.assertEqual(result["status"], "NOT_QUALIFIED")


def range_base(sessions=60, volume=100_000):
    """A sideways base around 100 with a 20-session high of 100.75."""
    result = []
    for index in range(sessions):
        close = 100 + ((index % 3) - 1) * 0.25
        result.append(Bar(f"2026-08-{index:02d}", close, close + 0.75, close - 0.75, close, volume))
    return result


IGNITION = Bar("2026-10-29", 100.2, 104.2, 100.0, 104.0, 300_000)


class DayTwoBreakoutTests(unittest.TestCase):
    def test_day_one_ignition_is_flagged_for_day_two(self):
        result = assess_trend_continuation(range_base() + [IGNITION])
        self.assertEqual(result["status"], "IMPULSE_DETECTED")
        self.assertFalse(result["ready"])
        self.assertTrue(result["metrics"]["early_breakout"])

    def test_two_session_launch_is_an_ignition(self):
        # Saregama-style: a firm push, then a breakout close that alone is under 1.5 ATR.
        push = Bar("2026-10-28", 100.0, 101.9, 99.9, 101.8, 110_000)
        breakout = Bar("2026-10-29", 101.8, 103.0, 101.6, 102.9, 250_000)
        result = assess_trend_continuation(range_base() + [push, breakout])
        self.assertEqual(result["status"], "IMPULSE_DETECTED")
        self.assertEqual(result["metrics"]["launch_sessions"], 2)
        confirm = Bar("2026-10-30", 102.9, 103.6, 102.4, 103.3, 120_000)
        ready = assess_trend_continuation(range_base() + [push, breakout, confirm])
        self.assertEqual(ready["status"], "TREND_CONTINUATION_READY")

    def test_three_session_staircase_is_an_ignition(self):
        # MBAPL-style: three rising sessions out of the base, the last trading through
        # the 20-session high on its heaviest volume and closing just under it.
        dip = Bar("2026-10-26", 98.0, 98.6, 97.6, 98.0, 100_000)
        staircase = [
            Bar("2026-10-27", 98.0, 99.3, 97.9, 99.0, 110_000),
            Bar("2026-10-28", 99.0, 100.2, 98.8, 99.9, 120_000),
            Bar("2026-10-29", 99.9, 101.3, 99.9, 100.8, 180_000),
        ]
        series = range_base() + [dip] + staircase
        result = assess_trend_continuation(series)
        self.assertEqual(result["status"], "IMPULSE_DETECTED")
        self.assertEqual(result["metrics"]["launch_sessions"], 3)
        confirm = Bar("2026-10-30", 101.0, 101.6, 100.8, 101.4, 30_000)
        ready = assess_trend_continuation(series + [confirm], session_minutes=60)
        self.assertEqual(ready["status"], "TREND_CONTINUATION_READY")
        below = Bar("2026-10-30", 100.8, 100.9, 100.65, 100.7, 30_000)
        waiting = assess_trend_continuation(series + [below], session_minutes=60)
        self.assertEqual(waiting["status"], "CONTINUATION_WATCH")
        self.assertFalse(waiting["ready"])

    def test_a_later_push_in_the_same_leg_does_not_restart_day_two(self):
        confirm = Bar("2026-10-30", 104.0, 104.8, 103.0, 104.2, 120_000)
        push = Bar("2026-10-31", 104.2, 107.5, 104.1, 107.3, 400_000)
        pushed = assess_trend_continuation(range_base() + [IGNITION, confirm, push])
        self.assertFalse(pushed["metrics"]["early_breakout"])
        follow = Bar("2026-11-01", 107.3, 107.9, 106.8, 107.5, 150_000)
        after = assess_trend_continuation(range_base() + [IGNITION, confirm, push, follow])
        self.assertFalse(after["metrics"]["early_breakout"])

    def test_day_two_hold_is_ready_with_stop_below_the_breakout(self):
        confirm = Bar("2026-10-30", 104.0, 104.8, 103.0, 104.2, 120_000)
        result = assess_trend_continuation(range_base() + [IGNITION, confirm])
        self.assertEqual(result["status"], "TREND_CONTINUATION_READY")
        self.assertEqual(result["entry"], 104.2)
        self.assertLess(result["stop"], 100.75)  # below the 20-session high it broke
        self.assertAlmostEqual(result["target"] - result["entry"], 2 * (result["entry"] - result["stop"]))

    def test_day_two_waits_for_the_first_hour_then_paces_volume(self):
        # 30% of a normal session's volume after one hour is ahead of the usual 25% pace.
        confirm = Bar("2026-10-30", 104.0, 104.6, 103.4, 104.3, 30_000)
        early = assess_trend_continuation(range_base() + [IGNITION, confirm], session_minutes=40)
        self.assertEqual(early["status"], "IMPULSE_DETECTED")
        after_hour = assess_trend_continuation(range_base() + [IGNITION, confirm], session_minutes=60)
        self.assertEqual(after_hour["status"], "TREND_CONTINUATION_READY")
        self.assertGreaterEqual(after_hour["metrics"]["day_two_volume_ratio"], 1.0)

    def test_failed_follow_through_is_not_an_early_breakout(self):
        failed = Bar("2026-10-30", 103.5, 103.6, 99.5, 100.5, 200_000)
        result = assess_trend_continuation(range_base() + [IGNITION, failed])
        self.assertFalse(result["metrics"]["early_breakout"])
        self.assertFalse(result["ready"])

    def test_day_two_runaway_is_not_chased(self):
        runaway = Bar("2026-10-30", 104.5, 106.8, 104.3, 106.5, 200_000)
        result = assess_trend_continuation(range_base() + [IGNITION, runaway])
        self.assertEqual(result["status"], "EXTENDED_RISK")
        self.assertFalse(result["ready"])

    def test_breakout_on_light_volume_is_ignored(self):
        quiet = Bar("2026-10-29", 100.2, 104.2, 100.0, 104.0, 120_000)
        result = assess_trend_continuation(range_base() + [quiet])
        self.assertFalse(result["metrics"]["early_breakout"])

    def test_session_clock(self):
        self.assertAlmostEqual(session_volume_share(60), 0.25)
        self.assertEqual(session_volume_share(400), 1.0)
        ten_fifteen = datetime(2026, 10, 30, 4, 45, tzinfo=timezone.utc)  # 10:15 IST
        self.assertAlmostEqual(india_session_minutes("2026-10-30", ten_fifteen), 60)
        self.assertIsNone(india_session_minutes("2026-10-29", ten_fifteen))
        self.assertIsNone(india_session_minutes("2026-10-30", datetime(2026, 10, 30, 10, 30, tzinfo=timezone.utc)))


if __name__ == "__main__":
    unittest.main()
