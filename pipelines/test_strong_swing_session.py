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
        result = run(ready_price(), {"date": bars[-1]["date"], "high": 140.0, "low": 90.0}, bars=bars)
        self.assertTrue(gate(result, "session_reversal")["passed"])
        self.assertIn("No live session", gate(result, "session_reversal")["detail"])
        self.assertEqual(result["status"], "EXECUTION_READY")

    def test_a_session_at_its_own_high_passes_both(self):
        price = ready_price()
        result = run(price, {"date": "2027-01-01", "high": price, "low": price - .3})
        self.assertTrue(gate(result, "session_hold")["passed"])
        self.assertTrue(gate(result, "session_reversal")["passed"])
        self.assertEqual(result["status"], "EXECUTION_READY")
        self.assertEqual(result["sessionGiveBackAtr"], 0)


class SlippingBelowThePriorCloseWaits(unittest.TestCase):
    def test_below_the_last_completed_close_waits_rather_than_blocks(self):
        bars = holding_breakout()
        prior_close = bars[-1]["close"]
        # Barely off the session high, so the hold rule trips on its own.
        result = run(prior_close - .05,
                     {"date": "2027-01-01", "high": prior_close + .02, "low": prior_close - .1},
                     bars=bars)
        self.assertFalse(gate(result, "session_hold")["passed"])
        self.assertTrue(gate(result, "session_reversal")["passed"])
        self.assertEqual(result["status"], "WAIT_FOR_ENTRY")
        self.assertIn("wait for the breakout to hold", gate(result, "session_hold")["detail"])

    def test_holding_exactly_at_the_prior_close_is_holding(self):
        bars = holding_breakout()
        close = bars[-1]["close"]
        result = run(close, {"date": "2027-01-01", "high": close, "low": close - .2}, bars=bars)
        self.assertTrue(gate(result, "session_hold")["passed"])
        self.assertEqual(result["status"], "EXECUTION_READY")


class HandingBackTheMoveBlocks(unittest.TestCase):
    def test_a_give_back_wider_than_the_entry_zone_is_risk_off(self):
        price = ready_price()
        atr = run()["atr"]
        result = run(price, {"date": "2027-01-01", "high": price + .9 * atr, "low": price - .2})
        self.assertFalse(gate(result, "session_reversal")["passed"])
        self.assertEqual(result["status"], "RISK_OFF")
        self.assertAlmostEqual(result["sessionGiveBackAtr"], .9, places=6)

    def test_the_reversal_rule_outranks_the_hold_rule(self):
        """Both trip together in a real reversal; the blocking one has to decide."""
        bars = holding_breakout()
        atr = run()["atr"]
        close = bars[-1]["close"]
        result = run(close - .1, {"date": "2027-01-01", "high": close - .1 + .9 * atr, "low": close - .3},
                     bars=bars)
        self.assertFalse(gate(result, "session_hold")["passed"])
        self.assertFalse(gate(result, "session_reversal")["passed"])
        self.assertEqual(result["status"], "RISK_OFF")

    def test_the_ceiling_is_the_entry_zone_width_not_a_second_number(self):
        self.assertEqual(SESSION_GIVE_BACK_ATR, .5)
        price, atr = ready_price(), run()["atr"]
        inside = run(price, {"date": "2027-01-01", "high": price + .49 * atr, "low": price - .2})
        outside = run(price, {"date": "2027-01-01", "high": price + .51 * atr, "low": price - .2})
        self.assertTrue(gate(inside, "session_reversal")["passed"])
        self.assertFalse(gate(outside, "session_reversal")["passed"])


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

    def test_with_the_session_it_is_blocked(self):
        result = self._run(self.data["session"])
        self.assertEqual(result["status"], "RISK_OFF")
        self.assertFalse(gate(result, "session_hold")["passed"])
        self.assertFalse(gate(result, "session_reversal")["passed"])
        # The entry trigger was never breached, which is why nothing else caught it.
        self.assertTrue(gate(result, "entry_zone")["passed"])
        self.assertAlmostEqual(result["sessionGiveBackAtr"], .62, places=2)


class LiveMicrostructureAndHoldHardening(unittest.TestCase):
    def test_crossed_bid_ask_fails_live_spread(self):
        price = ready_price()
        result = assess({
            "market": "IN", "verdict": "BREAKOUT", "currentPrice": price,
            "stopAtrMult": 1.5, "targetRR": 2.0, "trailAtrMult": 1.5,
            "bars": holding_breakout(), "benchmarkBars": slow_benchmark(),
            "requireLiveExecutionData": True,
            "microstructure": {"quoteFresh": True, "bestBid": price + 0.5, "bestAsk": price - 0.5},
            "results": RESULTS_CLEAR,
        })
        self.assertFalse(gate(result, "live_spread")["passed"])
        self.assertEqual(result["status"], "RISK_OFF")

    def test_live_session_hold_enforced_even_before_intraday_bar_lands(self):
        bars = holding_breakout()
        prior_close = bars[-1]["close"]
        price = prior_close - 0.05
        result = assess({
            "market": "IN", "verdict": "BREAKOUT", "currentPrice": price,
            "stopAtrMult": 1.5, "targetRR": 2.0, "trailAtrMult": 1.5,
            "bars": bars, "benchmarkBars": slow_benchmark(),
            "requireLiveExecutionData": True,
            "microstructure": {"quoteFresh": True, "bestBid": price - 0.05, "bestAsk": price + 0.05},
            "session": None,
            "results": RESULTS_CLEAR,
        })
        self.assertFalse(gate(result, "session_hold")["passed"])
        self.assertEqual(result["status"], "WAIT_FOR_ENTRY")


if __name__ == "__main__":
    unittest.main()
