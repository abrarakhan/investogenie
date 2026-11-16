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


class Scale(unittest.TestCase):
    """daily_ohlcv is auto-adjusted and Breeze intraday is raw. Matching a band computed
    on one against candles on the other is the mistake that produced this study's first
    answer, so the conversion and its sanity check are pinned here."""

    RAW = [candle("09:15", 170.0, 175.0, 169.0, 172.0),
           candle("15:29", 172.0, 174.0, 171.0, 172.75)]

    def test_the_factor_restates_the_session_onto_the_daily_scale(self):
        # ENGINERSIN 2017-04-24: adjusted 130.13 against a raw 172.75 close.
        factor = study.adjustment_factor(130.13, self.RAW)
        self.assertAlmostEqual(factor, 130.13 / 172.75, places=9)
        self.assertAlmostEqual(study.rescale(self.RAW, factor)[-1].close, 130.13, places=6)

    def test_an_unadjusted_recent_session_is_left_essentially_alone(self):
        factor = study.adjustment_factor(172.70, self.RAW)
        self.assertAlmostEqual(factor, 1.0, places=2)

    def test_a_session_with_no_usable_close_has_no_factor(self):
        self.assertIsNone(study.adjustment_factor(100.0, []))
        self.assertIsNone(study.adjustment_factor(100.0, [candle("09:15", 0, 0, 0, 0)]))
        self.assertIsNone(study.adjustment_factor(0.0, self.RAW))

    def test_a_scaled_session_inside_its_daily_bar_is_credible(self):
        day = candle("2017-04-24", 128.0, 132.0, 127.0, 130.13)
        scaled = study.rescale(self.RAW, study.adjustment_factor(130.13, self.RAW))
        self.assertTrue(study.scale_is_credible(scaled, day))

    def test_a_session_that_does_not_fit_its_daily_bar_is_refused(self):
        """Two instruments' prices, or a corporate action the ratio could not absorb."""
        day = candle("2017-04-24", 50.0, 51.0, 49.0, 50.0)
        self.assertFalse(study.scale_is_credible(self.RAW, day))

    def test_an_empty_session_is_never_credible(self):
        self.assertFalse(study.scale_is_credible([], candle("d", 1, 2, 0.5, 1)))
