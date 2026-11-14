import unittest
from datetime import date, timedelta

from pipelines.strategy_math.strong_swing import MODEL_VERSION
from pipelines.strong_swing_parity import (
    BENCHMARK_RECORDED, BENCHMARK_RESELECTED, Bar, average_true_range, bar_gates, benchmark_replay_plan,
    breakout_failed, breakout_level, confirmation_breakout, differences, expected_status,
    forward_gate_comparison, gate_differences, plan, round2, structural_breakout,
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


class BenchmarkVerificationStatus(unittest.TestCase):
    """The independent checker must derive UNVERIFIED exactly as the live engine does.

    The checker is deliberately a separate implementation, so a rule change in the engine does
    not reach it automatically. When the engines started reporting an unusable benchmark as
    UNVERIFIED, this checker still derived RISK_OFF (missing/stale) or WATCHLIST (too short),
    which would have flagged every valid v5 capture as a status mismatch.
    """

    @staticmethod
    def _gates(benchmark_ok=True, **failed):
        keys = [("structure", "technical"), ("follow_through", "technical"), ("entry_zone", "execution"),
                ("sma20_extension", "execution"), ("atr_risk", "execution"), ("market_regime", "execution"),
                ("freshness", "execution"), ("market_shock", "execution"), ("benchmark_data", "execution")]
        rows = []
        for key, category in keys:
            passed = not failed.get(key, False)
            if key == "benchmark_data":
                passed = benchmark_ok
            rows.append({"key": key, "category": category,
                         "blocking": key != "market_regime", "passed": passed})
        return rows

    def test_unusable_benchmark_is_unverified_not_risk_off(self):
        # Freshness fails because the benchmark is behind the market; that is the data gap
        # itself, so it must not also be charged as a market risk.
        gates = self._gates(benchmark_ok=False, freshness=True)
        self.assertEqual(expected_status(gates, False), "UNVERIFIED")

    def test_short_benchmark_is_unverified_not_watchlist(self):
        # Too short for the 50-SMA: every bar-derived gate still passes, so the old checker
        # fell through to EXECUTION_READY/WATCHLIST and hid the gap.
        self.assertEqual(expected_status(self._gates(benchmark_ok=False), False), "UNVERIFIED")

    def test_a_real_risk_breach_still_outranks_an_unusable_benchmark(self):
        gates = self._gates(benchmark_ok=False, atr_risk=True)
        self.assertEqual(expected_status(gates, False), "RISK_OFF")

    def test_a_genuine_shock_on_a_usable_benchmark_stays_risk_off(self):
        gates = self._gates(benchmark_ok=True, market_shock=True)
        self.assertEqual(expected_status(gates, False), "RISK_OFF")

    def test_captures_without_the_gate_keep_their_original_verdict(self):
        # Pre-v5 captures have no benchmark_data key and must still audit cleanly.
        legacy = [row for row in self._gates() if row["key"] != "benchmark_data"]
        self.assertEqual(expected_status(legacy, False), "EXECUTION_READY")
        legacy_stale = [dict(row, passed=False) if row["key"] == "freshness" else row for row in legacy]
        self.assertEqual(expected_status(legacy_stale, False), "RISK_OFF")

    def test_checker_agrees_with_the_live_engine_on_every_benchmark_condition(self):
        """Feed the engine's own recorded gates back through the checker."""
        from strategy_math.strong_swing import assess

        def rising(count, slope):
            return [{"date": (date(2025, 1, 1) + timedelta(days=i)).isoformat(),
                     "open": 100 + i * slope - 1, "high": 100 + i * slope + 0.5,
                     "low": 100 + i * slope - 1.5, "close": 100 + i * slope,
                     "volume": 3_000_000 if i >= count - 2 else 1_000_000} for i in range(count)]

        bars = rising(240, 0.5)
        level = max(bar["high"] for bar in bars[-22:-2])
        entry = level + 0.5
        for bar in bars[-2:]:
            close = entry + 0.2
            bar.update({"open": close - 0.4, "high": close + 0.2, "low": close - 0.6,
                        "close": close, "volume": 4_000_000})
        benchmark = rising(240, 0.2)
        shocked = [dict(row) for row in benchmark]
        shocked[-1].update({"close": shocked[-3]["close"] * 0.9, "high": shocked[-3]["close"] * 0.9,
                            "low": shocked[-3]["close"] * 0.9})

        cases = {"usable": benchmark, "missing": [], "stale": benchmark[:-8],
                 "too_short": benchmark[-30:], "shocked": shocked}
        for name, bench in cases.items():
            result = assess({
                "market": "IN", "verdict": "LONG_BREAKOUT", "isBreakout": True,
                "trigger": entry, "atr": 2, "trailingStop": None, "currentPrice": entry + 0.2,
                "stopAtrMult": 1.5, "bars": bars, "benchmarkBars": bench,
                "results": {"verified": True, "sessionsToNext": None, "nextDate": None,
                            "detail": "No results due."},
            })
            derived = expected_status(result["gates"], False)
            self.assertEqual(derived, result["status"],
                             f"{name}: checker derived {derived}, engine returned {result['status']}")


class BenchmarkReplay(unittest.TestCase):
    """The audit must judge a capture against the benchmark that produced it."""

    def test_recorded_benchmark_is_replayed_exactly(self):
        chosen, cutoff, source = benchmark_replay_plan(
            "11111111-1111-1111-1111-111111111111", date(2026, 11, 13), date(2026, 11, 13))
        self.assertEqual(chosen, "11111111-1111-1111-1111-111111111111")
        self.assertEqual(cutoff, date(2026, 11, 13))
        self.assertEqual(source, BENCHMARK_RECORDED)

    def test_recorded_benchmark_keeps_its_own_cutoff(self):
        """A benchmark one session behind the stocks is replayed at its own last bar."""
        _chosen, cutoff, _source = benchmark_replay_plan(
            "11111111-1111-1111-1111-111111111111", date(2026, 11, 12), date(2026, 11, 13))
        self.assertEqual(cutoff, date(2026, 11, 12))

    def test_older_capture_is_anchored_to_its_own_latest_bar(self):
        """Not to today: re-selecting by the audit date can pick a series the capture never saw."""
        chosen, cutoff, source = benchmark_replay_plan(None, None, date(2026, 3, 2))
        self.assertIsNone(chosen)
        self.assertEqual(cutoff, date(2026, 3, 2))
        self.assertEqual(source, BENCHMARK_RESELECTED)

    def test_recorded_identity_without_a_bar_date_is_not_trusted(self):
        chosen, cutoff, source = benchmark_replay_plan(
            "11111111-1111-1111-1111-111111111111", None, date(2026, 3, 2))
        self.assertIsNone(chosen)
        self.assertEqual((cutoff, source), (date(2026, 3, 2), BENCHMARK_RESELECTED))


class ForwardGateComparison(unittest.TestCase):
    """Gate replay is a parity claim only against captures of the same model."""

    @staticmethod
    def _gates(**passed):
        return [{"key": key, "passed": value} for key, value in passed.items()]

    def test_matching_model_reports_a_stable_gate_difference(self):
        result = forward_gate_comparison(
            self._gates(structure=True, trend=True), self._gates(structure=True, trend=False),
            MODEL_VERSION, True)
        self.assertEqual(result, (["trend"], False))

    def test_matching_model_excludes_live_quote_gates(self):
        result = forward_gate_comparison(
            self._gates(live_quote=True), self._gates(live_quote=False), MODEL_VERSION, True)
        self.assertEqual(result, ([], True))

    def test_pre_v5_capture_is_not_a_gate_mismatch(self):
        """The added benchmark_data gate is absent from every older capture by construction."""
        result = forward_gate_comparison(
            self._gates(structure=True), self._gates(structure=True, benchmark_data=False),
            "strong-swing-v4-breakout-bar", True)
        self.assertIsNone(result)

    def test_missing_model_version_is_not_claimed_as_parity(self):
        self.assertIsNone(forward_gate_comparison(self._gates(structure=True),
                                                  self._gates(structure=True), None, True))

    def test_same_model_with_the_new_gate_still_compares(self):
        result = forward_gate_comparison(
            self._gates(structure=True, benchmark_data=False),
            self._gates(structure=True, benchmark_data=False), MODEL_VERSION, True)
        self.assertEqual(result, ([], False))


if __name__ == "__main__":
    unittest.main()
