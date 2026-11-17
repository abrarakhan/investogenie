"""The band read against the session's open, not only the live quote.

The v7 band's measured edge belongs to days that *gapped* into it. One-minute paths for
1,295 entries across 2017-2026 separate the cases cleanly:

    opened inside the band            565 trades   48.8% win   +0.40% avg
    opened below the floor, rose in   247 trades   41.7% win   -0.25% avg
    opened above the ceiling, fell in 483 trades   48.0% win   -0.09% avg

Both of the later-entry halves lose, and it is not a timing artefact: they are worse in
every part of the session, the opening minute included. A live quote alone cannot tell the
cases apart, so before v8 the screen offered all three and the per-trade edge was +0.09%
rather than +0.40%.

These tests pin the gate's shape, and deliberately pin what it does NOT do: it stands aside
when there is no session to ask about, and it fails loudly rather than quietly when a
session is open but its opening price is missing.
"""
import unittest

from strategy_math.strong_swing import ENTRY_BAND_MAX_ATR, ENTRY_BAND_MIN_ATR
from test_strong_swing_session import gate, ready_price, run


def opened_at(extension: float, *, price_extension: float = .3) -> dict:
    """Assess with a live session that opened a given number of ATR above the entry.

    The live price is held inside the band throughout, so entry_zone passes and the gate
    under test is the only thing that can decide the outcome.
    """
    plan = run()
    price = plan["strongEntry"] + price_extension * plan["atr"]
    session_open = plan["strongEntry"] + extension * plan["atr"]
    return run(price, {"date": "2027-01-01", "open": session_open,
                       "high": max(price, session_open), "low": min(price, session_open) - .1})


class TheOpenIsJudgedAgainstTheSameBand(unittest.TestCase):
    def test_an_open_inside_the_band_is_execution_ready(self):
        # A hair inside each edge rather than exactly on it: the band is compared with a bare
        # <=, as entry_zone is, so an open built as entry + 0.25 * atr can read back as
        # 0.2499...  Giving this one gate a tolerance the quote's reading does not have is
        # exactly the drift between the two readings that test_the_edges... guards against.
        for extension in (0.26, 0.4, 0.74):
            with self.subTest(extension=extension):
                result = opened_at(extension)
                self.assertTrue(gate(result, "entry_open")["passed"])
                self.assertEqual(result["status"], "EXECUTION_READY")

    def test_an_open_above_the_ceiling_waits_even_though_the_quote_is_in_the_band(self):
        """The 483-trade population: already run too far, now falling back through the band."""
        result = opened_at(1.2)
        self.assertTrue(gate(result, "entry_zone")["passed"], "the quote itself is in the band")
        self.assertFalse(gate(result, "entry_open")["passed"])
        self.assertEqual(result["status"], "WAIT_FOR_ENTRY")

    def test_an_open_below_the_floor_waits_even_though_the_quote_is_in_the_band(self):
        """The 247-trade population, and the worse of the two at -0.25% per trade."""
        result = opened_at(-0.1)
        self.assertTrue(gate(result, "entry_zone")["passed"], "the quote itself is in the band")
        self.assertFalse(gate(result, "entry_open")["passed"])
        self.assertEqual(result["status"], "WAIT_FOR_ENTRY")

    def test_the_edges_are_the_same_numbers_the_quote_is_held_to(self):
        """One band, two readings of it: a second set of thresholds would drift apart."""
        plan = run()
        just_over = opened_at(ENTRY_BAND_MAX_ATR + .05)
        just_under = opened_at(ENTRY_BAND_MIN_ATR - .05)
        self.assertFalse(gate(just_over, "entry_open")["passed"])
        self.assertFalse(gate(just_under, "entry_open")["passed"])
        self.assertAlmostEqual(just_over["openExtensionAtr"], ENTRY_BAND_MAX_ATR + .05, places=6)
        self.assertGreater(plan["atr"], 0, "a zero ATR would make the band meaningless")


class WithoutASessionTheGateStandsAside(unittest.TestCase):
    """Mirrors the live_* gates: a question that cannot be asked must not be a veto.

    Outside an open session there is no next open yet, and the band is read against the last
    close exactly as it was before v8. Making this a failure instead would mean nothing is
    ever actionable outside market hours, which the measurement does not support.
    """

    def test_no_session_passes_and_says_why(self):
        result = run(ready_price())
        self.assertTrue(gate(result, "entry_open")["passed"])
        self.assertIn("No live session", gate(result, "entry_open")["detail"])
        self.assertEqual(result["status"], "EXECUTION_READY")
        self.assertIsNone(result["sessionOpen"])

    def test_a_session_dated_at_the_latest_completed_bar_is_not_a_session(self):
        """Judging the newest completed bar's own open against itself would be circular."""
        from test_strong_swing_session import holding_breakout
        bars = holding_breakout()
        price = ready_price()
        result = run(price, {"date": bars[-1]["date"], "open": price + 99, "high": price,
                             "low": price - .3}, bars=bars)
        self.assertTrue(gate(result, "entry_open")["passed"])
        self.assertEqual(result["status"], "EXECUTION_READY")


class AMissingOpenFailsRatherThanPasses(unittest.TestCase):
    def test_an_open_session_without_an_opening_price_is_refused(self):
        """The one case that must not be silent.

        A dated session whose open is absent is a question with an answer that is simply not
        at hand. Passing would quietly restore the v7 behaviour the measurement rejected, and
        it would do so invisibly, on a data gap rather than a decision.
        """
        price = ready_price()
        result = run(price, {"date": "2027-01-01", "high": price, "low": price - .3})
        self.assertFalse(gate(result, "entry_open")["passed"])
        self.assertIn("unavailable", gate(result, "entry_open")["detail"])
        self.assertEqual(result["status"], "WAIT_FOR_ENTRY")
        self.assertIsNone(result["sessionOpen"])


class TheGateIsShapedLikeItsNeighbours(unittest.TestCase):
    def test_it_is_a_blocking_execution_gate(self):
        result = opened_at(0.4)
        self.assertTrue(gate(result, "entry_open")["blocking"])
        self.assertEqual(gate(result, "entry_open")["category"], "execution")

    def test_a_failure_waits_rather_than_calling_it_risk_off(self):
        """Where the price opened is not a breach of risk; it is the wrong moment."""
        self.assertEqual(opened_at(1.5)["status"], "WAIT_FOR_ENTRY")

    def test_the_refusal_names_the_open_the_band_and_the_reason(self):
        detail = gate(opened_at(1.2), "entry_open")["detail"]
        self.assertIn("Opened at", detail)
        self.assertIn(f"{ENTRY_BAND_MIN_ATR:.2f}-{ENTRY_BAND_MAX_ATR:.2f} ATR band", detail)
        self.assertIn("walk into the band", detail)


if __name__ == "__main__":
    unittest.main()
