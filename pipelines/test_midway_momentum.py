"""The mid-way momentum rules: days 2 to 4, before exhaustion.

These thresholds are a stated specification, not a measured edge. Nothing here has
been through a historical replay the way the Strong Swing entry band was, so the tests
pin what the rules *are* and which evidence each one demands, not that they make money.

The exclusions matter more than the qualifications. A delivery figure that is high for
the wrong reason, a rebound mistaken for a trend, or a move entered after it has
already run are all ways this produces a confident signal that should not exist.
"""
import unittest

from pipelines.trend_continuation import (
    ACCUMULATION_MIN_DELIV_PCT, ACCUMULATION_MIN_REL_DELIV, Bar, DeliveryDay, DeliveryHistory,
    EP_MIN_DELIV_PCT, EXHAUSTION_5D_GAIN_PCT, EXHAUSTION_RSI, MIN_IBS, PATH_A_MIN_RVOL,
    PATH_B_MIN_AVG_RVOL, SETUP_EP_REBOUND, SETUP_STAGE2, SETUP_STAIR_STEP, _rsi,
    accumulation_confirmed, assess_midway, ep_rebound_ok, exhaustion, internal_bar_strength,
    red_index_alpha, red_index_boost, relative_delivery, stair_step_qualified, trend_regime_ok,
)


def bar(date, open_, high, low, close, volume=1_000_000):
    return Bar(date, open_, high, low, close, volume)


def rising_series(count=40, start=100.0, step=0.4, volume=1_000_000, dip=1.5, dip_every=4):
    """A believable uptrend: it rises, and it still has down sessions."""
    out = []
    for index in range(count):
        close = start + index * step - (dip if index % dip_every == dip_every - 1 else 0)
        out.append(bar(f"2026-09-{index + 1:02d}", close - 0.3, close + 0.4, close - 0.5, close, volume))
    return out


class InternalBarStrength(unittest.TestCase):
    def test_a_close_at_the_high_is_one_and_at_the_low_is_zero(self):
        self.assertEqual(internal_bar_strength(bar("d", 10, 12, 10, 12)), 1.0)
        self.assertEqual(internal_bar_strength(bar("d", 10, 12, 10, 10)), 0.0)

    def test_a_midpoint_close_is_a_half(self):
        self.assertAlmostEqual(internal_bar_strength(bar("d", 10, 12, 10, 11)), 0.5)

    def test_a_bar_with_no_range_has_no_strength_rather_than_a_divide_by_zero(self):
        self.assertIsNone(internal_bar_strength(bar("d", 10, 10, 10, 10)))


class Accumulation(unittest.TestCase):
    def test_either_a_high_share_or_an_unusual_quantity_confirms(self):
        self.assertTrue(accumulation_confirmed(ACCUMULATION_MIN_DELIV_PCT, None))
        self.assertTrue(accumulation_confirmed(None, ACCUMULATION_MIN_REL_DELIV))

    def test_an_ordinary_day_confirms_nothing(self):
        self.assertFalse(accumulation_confirmed(40.0, 1.1))

    def test_missing_evidence_is_not_confirmation(self):
        self.assertFalse(accumulation_confirmed(None, None))

    def test_relative_delivery_needs_a_baseline_to_divide_by(self):
        self.assertIsNone(relative_delivery(1_000, None))
        self.assertIsNone(relative_delivery(1_000, 0))
        self.assertEqual(relative_delivery(2_500, 1_000), 2.5)


class TrendRegime(unittest.TestCase):
    def test_a_stock_above_its_averages_in_a_rising_structure_passes(self):
        self.assertTrue(trend_regime_ok(110, ema20=105, sma50=100, sma200=90))

    def test_a_counter_trend_rebound_is_blocked(self):
        # Above the short average after bouncing, but the structure is still falling.
        self.assertFalse(trend_regime_ok(110, ema20=105, sma50=100, sma200=120))

    def test_missing_averages_are_not_a_pass(self):
        self.assertFalse(trend_regime_ok(110, None, 100, 90))


