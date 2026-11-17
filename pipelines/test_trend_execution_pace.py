"""The intraday half of the mid-way rules: volume pace and the breakout level.

A volume reading taken at 10:30 is meaningless on its own, because a normal session has
only done a fraction of its day by then. These gates exist to make an early reading
comparable to a full day's, and to refuse an entry whose level has not actually broken.

Every failure mode here is a permissive one: a missing curve, a missing level or a
missing baseline must block, because the alternative is a buy button lit by absent data.
"""
import unittest

from pipelines.strategy_math.trend_execution import (
    CONFIRMATION_MINUTE, IMPULSE_MIN_TOD_RVOL, SESSION_MINUTES, SETUP_EP_REBOUND,
    SETUP_STAGE2, SETUP_STAIR_STEP, STAIR_STEP_MIN_TOD_RVOL, assess, breakout_confirmed,
    required_tod_rvol, session_progress, time_of_day_rvol,
)

# The shape of a real India session: a quarter of the day's volume in the first hour,
# flat through the middle, and the close carrying the rest.
CURVE = {"market": "IN", "sampleSessions": 40,
         "points": [[0, 0], [0.16, 0.25], [0.5, 0.55], [0.84, 0.78], [1, 1]]}


class SessionProgress(unittest.TestCase):
    def test_the_open_is_zero_and_the_close_is_one(self):
        self.assertEqual(session_progress(0), 0.0)
        self.assertEqual(session_progress(SESSION_MINUTES), 1.0)

    def test_it_is_clamped_rather_than_extrapolated_past_the_close(self):
        self.assertEqual(session_progress(SESSION_MINUTES + 120), 1.0)
        self.assertEqual(session_progress(-30), 0.0)

    def test_an_unknown_elapsed_time_has_no_progress(self):
        self.assertIsNone(session_progress(None))


class TimeOfDayRvol(unittest.TestCase):
    def _rvol(self, volume, minutes, baseline=1_000_000, curve=CURVE):
        return time_of_day_rvol({"volume": volume, "minutesElapsed": minutes}, curve, baseline)

    def test_a_session_running_at_its_normal_pace_reads_about_one(self):
        # 25% of the curve by minute 60; a normal stock has done 25% of its usual day.
        self.assertAlmostEqual(self._rvol(250_000, 60), 1.0, places=6)

    def test_twice_the_normal_pace_reads_two(self):
        self.assertAlmostEqual(self._rvol(500_000, 60), 2.0, places=6)

    def test_the_same_raw_volume_reads_lower_later_in_the_day(self):
        """The whole point of the curve: 500k by 10:15 is not 500k by 15:00."""
        early = self._rvol(500_000, 60)
        late = self._rvol(500_000, 330)
        self.assertGreater(early, late)

    def test_a_missing_curve_blocks_rather_than_assuming_a_shape(self):
        self.assertIsNone(self._rvol(500_000, 60, curve=None))

    def test_a_curve_from_too_few_sessions_is_refused(self):
        thin = {**CURVE, "sampleSessions": 12}
        self.assertIsNone(self._rvol(500_000, 60, curve=thin))

    def test_a_curve_for_another_market_is_refused(self):
        self.assertIsNone(self._rvol(500_000, 60, curve={**CURVE, "market": "US"}))

    def test_a_missing_baseline_blocks(self):
        self.assertIsNone(self._rvol(500_000, 60, baseline=0))
        self.assertIsNone(self._rvol(500_000, 60, baseline=None))

    def test_no_live_session_at_all_blocks(self):
        self.assertIsNone(time_of_day_rvol(None, CURVE, 1_000_000))


class RequiredPace(unittest.TestCase):
    def test_a_stair_step_is_asked_for_less_than_a_single_bar_impulse(self):
        self.assertEqual(required_tod_rvol(SETUP_STAIR_STEP), STAIR_STEP_MIN_TOD_RVOL)
        self.assertEqual(required_tod_rvol(SETUP_STAGE2), IMPULSE_MIN_TOD_RVOL)
        self.assertEqual(required_tod_rvol(SETUP_EP_REBOUND), IMPULSE_MIN_TOD_RVOL)
        self.assertLess(STAIR_STEP_MIN_TOD_RVOL, IMPULSE_MIN_TOD_RVOL)

    def test_the_confirmation_window_opens_an_hour_into_the_session(self):
        self.assertEqual(CONFIRMATION_MINUTE, 60)


