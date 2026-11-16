"""The replay's own correctness, separately from the engine it replays.

A backtest is only worth the discipline in its bookkeeping: the two ways this could
lie are showing the engine a bar it could not have seen, and grading an exit more
generously than the bar supports. Both are tested here directly.
"""
import json
import unittest
from datetime import date, timedelta
from pathlib import Path

import strong_swing_replay as replay
from strategy_math.common import Bar
from strategy_math.strong_swing import assess

FIXTURES = Path(__file__).resolve().parent / "testdata"


def bar(day: str, open_: float, high: float, low: float, close: float, volume: float = 1e6) -> Bar:
    return Bar(date=day, open=open_, high=high, low=low, close=close, volume=volume)


def flat_series(count: int, start: str = "2024-01-01") -> list[dict]:
    first = date.fromisoformat(start)
    return [{"date": str(first + timedelta(days=index)), "open": 100.0, "high": 100.4,
             "low": 99.6, "close": 100.0, "volume": 1_000_000.0} for index in range(count)]


class Grading(unittest.TestCase):
    """Entry at the next open, exits only where the bar supports them."""

    def test_the_entry_is_the_next_session_open_not_the_plan_price(self):
        forward = [bar("2024-02-01", 105.0, 106.0, 104.0, 105.5)]
        outcome = replay.grade(stop=90.0, target=200.0, forward=forward, horizon=20)
        self.assertEqual(outcome.entry_price, 105.0)
        self.assertEqual(outcome.entry_date, "2024-02-01")

    def test_a_target_touch_exits_at_the_target(self):
        forward = [bar("2024-02-01", 100.0, 101.0, 99.5, 100.5),
                   bar("2024-02-02", 100.5, 110.0, 100.0, 109.0)]
        outcome = replay.grade(stop=90.0, target=108.0, forward=forward, horizon=20)
        self.assertEqual(outcome.exit_reason, "TARGET")
        self.assertEqual(outcome.exit_price, 108.0)
        self.assertEqual(outcome.sessions_held, 2)
        self.assertAlmostEqual(outcome.return_pct, 8.0, places=6)

    def test_a_stop_touch_exits_at_the_stop(self):
        forward = [bar("2024-02-01", 100.0, 101.0, 92.0, 93.0)]
        outcome = replay.grade(stop=95.0, target=120.0, forward=forward, horizon=20)
        self.assertEqual(outcome.exit_reason, "STOP")
        self.assertEqual(outcome.exit_price, 95.0)
        self.assertAlmostEqual(outcome.return_pct, -5.0, places=6)

    def test_a_bar_that_spans_both_levels_is_scored_as_the_stop(self):
        """The daily bar does not say which came first; assuming the target flatters."""
        forward = [bar("2024-02-01", 100.0, 125.0, 90.0, 120.0)]
        outcome = replay.grade(stop=95.0, target=115.0, forward=forward, horizon=20)
        self.assertEqual(outcome.exit_reason, "STOP")

    def test_a_gap_through_the_stop_fills_at_the_open(self):
        """Overnight news does not wait at the stop price."""
        forward = [bar("2024-02-01", 100.0, 100.5, 99.0, 99.5),
                   bar("2024-02-02", 80.0, 82.0, 78.0, 79.0)]
        outcome = replay.grade(stop=95.0, target=130.0, forward=forward, horizon=20)
        self.assertEqual(outcome.exit_reason, "STOP")
        self.assertEqual(outcome.exit_price, 80.0)
        self.assertAlmostEqual(outcome.return_pct, -20.0, places=6)

    def test_a_gap_through_the_target_fills_at_the_open(self):
        forward = [bar("2024-02-01", 100.0, 100.5, 99.0, 99.5),
                   bar("2024-02-02", 130.0, 132.0, 128.0, 131.0)]
        outcome = replay.grade(stop=90.0, target=115.0, forward=forward, horizon=20)
        self.assertEqual(outcome.exit_reason, "TARGET")
        self.assertEqual(outcome.exit_price, 130.0)

    def test_an_untouched_plan_exits_at_the_horizon_close(self):
        forward = [bar(f"2024-02-{index:02d}", 100.0, 101.0, 99.0, 100.0 + index * .1)
                   for index in range(1, 10)]
        outcome = replay.grade(stop=80.0, target=130.0, forward=forward, horizon=5)
        self.assertEqual(outcome.exit_reason, "HORIZON")
        self.assertEqual(outcome.sessions_held, 5)
        self.assertEqual(outcome.exit_date, "2024-02-05")
        self.assertEqual(outcome.exit_price, 100.5)

    def test_excursions_cover_the_held_bars_only(self):
        forward = [bar("2024-02-01", 100.0, 104.0, 98.0, 101.0),
                   bar("2024-02-02", 101.0, 103.0, 96.0, 97.0),
                   bar("2024-02-03", 97.0, 200.0, 50.0, 150.0)]
        outcome = replay.grade(stop=95.0, target=300.0, forward=forward, horizon=20)
        self.assertEqual(outcome.exit_reason, "STOP")
        self.assertEqual(outcome.sessions_held, 3)
        # The exit bar counts, the bars after it do not exist to count.
        self.assertAlmostEqual(outcome.max_favorable_pct, 100.0, places=6)
        self.assertAlmostEqual(outcome.max_adverse_pct, -50.0, places=6)

    def test_a_signal_on_the_last_bar_cannot_be_graded(self):
        self.assertIsNone(replay.grade(stop=90.0, target=110.0, forward=[], horizon=20))