class EventRebound(unittest.TestCase):
    """The one exception to the regime rule, and the three things it demands at once."""

    def test_recent_results_strong_delivery_and_a_rising_reclaimed_ema_qualify(self):
        self.assertTrue(ep_rebound_ok(110, ema20=105, ema20_previous=104,
                                      deliv_pct=EP_MIN_DELIV_PCT, days_since_results=2))

    def test_an_old_event_does_not_qualify(self):
        self.assertFalse(ep_rebound_ok(110, 105, 104, 80.0, days_since_results=9))

    def test_no_event_at_all_does_not_qualify(self):
        self.assertFalse(ep_rebound_ok(110, 105, 104, 80.0, days_since_results=None))

    def test_ordinary_delivery_does_not_qualify_even_with_an_event(self):
        self.assertFalse(ep_rebound_ok(110, 105, 104, EP_MIN_DELIV_PCT - 0.1, days_since_results=1))

    def test_a_falling_ema_does_not_qualify(self):
        # Still above the 20-day, but the 20-day itself is rolling over: a bounce
        # inside a decline, which is exactly what this exception must not admit.
        self.assertFalse(ep_rebound_ok(110, ema20=105, ema20_previous=106,
                                       deliv_pct=80.0, days_since_results=1))

    def test_a_price_below_the_ema_does_not_qualify(self):
        self.assertFalse(ep_rebound_ok(104, 105, 104, 80.0, days_since_results=1))


class RedIndexStrength(unittest.TestCase):
    def test_alpha_is_the_difference_in_one_session(self):
        self.assertAlmostEqual(red_index_alpha(3.5, -0.8), 4.3)

    def test_rising_hard_while_the_index_falls_earns_the_boost(self):
        self.assertGreater(red_index_boost(3.5, -0.8), 0)

    def test_the_same_rise_on_a_green_day_does_not(self):
        self.assertEqual(red_index_boost(3.5, 0.9), 0)

    def test_a_small_rise_on_a_red_day_does_not(self):
        self.assertEqual(red_index_boost(1.0, -0.8), 0)

    def test_missing_either_return_earns_nothing_rather_than_assuming(self):
        self.assertEqual(red_index_boost(None, -0.8), 0)
        self.assertEqual(red_index_boost(3.5, None), 0)


class Exhaustion(unittest.TestCase):
    def test_a_move_past_the_five_day_ceiling_is_spent(self):
        series = rising_series(30)
        base = series[-1].close
        for index, close in enumerate([base * 1.07, base * 1.14, base * 1.20, base * 1.26]):
            series.append(bar(f"2026-10-{index + 1:02d}", close - 1, close + 1, close - 2, close))
        spent, gain, _ = exhaustion(series)
        self.assertTrue(spent)
        self.assertGreater(gain, EXHAUSTION_5D_GAIN_PCT)

    def test_an_ordinary_advance_is_not_spent(self):
        spent, gain, rsi = exhaustion(rising_series(40))
        self.assertFalse(spent, f"gain {gain} rsi {rsi}")

    def test_rsi_is_none_rather_than_a_guess_without_enough_history(self):
        self.assertIsNone(_rsi([100.0, 101.0, 102.0]))

    def test_a_series_that_only_rises_reads_as_fully_overbought(self):
        # Not a realistic stock, but the arithmetic must not divide by a zero
        # average loss; it reports 100 rather than raising.
        self.assertEqual(_rsi([100 + index for index in range(20)]), 100.0)


class StairStep(unittest.TestCase):
    def _three_strong_days(self, volumes):
        series = rising_series(30, volume=1_000_000)
        close = series[-1].close
        for index, volume in enumerate(volumes):
            close += 2.0
            series.append(bar(f"2026-10-{index + 1:02d}", close - 1.9, close + 0.05, close - 2.0,
                              close, volume))
        return series

    def test_three_strong_green_closes_on_sustained_volume_qualify(self):
        self.assertTrue(stair_step_qualified(self._three_strong_days([2_000_000] * 3)))

    def test_the_same_three_days_on_ordinary_volume_do_not(self):
        self.assertFalse(stair_step_qualified(self._three_strong_days([1_000_000] * 3)))

    def test_one_weak_close_among_three_disqualifies(self):
        series = self._three_strong_days([2_000_000] * 3)
        weak = series[-2]
        # Same range, closing at the bottom of it instead of the top.
        series[-2] = bar(weak.date, weak.open, weak.high, weak.low, weak.low + 0.01, weak.volume)
        self.assertFalse(stair_step_qualified(series))

    def test_a_red_session_among_three_disqualifies(self):
        series = self._three_strong_days([2_000_000] * 3)
        down = series[-1]
        series[-1] = bar(down.date, down.open, down.high, down.low, series[-2].close - 1, down.volume)
        self.assertFalse(stair_step_qualified(series))


def delivery_for(series, deliv_pct, *, rel=3.0, baseline=100_000, turnover=2e8):
    """Delivery evidence for the final session, with a 20-session baseline behind it."""
    return DeliveryHistory(
        {series[-1].date: DeliveryDay(deliv_pct=deliv_pct, deliv_qty=baseline * rel, turnover=turnover)},
        avg_deliv_qty_20d=baseline,
    )


