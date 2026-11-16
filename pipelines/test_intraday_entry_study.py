"""The fill rules, where an intraday study is easiest to flatter itself.

Two mistakes would both make intraday entries look better than they were: claiming a
fill at a price inside the band that the candle never proves was available, and
grading the entry session from its daily range, whose low may have happened before
the position existed.
"""
import unittest

import intraday_entry_study as study
from intraday_entry_study import Candle


def candle(stamp, o, h, l, c):
    return Candle(stamp, o, h, l, c)


class TheBand(unittest.TestCase):
    def test_it_is_measured_in_atr_above_the_confirmed_entry(self):
        self.assertEqual(study.band(100.0, 4.0), (101.0, 103.0))


class FirstTouch(unittest.TestCase):
    def test_a_candle_opening_inside_the_band_fills_at_its_open(self):
        found = study.first_touch([candle("09:15", 102.0, 102.5, 101.5, 102.2)], 101.0, 103.0)
        self.assertEqual(found, (0, 102.0))

    def test_rising_into_the_band_fills_at_the_floor_not_the_high(self):
        """The candle proves the floor traded; a better price inside it is invention."""
        found = study.first_touch([candle("09:15", 100.0, 102.4, 99.8, 102.0)], 101.0, 103.0)
        self.assertEqual(found, (0, 101.0))

    def test_falling_into_the_band_fills_at_the_ceiling(self):
        found = study.first_touch([candle("09:15", 105.0, 105.2, 102.0, 102.5)], 101.0, 103.0)
        self.assertEqual(found, (0, 103.0))

    def test_candles_entirely_outside_the_band_are_skipped(self):
        found = study.first_touch([
            candle("09:15", 99.0, 100.5, 98.0, 100.0),    # all below
            candle("09:16", 104.0, 105.0, 103.5, 104.5),  # all above
            candle("09:17", 102.0, 102.3, 101.8, 102.1),  # inside
        ], 101.0, 103.0)
        self.assertEqual(found, (2, 102.0))

    def test_a_session_that_never_meets_the_band_reports_nothing(self):
        self.assertIsNone(study.first_touch([candle("09:15", 99.0, 100.0, 98.0, 99.5)], 101.0, 103.0))


class Walking(unittest.TestCase):
    DAYS = [candle("2024-02-02", 102.0, 103.0, 101.0, 102.5),
            candle("2024-02-03", 102.5, 104.0, 102.0, 103.5)]

    def test_a_stop_inside_the_entry_session_ends_it_that_day(self):
        minutes = [candle("09:20", 102.0, 102.1, 94.0, 95.0)]
        result = study.walk(100.0, 95.0, 120.0, minutes, self.DAYS, 20)
        self.assertEqual((result.exit_reason, result.sessions_held), ("STOP", 1))
        self.assertAlmostEqual(result.return_pct, -5.0, places=6)

    def test_minutes_before_the_fill_cannot_stop_the_position(self):
        """The caller passes only the minutes after the fill; this pins that contract."""
        result = study.walk(100.0, 95.0, 120.0, [], self.DAYS, 20)
        self.assertEqual(result.exit_reason, "HORIZON")

    def test_later_sessions_are_daily_bars_and_count_from_two(self):
        days = [candle("2024-02-02", 102.0, 125.0, 101.0, 124.0)]
        result = study.walk(100.0, 90.0, 120.0, [], days, 20)
        self.assertEqual((result.exit_reason, result.sessions_held), ("TARGET", 2))

    def test_a_day_spanning_both_levels_is_scored_as_the_stop(self):
        days = [candle("2024-02-02", 102.0, 130.0, 85.0, 128.0)]
        self.assertEqual(study.walk(100.0, 95.0, 120.0, [], days, 20).exit_reason, "STOP")

    def test_a_gap_through_the_stop_fills_at_the_open(self):
        days = [candle("2024-02-02", 80.0, 82.0, 78.0, 79.0)]
        result = study.walk(100.0, 95.0, 120.0, [], days, 20)
        self.assertEqual(result.exit_price, 80.0)
        self.assertAlmostEqual(result.return_pct, -20.0, places=6)

    def test_an_untouched_plan_marks_out_at_the_horizon_close(self):
        result = study.walk(100.0, 90.0, 130.0, [], self.DAYS, 20)
        self.assertEqual((result.exit_reason, result.exit_price), ("HORIZON", 103.5))


class Summary(unittest.TestCase):
    def test_it_keeps_wins_losses_and_the_median_apart(self):
        results = [study.Result(110, "TARGET", 10.0, 3), study.Result(95, "STOP", -5.0, 2),
                   study.Result(95, "STOP", -5.0, 2)]
        stats = study.summarize(results)
        self.assertAlmostEqual(stats["expectancy_pct"], 0.0, places=6)
        self.assertAlmostEqual(stats["median_pct"], -5.0, places=6)
        self.assertEqual((stats["target_hits"], stats["stop_hits"]), (1, 2))

    def test_an_empty_sample_concludes_nothing(self):
        self.assertEqual(study.summarize([]), {"graded": 0})


if __name__ == "__main__":
    unittest.main()
