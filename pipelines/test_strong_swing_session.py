"""The open session's direction, not just its last price.

Until these rules the live session reached the gates only as `currentPrice`, and that was
tested for its distance from the entry trigger but never for direction. A stock could gap up,
fail at the high, hand the whole move back and still report EXECUTION_READY, because it was
still sitting above the trigger. MEESHO did exactly that on 2026-11-16 and ranked first all
morning; `MeeshoRegression` replays that session from the bars production actually used.
"""
import json
import unittest
from datetime import date, timedelta
from pathlib import Path

from strategy_math.strong_swing import SESSION_GIVE_BACK_ATR, assess

RESULTS_CLEAR = {"verified": True, "sessionsToNext": None, "nextDate": None,
                 "detail": "No results due."}
FIXTURES = Path(__file__).resolve().parent / "testdata"


def holding_breakout(count: int = 240) -> list[dict]:
    """A flat base, a decisive breakout bar, then a quieter bar that holds above the entry.

    Tuned so the live price can sit inside the entry band *and* at or above the last completed
    close; otherwise the entry-zone gate decides every case and the session rules are never
    the thing under test.
    """
    first = date(2026, 1, 1)
    out = []
    for index in range(count):
        from_end = count - 1 - index
        if from_end == 1:
            close, high, low, volume = 102.0, 102.2, 100.6, 4_000_000
        elif from_end == 0:
            close, high, low, volume = 101.0, 101.15, 100.65, 2_600_000
        else:
            close = 100 + (index % 5) * 0.1
            high, low, volume = close + 0.3, close - 0.5, 1_500_000
        out.append({"date": str(first + timedelta(days=index)), "open": low + 0.1,
                    "high": high, "low": low, "close": close, "volume": volume})
    return out


def slow_benchmark(count: int = 240) -> list[dict]:
    """Rising, so the regime holds, but slower than the stock, so relative strength holds."""
    first = date(2026, 1, 1)
    return [{"date": str(first + timedelta(days=index)), "open": 100 + index * .01,
             "high": 100 + index * .01 + .4, "low": 100 + index * .01 - .4,
             "close": 100 + index * .01, "volume": 1_000_000} for index in range(count)]


def run(price: float | None = None, session: dict | None = None, *,
        bars: list[dict] | None = None, benchmark: list[dict] | None = None) -> dict:
    return assess({
        "market": "IN", "verdict": "BREAKOUT", "currentPrice": price,
        "stopAtrMult": 1.5, "targetRR": 2.0, "trailAtrMult": 1.5,
        "bars": holding_breakout() if bars is None else bars,
        "benchmarkBars": slow_benchmark() if benchmark is None else benchmark,
        "requireLiveExecutionData": False, "session": session, "results": RESULTS_CLEAR,
    })


def gate(result: dict, key: str) -> dict:
    return next(item for item in result["gates"] if item["key"] == key)


def ready_price() -> float:
    """A live price inside the entry band and at or above the last completed close."""
    plan = run()
    return plan["strongEntry"] + .3 * plan["atr"]


class TheFixtureIsReady(unittest.TestCase):
    """Guards the tests below: without this, a failing gate elsewhere would mask the rules."""

    def test_every_gate_passes_before_a_session_is_introduced(self):
        result = run(ready_price())
        self.assertEqual([item["key"] for item in result["gates"] if not item["passed"]], [])
        self.assertEqual(result["status"], "EXECUTION_READY")

    def test_the_live_price_is_at_or_above_the_last_completed_close(self):
        self.assertGreaterEqual(ready_price(), holding_breakout()[-1]["close"])


class SessionGatesAreInert(unittest.TestCase):
    """Nothing changes when there is no open session to judge."""

    def test_no_session_leaves_both_gates_passing(self):
        result = run(ready_price())
        self.assertTrue(gate(result, "session_hold")["passed"])
        self.assertTrue(gate(result, "session_reversal")["passed"])
        self.assertIsNone(result["sessionHigh"])
        self.assertIsNone(result["sessionGiveBackAtr"])

    def test_a_session_dated_at_the_latest_bar_is_not_a_live_session(self):
        """Judging the newest completed bar against itself would be circular."""
        bars = holding_breakout()
        price = ready_price()
        result = run(price, {"date": bars[-1]["date"], "open": price, "high": 140.0, "low": 90.0},
                     bars=bars)
        self.assertTrue(gate(result, "session_reversal")["passed"])
        self.assertIn("No live session", gate(result, "session_reversal")["detail"])
        self.assertEqual(result["status"], "EXECUTION_READY")

    def test_a_session_at_its_own_high_passes_both(self):
        price = ready_price()
        result = run(price, {"date": "2027-01-01", "open": price, "high": price, "low": price - .3})
        self.assertTrue(gate(result, "session_hold")["passed"])
        self.assertTrue(gate(result, "session_reversal")["passed"])
        self.assertEqual(result["status"], "EXECUTION_READY")
        self.assertEqual(result["sessionGiveBackAtr"], 0)