class MidwayVariants(unittest.TestCase):
    def _impulse(self, volume=4_000_000, turnover=2e8):
        series = rising_series(40)
        close = series[-1].close * 1.05
        series.append(bar("2026-10-20", close - 3.0, close + 0.05, close - 3.2, close, volume))
        return series, delivery_for(series, 62.0, turnover=turnover)

    def test_a_decisive_bar_with_delivery_is_a_stage_two_impulse(self):
        series, delivery = self._impulse()
        result = assess_midway(series, delivery, ema20=series[-1].close * 0.96,
                               sma50=series[-1].close * 0.92, sma200=series[-1].close * 0.80)
        self.assertEqual(result["setup_variant"], SETUP_STAGE2)
        self.assertGreaterEqual(result["ibs_close"], MIN_IBS)

    def test_the_same_bar_without_delivery_evidence_qualifies_for_nothing(self):
        series, _ = self._impulse()
        result = assess_midway(series, delivery_for(series, 20.0, rel=1.0),
                               ema20=series[-1].close * 0.96, sma50=series[-1].close * 0.92,
                               sma200=series[-1].close * 0.80)
        self.assertIsNone(result["setup_variant"])

    def test_a_thin_ignition_bar_qualifies_for_nothing(self):
        # Rs 2 crore of turnover on the ignition day: enough to store a baseline row,
        # deliberately not enough to act on.
        series, _ = self._impulse(volume=1, turnover=2e7)
        result = assess_midway(series, delivery_for(series, 62.0, turnover=2e7),
                               ema20=series[-1].close * 0.96, sma50=series[-1].close * 0.92,
                               sma200=series[-1].close * 0.80)
        self.assertIsNone(result["setup_variant"])

    def test_a_counter_trend_bar_without_an_event_qualifies_for_nothing(self):
        series, delivery = self._impulse()
        result = assess_midway(series, delivery, ema20=series[-1].close * 0.96,
                               sma50=series[-1].close * 1.10, sma200=series[-1].close * 1.30)
        self.assertIsNone(result["setup_variant"])

    def test_the_same_counter_trend_bar_with_a_verified_event_is_an_ep_rebound(self):
        series = rising_series(40)
        close = series[-1].close * 1.05
        series.append(bar("2026-10-20", close - 3.0, close + 0.05, close - 3.2, close, 4_000_000))
        delivery = delivery_for(series, 72.0)
        result = assess_midway(
            series, delivery, ema20=series[-1].close * 0.96, ema20_previous=series[-1].close * 0.95,
            sma50=series[-1].close * 1.10, sma200=series[-1].close * 1.30,
            days_since_results=2, catalyst_tag="EP")
        self.assertEqual(result["setup_variant"], SETUP_EP_REBOUND)

    def test_an_exhausted_move_qualifies_for_nothing_however_good_it_looks(self):
        series = rising_series(30)
        close = series[-1].close
        for index in range(4):
            close *= 1.07
            series.append(bar(f"2026-10-{index + 1:02d}", close - 1, close + 0.05, close - 2,
                              close, 5_000_000))
        result = assess_midway(series, delivery_for(series, 90.0),
                               ema20=series[-1].close * 0.9, sma50=series[-1].close * 0.85,
                               sma200=series[-1].close * 0.7)
        self.assertTrue(result["exhausted"])
        self.assertIsNone(result["setup_variant"])
        self.assertTrue(any("already run" in reason for reason in result["midway_reasons"]))

    def test_evidence_is_recorded_even_when_nothing_qualifies(self):
        """A false-positive audit needs the near misses, not only the signals."""
        series, _ = self._impulse()
        result = assess_midway(series, delivery_for(series, 31.0, rel=1.0),
                               ema20=series[-1].close * 0.96, sma50=series[-1].close * 0.92,
                               sma200=series[-1].close * 0.80, benchmark_return_1d=-0.9)
        self.assertIsNone(result["setup_variant"])
        self.assertEqual(result["deliv_pct"], 31.0)
        self.assertIsNotNone(result["ibs_close"])
        self.assertIsNotNone(result["nifty_alpha_1d"])

    def test_too_little_history_returns_empty_features_rather_than_raising(self):
        self.assertIsNone(assess_midway([bar("2026-10-01", 1, 2, 1, 2)])["setup_variant"])


if __name__ == "__main__":
    unittest.main()
