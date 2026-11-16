"""The entry band: a floor as well as a ceiling.

Until v7 the rule was a ceiling alone — anything from the trigger up to 0.50 ATR
qualified, on the reasoning that a price nearer the trigger is a better price. The
historical replay says the reverse, in both halves of a decade split before the
thresholds were picked: fills in the first 0.25 ATR above the trigger returned -0.41%
per trade in 2017-22 and -0.32% in 2023-26, against +0.68% and +0.87% for 0.25-0.75
ATR, and those flat fills were 44% of every signal the strategy produced.

These tests pin the band's edges and, more importantly, the reason it has a floor at
all — so that a later change has to argue with the measurement rather than with a
number that looks arbitrary.
"""
import unittest

from strategy_math.strong_swing import ENTRY_BAND_MAX_ATR, ENTRY_BAND_MIN_ATR
from test_strong_swing_session import RESULTS_CLEAR, gate, holding_breakout, run


def at(extension: float) -> dict:
    """Assess with the live price a given number of ATR above the confirmed entry."""
    plan = run()
    return run(plan["strongEntry"] + extension * plan["atr"])


class TheBandHasBothEdges(unittest.TestCase):
    def test_the_floor_and_ceiling_are_the_measured_ones(self):
        self.assertEqual((ENTRY_BAND_MIN_ATR, ENTRY_BAND_MAX_ATR), (0.25, 0.75))

    def test_inside_the_band_is_execution_ready(self):
        for extension in (0.3, 0.5, 0.7):
            with self.subTest(extension=extension):
                result = at(extension)
                self.assertTrue(gate(result, "entry_zone")["passed"])
                self.assertEqual(result["status"], "EXECUTION_READY")

    def test_a_fill_hugging_the_trigger_is_refused(self):
        """The change this version exists for: 44% of signals, and all of the losses."""
        for extension in (0.0, 0.1, 0.2):
            with self.subTest(extension=extension):
                result = at(extension)
                self.assertFalse(gate(result, "entry_zone")["passed"])
                self.assertEqual(result["status"], "WAIT_FOR_ENTRY")

    def test_too_far_above_the_trigger_is_still_refused(self):
        result = at(0.9)
        self.assertFalse(gate(result, "entry_zone")["passed"])
        self.assertEqual(result["status"], "WAIT_FOR_ENTRY")

    def test_a_price_below_the_trigger_is_refused_and_says_so_plainly(self):
        result = at(-0.5)
        self.assertFalse(gate(result, "entry_zone")["passed"])
        self.assertIn("below the confirmed entry", gate(result, "entry_zone")["detail"])
        self.assertEqual(result["status"], "WAIT_FOR_ENTRY")


class TheRefusalExplainsItself(unittest.TestCase):
    """A gate that refuses a price the previous version accepted has to say why, or it
    reads as a malfunction to anyone who knew the old rule."""

    def test_a_fill_under_the_floor_names_the_floor_and_the_reason(self):
        detail = gate(at(0.1), "entry_zone")["detail"]
        self.assertIn("0.25 ATR", detail)
        self.assertIn("lose money", detail)

    def test_a_fill_over_the_ceiling_names_the_ceiling(self):
        self.assertIn("maximum 0.75 ATR", gate(at(0.9), "entry_zone")["detail"])

    def test_an_accepted_fill_reports_the_band_it_sits_in(self):
        self.assertIn("band is 0.25-0.75 ATR", gate(at(0.5), "entry_zone")["detail"])


class TheBandIsNotTheOnlyGate(unittest.TestCase):
    """Guards against the band quietly becoming the whole strategy."""

    def test_a_price_inside_the_band_still_needs_the_technical_case(self):
        flat = [dict(bar, close=100.0, high=100.2, low=99.8) for bar in holding_breakout()]
        result = run(120.0, bars=flat)
        self.assertNotEqual(result["status"], "EXECUTION_READY")

    def test_the_band_is_an_execution_gate_not_a_technical_one(self):
        self.assertEqual(gate(at(0.1), "entry_zone")["category"], "execution")
        self.assertTrue(gate(at(0.1), "entry_zone")["blocking"])


if __name__ == "__main__":
    unittest.main()