class SessionGatesAreAdvisory(unittest.TestCase):
    """From v7 the session gates report; they do not veto.

    They shipped on one observation and a controlled replay then put them at an identical
    47.3% win rate against a control arm that withheld the session, while removing four of
    every five signals. A reader still needs to see that the move is being handed back, so
    the gates stay and stay visible — they simply no longer decide.
    """

    def _reversing(self, price_mult=.4):
        price = run()["strongEntry"] + price_mult * run()["atr"]
        atr = run()["atr"]
        # Well past the old 0.50 ATR give-back ceiling, and below the prior close.
        return run(price, {"date": "2027-01-01", "open": price,
                           "high": price + .9 * atr, "low": price - .2})

    def test_both_gates_are_declared_non_blocking(self):
        result = self._reversing()
        for key in ("session_hold", "session_reversal"):
            self.assertFalse(gate(result, key)["blocking"], f"{key} must be advisory")

    def test_a_reversal_is_reported_but_does_not_change_the_status(self):
        result = self._reversing()
        self.assertFalse(gate(result, "session_reversal")["passed"])
        self.assertEqual(result["status"], "EXECUTION_READY")

    def test_slipping_below_the_prior_close_is_reported_but_does_not_wait(self):
        # The hold bar closes well clear of the trigger, so the entry band and the prior
        # close can be straddled at once: with the default fixture the band floor sits
        # above the close and the two conditions cannot both be exercised.
        bars = holding_breakout()
        bars[-1] = dict(bars[-1], close=101.8, high=101.9, low=101.0)
        plan = run(bars=bars)
        price = plan["strongEntry"] + .4 * plan["atr"]
        self.assertLess(price, bars[-1]["close"], "fixture must put the price under the close")
        result = run(price, {"date": "2027-01-01", "open": price,
                             "high": price + .1, "low": price - .1}, bars=bars)
        self.assertFalse(gate(result, "session_hold")["passed"])
        self.assertTrue(gate(result, "entry_zone")["passed"], "only the hold rule is in question")
        self.assertEqual(result["status"], "EXECUTION_READY")

    def test_the_give_back_is_still_measured_and_reported(self):
        """Demoted, not deleted: the number a reader judges by must still be right."""
        result = self._reversing()
        self.assertAlmostEqual(result["sessionGiveBackAtr"], .9, places=6)
        self.assertIn("handed back", gate(result, "session_reversal")["detail"])


class MeeshoRegression(unittest.TestCase):
    """2026-11-16: ranked first and EXECUTION_READY while the stock reversed intraday.

    The bars are the ones production fed the engine that morning, recorded in
    testdata/meesho_2026_11_16.json: completed sessions ending Friday 2026-11-13 at 257.07,
    and the live partial bar that opened 259.00, reached 261.10 and traded back to 255.63.
    """

    @classmethod
    def setUpClass(cls):
        cls.data = json.loads((FIXTURES / "meesho_2026_11_16.json").read_text())

    def _run(self, session):
        return run(self.data["currentPrice"], session,
                   bars=self.data["bars"], benchmark=self.data["benchmark"])

    def test_the_fixture_reproduces_the_levels_production_recorded(self):
        result = self._run(None)
        self.assertEqual(result["latestDate"], "2026-11-13")
        self.assertAlmostEqual(result["latestClose"], 257.07, places=2)
        self.assertAlmostEqual(result["strongEntry"], 252.96, places=2)
        self.assertAlmostEqual(result["atr"], 8.76, places=2)

    def test_without_the_session_it_reads_execution_ready(self):
        """The defect itself: this is what the screen showed all morning."""
        self.assertEqual(self._run(None)["status"], "EXECUTION_READY")

    def test_with_the_session_it_is_flagged_but_no_longer_blocked(self):
        """The case that motivated the v6 gates, and the cost of retiring them.

        Under v6 this read RISK_OFF. Under v7 it reads EXECUTION_READY again, with both
        session gates failing in plain sight. That is the deliberate trade: the replay
        could not show that blocking these paid, so the screen warns instead of refusing.
        Its 0.31 ATR extension sits inside the v7 entry band, so nothing else stops it.
        """
        result = self._run(self.data["session"])
        self.assertFalse(gate(result, "session_hold")["passed"])
        self.assertFalse(gate(result, "session_reversal")["passed"])
        self.assertAlmostEqual(result["sessionGiveBackAtr"], .62, places=2)
        self.assertTrue(gate(result, "entry_zone")["passed"])
        self.assertEqual(result["status"], "EXECUTION_READY")

    def test_v8_does_not_rescue_this_case_either(self):
        """Worth pinning, so the entry_open gate is not mistaken for a cure.

        MEESHO opened at 259.00, which is 0.69 ATR above the 252.96 entry and so inside the
        0.25-0.75 band: it gapped in exactly as the measured population does, and then handed
        the move back anyway. The gate removes the days that WALK into the band, measured at
        -0.15% per trade; it does not claim the days that gap in always work, and that
        population still wins only 48.8% of the time. This case is one of its losses.
        """
        result = self._run(self.data["session"])
        self.assertTrue(gate(result, "entry_open")["passed"])
        self.assertAlmostEqual(result["openExtensionAtr"], .69, places=2)
        self.assertEqual(result["sessionOpen"], 259.0)
        self.assertEqual(result["status"], "EXECUTION_READY")


if __name__ == "__main__":
    unittest.main()
