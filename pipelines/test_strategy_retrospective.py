import unittest
from datetime import date

from pipelines.strategy_retrospective import Bar, calculate_outcome, summarize


class StrategyRetrospectiveTests(unittest.TestCase):
    def test_enters_at_next_session_open_and_uses_exact_horizon(self):
        bars = [Bar(date(2026, 1, day), 100 + day, 102 + day, 99 + day, 101 + day) for day in range(2, 8)]
        result = calculate_outcome(bars, 5)
        self.assertEqual(result["entry_date"], date(2026, 1, 2))
        self.assertEqual(result["entry_price"], 102)
        self.assertEqual(result["exit_date"], date(2026, 1, 6))
        self.assertAlmostEqual(result["realized_return_pct"], (107 / 102 - 1) * 100)

    def test_requires_complete_horizon(self):
        bars = [Bar(date(2026, 1, 2), 100, 101, 99, 100)]
        self.assertIsNone(calculate_outcome(bars, 5))

    def test_scorecard_is_calculated_in_python(self):
        summary = summarize([
            {"realized_return_pct": 10.0, "max_favorable_pct": 12.0, "max_adverse_pct": -2.0},
            {"realized_return_pct": -4.0, "max_favorable_pct": 1.0, "max_adverse_pct": -6.0},
        ])
        self.assertEqual(summary["observations"], 2)
        self.assertEqual(summary["positive_outcomes"], 1)
        self.assertEqual(summary["win_rate_pct"], 50.0)
        self.assertEqual(summary["median_return_pct"], 3.0)


if __name__ == "__main__":
    unittest.main()