class NoLookahead(unittest.TestCase):
    def test_the_benchmark_slice_never_reaches_past_the_day(self):
        bars = flat_series(10)
        dates = [item["date"] for item in bars]
        sliced = replay.benchmark_slice(dates, bars, "2024-01-05")
        self.assertEqual([item["date"] for item in sliced],
                         ["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05"])

    def test_the_benchmark_slice_is_capped_at_the_production_window(self):
        bars = flat_series(400)
        dates = [item["date"] for item in bars]
        sliced = replay.benchmark_slice(dates, bars, dates[-1])
        self.assertEqual(len(sliced), replay.WINDOW)
        self.assertEqual(sliced[-1]["date"], dates[-1])

    def test_a_day_the_benchmark_did_not_trade_takes_the_session_before_it(self):
        bars = [item for item in flat_series(10) if item["date"] != "2024-01-05"]
        dates = [item["date"] for item in bars]
        self.assertEqual(replay.benchmark_slice(dates, bars, "2024-01-05")[-1]["date"], "2024-01-04")

    def test_every_assessment_sees_only_bars_up_to_its_own_day(self):
        """The invariant the whole replay rests on, asserted against the real scan."""
        data = json.loads((FIXTURES / "meesho_2026_11_16.json").read_text())
        seen: list[dict] = []
        original = replay.assess

        def recording(raw):
            seen.append(raw)
            return original(raw)

        replay.assess = recording
        try:
            options = _options()
            replay.scan_asset({"id": "x", "ticker": "TEST"},
                              [Bar.from_json(item) for item in data["bars"]], data["bars"],
                              {"sessions": [item["date"] for item in data["benchmark"]],
                               "bars": data["benchmark"], "ticker": "NIFTYBEES", "asset_id": "b"},
                              [], options)
        finally:
            replay.assess = original
        self.assertTrue(seen, "the fixture produced no assessment to check")
        for raw in seen:
            day = raw["bars"][-1]["date"]
            self.assertLessEqual(max(item["date"] for item in raw["bars"]), day)
            self.assertLessEqual(max(item["date"] for item in raw["benchmarkBars"]), day)
            self.assertEqual(raw["currentPrice"], raw["bars"][-1]["close"])
            # History has no open session, so the v6 session gates must stay inert.
            self.assertIsNone(raw["session"])


