import unittest

from pipelines.midway_replay import grade, summarize
from pipelines.trend_continuation import Bar


def bar(day, high, low, close):
    return Bar(day, close, high, low, close, 1_000_000)


class ReplayGrade(unittest.TestCase):
    def test_never_fills_before_a_later_bar_crosses_the_frozen_trigger(self):
        outcome = grade("TEST", "STAGE2_IMPULSE", "2026-11-01", 100, 95, 110,
                        [bar("2026-11-02", 99, 94, 98), bar("2026-11-03", 99, 96, 98)], 2, 5, 35)
        self.assertEqual(outcome.status, "UNFILLED")
        self.assertIsNone(outcome.fill_date)

    def test_stop_has_priority_if_a_daily_bar_touches_stop_and_target(self):
        outcome = grade("TEST", "STAGE2_IMPULSE", "2026-11-01", 100, 95, 110,
                        [bar("2026-11-02", 111, 94, 105)], 3, 5, 35)
        self.assertEqual(outcome.status, "STOP_HIT")
        self.assertEqual(outcome.fill_date, "2026-11-02")
        self.assertAlmostEqual(outcome.net_return_pct, -5.35)

    def test_target_is_graded_after_entry_and_costs_are_deducted(self):
        outcome = grade("TEST", "STAIR_STEP", "2026-11-01", 100, 95, 110,
                        [bar("2026-11-02", 101, 98, 100), bar("2026-11-03", 110, 99, 109)], 3, 10, 35)
        self.assertEqual(outcome.status, "TARGET_HIT")
        self.assertAlmostEqual(outcome.net_return_pct, 9.65)

    def test_summary_separates_unfilled_and_closed_calls(self):
        rows = [
            grade("A", "STAGE2_IMPULSE", "d", 100, 95, 110, [], 3, 5, 35),
            grade("B", "STAGE2_IMPULSE", "d", 100, 95, 110,
                  [bar("d2", 111, 99, 110)], 3, 5, 35),
        ]
        result = summarize(rows)
        self.assertEqual(result["signals"], 2)
        self.assertEqual(result["filled"], 1)
        self.assertEqual(result["targets"], 1)


if __name__ == "__main__":
    unittest.main()
