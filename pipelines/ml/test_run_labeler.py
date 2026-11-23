import os
import sys
import unittest
from decimal import Decimal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from labeler import LabelOutcome
from run_labeler import derive_atr_and_trail, should_defer


class RunLabelerTests(unittest.TestCase):
    def test_defer_logic_waits_for_matured_windows(self):
        self.assertTrue(should_defer(LabelOutcome.INVALID_DATA, "holding window extends beyond supplied sessions", 4))
        self.assertTrue(should_defer(LabelOutcome.NOT_ENTERED, None, 3))
        self.assertFalse(should_defer(LabelOutcome.NOT_ENTERED, None, 5))
        self.assertFalse(should_defer(LabelOutcome.TARGET_FIRST, None, 2))
        self.assertFalse(should_defer(LabelOutcome.STOP_FIRST, None, 1))
        self.assertFalse(should_defer(LabelOutcome.WINDOW_EXPIRED, None, 15))

    def test_derive_atr_and_trail_uses_metrics_or_safe_fallback(self):
        atr, trail_dist = derive_atr_and_trail(
            Decimal("100"), Decimal("94"), Decimal("92"), {"atrPct": 3.5}
        )
        self.assertEqual(atr, Decimal("3.5"))
        self.assertEqual(trail_dist, Decimal("8"))

        atr2, trail_dist2 = derive_atr_and_trail(
            Decimal("100"), Decimal("94"), Decimal("100"), {}
        )
        self.assertEqual(atr2, Decimal("4"))
        self.assertEqual(trail_dist2, Decimal("8"))


if __name__ == "__main__":
    unittest.main()