class ThePreScreenMatchesTheEngine(unittest.TestCase):
    """`breakout_candidate` skips days to save work; it must skip only days the engine
    would have called non-breakouts, or the replay silently loses signals."""

    def test_it_agrees_with_the_engine_on_every_day_of_a_real_series(self):
        data = json.loads((FIXTURES / "meesho_2026_11_16.json").read_text())
        bars_json, benchmark = data["bars"], data["benchmark"]
        bars = [Bar.from_json(item) for item in bars_json]
        dates = [item["date"] for item in benchmark]
        checked = 0
        for index in range(replay.MIN_BARS - 1, len(bars)):
            window = bars[max(0, index + 1 - replay.WINDOW):index + 1]
            verdict = assess({
                "market": "IN", "verdict": "REPLAY", "currentPrice": bars[index].close,
                "stopAtrMult": 1.5, "targetRR": 2.0, "trailAtrMult": 1.5,
                "bars": bars_json[max(0, index + 1 - replay.WINDOW):index + 1],
                "benchmarkBars": replay.benchmark_slice(dates, benchmark, bars[index].date),
                "requireLiveExecutionData": False, "results": replay.RESULTS_CLEAR,
                "session": None,
            })
            self.assertEqual(replay.breakout_candidate(window), verdict["isBreakout"],
                             f"pre-screen disagreed with the engine on {bars[index].date}")
            checked += 1
        self.assertGreater(checked, 20, "the fixture was too short to prove anything")


class ResultsReconstruction(unittest.TestCase):
    SESSIONS = ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09"]

    def test_sessions_are_counted_as_trading_days_not_calendar_days(self):
        # 05 to 09 is four calendar days and four sessions here; a weekend would differ.
        self.assertEqual(replay.sessions_until("2026-01-05", "2026-01-09", self.SESSIONS), 4)
        self.assertEqual(replay.sessions_until("2026-01-05", "2026-01-05", self.SESSIONS), 0)

    def test_a_date_the_calendar_does_not_bracket_is_unverifiable(self):
        """No results recorded before the day means the calendar did not cover it."""
        self.assertIsNone(replay.results_check(["2026-02-01"], "2026-01-06", self.SESSIONS))
        self.assertIsNone(replay.results_check([], "2026-01-06", self.SESSIONS))
        self.assertIsNone(replay.results_check(["2025-10-01"], "2026-01-06", self.SESSIONS))

    def test_a_bracketed_date_reports_the_next_results_and_its_lag(self):
        check = replay.results_check(["2025-10-01", "2026-01-08"], "2026-01-06", self.SESSIONS)
        self.assertEqual(check, {"verified": True, "sessionsToNext": 2,
                                 "nextDate": "2026-01-08",
                                 "detail": "Next results 2026-01-08, 2 session(s) out."})

    def test_an_unverifiable_calendar_blocks_the_engine_rather_than_passing_quietly(self):
        """The gate must fail the same way a missing calendar fails on the live screen."""
        data = json.loads((FIXTURES / "meesho_2026_11_16.json").read_text())
        verdict = assess({
            "market": "IN", "verdict": "REPLAY", "currentPrice": data["bars"][-1]["close"],
            "stopAtrMult": 1.5, "targetRR": 2.0, "trailAtrMult": 1.5,
            "bars": data["bars"], "benchmarkBars": data["benchmark"],
            "requireLiveExecutionData": False, "results": None, "session": None,
        })
        gate = next(item for item in verdict["gates"] if item["key"] == "results_blackout")
        self.assertFalse(gate["passed"])
        self.assertNotEqual(verdict["status"], "EXECUTION_READY")


class Summary(unittest.TestCase):
    def test_expectancy_counts_losses_as_well_as_wins(self):
        outcomes = [
            replay.Outcome("d", 100, "d", 110, "TARGET", 10.0, 10.0, 0.0, 3),
            replay.Outcome("d", 100, "d", 95, "STOP", -5.0, 1.0, -5.0, 2),
            replay.Outcome("d", 100, "d", 95, "STOP", -5.0, 1.0, -5.0, 2),
        ]
        stats = replay.summarize(outcomes)
        self.assertAlmostEqual(stats["win_rate_pct"], 100 / 3, places=6)
        self.assertAlmostEqual(stats["expectancy_pct"], 0.0, places=6)
        self.assertEqual(stats["target_hits"], 1)
        self.assertEqual(stats["stop_hits"], 2)

    def test_an_empty_sample_concludes_nothing(self):
        self.assertEqual(replay.summarize([]), {"graded": 0})


def _options():
    import argparse
    return argparse.Namespace(market="IN", start="1900-01-01", end="2099-12-31", horizon=20,
                              results="ignored", overlap="first", stop_atr=1.5,
                              target_rr=2.0, trail_atr=1.5)


if __name__ == "__main__":
    unittest.main()
