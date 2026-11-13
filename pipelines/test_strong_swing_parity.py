import unittest
from datetime import date, timedelta

from pipelines.strong_swing_parity import (
    Bar, average_true_range, bar_gates, breakout_failed, breakout_level, confirmation_breakout, differences,
    expected_status, gate_differences, plan, round2, structural_breakout,
)


def breakout_bars(count=240, clears=True):
    """The same series as breakoutBars() in lib/analytics/strongSwing.test.ts."""
    out = []
    for index in range(count):
        from_end = count - 1 - index
        close = (112 if clears else 100.4) if from_end <= 1 else 100 + (index % 5) * 0.1
        out.append(Bar(date(2025, 1, 1) + timedelta(days=index), close + 0.2, close - 0.6, close))
    return out


def choppy_breakout_bars(tail, count=240):
    """The same series as choppyBreakoutBars() in lib/analytics/strongSwing.test.ts."""
    closes = [98 + (index % 3) * 2 for index in range(count - len(tail))] + list(tail)
    return [Bar(date(2025, 1, 1) + timedelta(days=i), close + 0.2, close - 0.6, close) for i, close in enumerate(closes)]


class StrongSwingParityTests(unittest.TestCase):
    def test_rounding_matches_javascript(self):
        self.assertEqual(round2(1.005), 1.0)   # 1.005 is 1.00499… in binary, as in JS
        self.assertEqual(round2(2.675), 2.68)
        self.assertEqual(round2(112.345), 112.35)

    def test_atr_is_the_mean_true_range_of_the_last_fourteen_bars(self):
        bars = [Bar(date(2025, 1, 1) + timedelta(days=i), 12, 8, 10) for i in range(30)]
        self.assertAlmostEqual(average_true_range(bars), 4.0)
        gap = bars + [Bar(date(2025, 3, 1), 21, 19, 20)]
        self.assertAlmostEqual(average_true_range(gap), (13 * 4 + 11) / 14)

    def test_breakout_and_level_follow_the_typescript_definitions(self):
        self.assertTrue(structural_breakout(breakout_bars()))
        self.assertFalse(structural_breakout(breakout_bars(clears=False)))
        self.assertAlmostEqual(breakout_level(breakout_bars()), 100.6)

    def test_reference_values_shared_with_the_typescript_suite(self):
        # Mirrored in lib/analytics/strongSwing.test.ts; change both together.
        levels = plan(breakout_bars())
        self.assertAlmostEqual(levels["atr"], 1.6285714285714263, places=9)
        self.assertAlmostEqual(levels["entry"], 101.00714285714287, places=9)
        self.assertEqual((levels["stop"], levels["target"], levels["trail"], levels["invalidation_trail"]), (98.57, 105.89, 98.57, 98.55))
        flat = plan(breakout_bars(clears=False))
        self.assertAlmostEqual(flat["atr"], 0.8285714285714262, places=9)
        self.assertEqual((flat["trail"], flat["breakout"]), (99.57, False))

    def test_a_day_one_breakout_that_holds_counts_and_the_trail_waits_a_bar(self):
        bars = breakout_bars()
        held = choppy_breakout_bars([104.5, 104.0])
        self.assertTrue(structural_breakout(held[:-1]))
        self.assertFalse(structural_breakout(held))
        self.assertTrue(confirmation_breakout(held))
        self.assertFalse(confirmation_breakout(choppy_breakout_bars([104.5, 104.0, 103.8])))
        spike = bars[:-1] + [Bar(bars[-1].date, bars[-1].close + 30, bars[-1].close - 2, bars[-1].close)]
        levels = plan(spike)
        self.assertEqual(levels["trail"], levels["stop"])
        self.assertLess(levels["trail"], levels["entry"])
        calm = plan(held)
        collapse = held[:-1] + [Bar(held[-1].date, held[-1].close + 1, calm["invalidation_trail"] - 12, calm["invalidation_trail"] - 0.05)]
        fallen = plan(collapse)
        self.assertEqual(fallen["invalidation_trail"], calm["invalidation_trail"])
        self.assertLess(fallen["trail"], collapse[-1].close)

    def test_plan_levels_are_ordered_and_use_one_atr(self):
        levels = plan(breakout_bars())
        self.assertLess(levels["stop"], levels["entry"])
        self.assertLess(levels["entry"], levels["target"])
        self.assertAlmostEqual(levels["entry"], 100.6 + 0.25 * levels["atr"])
        self.assertAlmostEqual(levels["stop"], round2(round2(levels["entry"]) - 1.5 * levels["atr"]))

    def test_a_recorded_plan_built_on_another_atr_is_reported(self):
        expected = plan(breakout_bars())
        recorded = {"entry": expected["entry"], "stop": expected["stop"], "target": expected["target"],
                    "trail": expected["trail"], "atr_pct": expected["atr_pct"], "breakout": expected["breakout"]}
        self.assertEqual(differences(recorded, expected), [])
        inflated = {**recorded, "atr_pct": expected["atr_pct"] * 1.2, "stop": expected["stop"] - 1}
        self.assertEqual(differences(inflated, expected), ["stop", "atr"])
        self.assertEqual(differences({**recorded, "breakout": not expected["breakout"]}, expected), ["breakout"])

    def test_bar_gates_follow_the_bars(self):
        gates = bar_gates(breakout_bars())
        # Both closes sit at 112 against a 101.01 entry: held, decisive, but far above the 20-day average.
        self.assertTrue(gates["follow_through"])
        self.assertTrue(gates["clearance"])
        self.assertTrue(gates["close_quality"])
        self.assertTrue(gates["price"])
        self.assertTrue(gates["trend"])
        self.assertTrue(gates["sma20_extension"])
        self.assertTrue(gates["atr_risk"])
        self.assertTrue(gates["extension_5d"])
        # The fixture carries no volume, so participation and liquidity cannot pass.
        self.assertFalse(gates["volume"])
        self.assertFalse(gates["liquidity"])
        self.assertFalse(bar_gates(breakout_bars(clears=False))["follow_through"])

    def test_a_recorded_gate_the_bars_contradict_is_reported(self):
        bars = breakout_bars()
        recorded = [{"key": key, "passed": passed} for key, passed in bar_gates(bars).items()]
        self.assertEqual(gate_differences(recorded, bars, "IN", 1.5), [])
        recorded[0]["passed"] = not recorded[0]["passed"]
        self.assertEqual(gate_differences(recorded, bars, "IN", 1.5), [recorded[0]["key"]])

    def test_status_follows_from_the_gates(self):
        def gates(**failed):
            keys = [("structure", "technical"), ("follow_through", "technical"), ("entry_zone", "execution"),
                    ("sma20_extension", "execution"), ("atr_risk", "execution"), ("market_regime", "execution")]
            return [{"key": key, "category": category, "blocking": key != "market_regime",
                     "passed": not failed.get(key, False)} for key, category in keys]
        self.assertEqual(expected_status(gates(), False), "EXECUTION_READY")
        self.assertEqual(expected_status(gates(market_regime=True), False), "EXECUTION_READY")
        self.assertEqual(expected_status(gates(follow_through=True), False), "WATCHLIST")
        self.assertEqual(expected_status(gates(entry_zone=True), False), "WAIT_FOR_ENTRY")
        self.assertEqual(expected_status(gates(sma20_extension=True), False), "WAIT_FOR_ENTRY")
        self.assertEqual(expected_status(gates(sma20_extension=True, follow_through=True), False), "RISK_OFF")
        self.assertEqual(expected_status(gates(atr_risk=True), False), "RISK_OFF")
        self.assertEqual(expected_status(gates(), True), "INVALIDATED")

    def test_a_breakout_a_full_atr_back_below_its_level_has_failed(self):
        self.assertFalse(breakout_failed(breakout_bars()))
        self.assertTrue(breakout_failed(choppy_breakout_bars([112, 90])))


if __name__ == "__main__":
    unittest.main()