class BreakoutLevel(unittest.TestCase):
    def test_an_impulse_enters_through_the_prior_session_high(self):
        ok, detail = breakout_confirmed(SETUP_STAGE2, 105.0, {"previousSessionHigh": 104.0})
        self.assertTrue(ok)
        self.assertIn("104.00", detail)

    def test_a_price_at_the_level_has_not_cleared_it(self):
        ok, _ = breakout_confirmed(SETUP_STAGE2, 104.0, {"previousSessionHigh": 104.0})
        self.assertFalse(ok)

    def test_an_inside_day_refusal_names_that_shape(self):
        ok, detail = breakout_confirmed(
            SETUP_STAGE2, 103.0, {"previousSessionHigh": 104.0, "insideDay": True})
        self.assertFalse(ok)
        self.assertIn("inside-day", detail)

    def test_a_stair_step_enters_through_its_three_session_high(self):
        ok, _ = breakout_confirmed(SETUP_STAIR_STEP, 110.0, {"stairStepHigh": 109.0})
        self.assertTrue(ok)

    def test_a_stair_step_does_not_borrow_the_impulse_level(self):
        """The levels are not interchangeable; a missing one must not fall through."""
        ok, detail = breakout_confirmed(SETUP_STAIR_STEP, 110.0, {"previousSessionHigh": 100.0})
        self.assertFalse(ok)
        self.assertIn("stair-step high", detail)

    def test_absent_levels_block_rather_than_pass(self):
        self.assertFalse(breakout_confirmed(SETUP_STAGE2, 105.0, None)[0])
        self.assertFalse(breakout_confirmed(SETUP_STAGE2, 105.0, {})[0])

    def test_an_unknown_price_blocks(self):
        self.assertFalse(breakout_confirmed(SETUP_STAGE2, None, {"previousSessionHigh": 104.0})[0])


def execution_input(*, volume=700_000, price=105.0, minutes=60):
    return {
        "candidate": {
            "status": "CONTINUATION_WATCH", "ready": False,
            "entry": 104.0, "target": 112.0,
            "computed_at": "2026-11-17T04:44:00+00:00",
            "metrics": {"setup_variant": SETUP_STAGE2},
        },
        "execution": {
            "price": price, "best_bid": 104.9, "best_ask": 105.1,
            "lower_circuit": 95.0, "upper_circuit": 115.0,
            "source": "BREEZE_LIVE", "updated_at": "2026-11-17T04:44:30+00:00",
            "last_success_at": "2026-11-17T03:00:00+00:00",
            "authoritative_source": "NSE_CALENDAR", "authoritative_as_of": "2026-11-17",
            "authoritative_coverage_from": "2026-11-18", "authoritative_coverage_through": "2026-11-20",
            "next_date": None, "last_past_date": "2026-10-20",
        },
        "now": "2026-11-17T04:45:00+00:00", "sessionDate": "2026-11-17",
        "marketOpen": True, "market": "IN", "holidays": [], "specialTradingDates": [],
        "volumeCurve": CURVE, "averageVolume20": 1_000_000,
        "liveSession": {"volume": volume, "minutesElapsed": minutes},
        "breakoutLevels": {"previousSessionHigh": 104.0, "insideDay": False},
    }


class MidwayPromotion(unittest.TestCase):
    def test_an_eod_watch_is_promoted_only_by_the_live_python_gates(self):
        result = assess(execution_input())
        self.assertTrue(result["executionEligible"])
        self.assertTrue(result["effectiveReady"])
        self.assertEqual(result["effectiveStatus"], "TREND_CONTINUATION_READY")

    def test_missing_volume_pace_keeps_the_same_signal_on_watch(self):
        raw = execution_input(volume=0)
        result = assess(raw)
        self.assertFalse(result["executionEligible"])
        self.assertEqual(result["effectiveStatus"], "CONTINUATION_WATCH")
        self.assertTrue(any("Volume pace" in item for item in result["executionBlockers"]))

    def test_the_old_day_two_flag_is_not_required_for_a_midway_variant(self):
        self.assertNotIn("early_breakout", execution_input()["candidate"]["metrics"])
        self.assertTrue(assess(execution_input())["executionEligible"])


if __name__ == "__main__":
    unittest.main()
