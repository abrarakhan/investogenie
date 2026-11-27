import unittest

from strategy_math.trade_recovery import assess_trade_recovery, evaluate_fresh_setup


class TradeRecoveryTests(unittest.TestCase):
    def test_dhampursug_rebound_detected_below_frozen_stop(self):
        res = assess_trade_recovery({
            "market": "IN",
            "currency": "INR",
            "buyPrice": 206.86,
            "frozenStop": 191.59,
            "price": 190.79,
            "twoSessionClose": 160.09,
            "quoteVerified": True,
            "quoteSource": "BREEZE_LIVE",
            "quoteAt": "2026-11-27T07:16:00Z",
            "evaluatedAt": "2026-11-27T07:16:00Z",
            "firstStopBreachedAt": "2026-10-20T05:00:00Z",
            "sectorThrustGroup": "Sugar & Ethanol (ACTIVE)",
        })
        self.assertIsNone(res["recordBreach"])  # existing breach preserved
        self.assertEqual(res["recoveryStatus"], "REBOUND_DETECTED")
        self.assertEqual(
            res["headline"],
            "Recovery detected · Up 19.2% over two sessions · Stop not reclaimed",
        )
        self.assertEqual(res["sectorThrustGroup"], "Sugar & Ethanol (ACTIVE)")

    def test_stop_reclaimed_preserves_first_breach_history(self):
        res = assess_trade_recovery({
            "market": "IN",
            "currency": "INR",
            "buyPrice": 206.86,
            "frozenStop": 191.59,
            "price": 193.20,
            "twoSessionClose": 160.09,
            "quoteVerified": True,
            "quoteSource": "BREEZE_LIVE",
            "quoteAt": "2026-11-27T08:00:00Z",
            "evaluatedAt": "2026-11-27T08:00:00Z",
            "firstStopBreachedAt": "2026-10-20T05:00:00Z",
        })
        self.assertIsNone(res["recordBreach"])
        self.assertEqual(res["recoveryStatus"], "STOP_RECLAIMED")
        self.assertIn("Stop reclaimed · Back above ₹191.59 frozen stop", res["headline"])

    def test_unverified_quote_never_stamps_first_breach(self):
        res = assess_trade_recovery({
            "market": "IN",
            "currency": "INR",
            "buyPrice": 200.0,
            "frozenStop": 190.0,
            "price": 185.0,
            "twoSessionClose": 195.0,
            "quoteVerified": False,
            "quoteSource": "STALE",
            "evaluatedAt": "2026-11-27T08:00:00Z",
            "firstStopBreachedAt": None,
        })
        self.assertIsNone(res["recordBreach"])
        self.assertEqual(res["recoveryStatus"], "NONE")

    def test_verified_quote_stamps_first_breach_once(self):
        res = assess_trade_recovery({
            "market": "IN",
            "currency": "INR",
            "buyPrice": 200.0,
            "frozenStop": 190.0,
            "price": 188.50,
            "twoSessionClose": 195.0,
            "quoteVerified": True,
            "quoteSource": "BREEZE_LIVE",
            "quoteAt": "2026-11-27T04:15:00Z",
            "evaluatedAt": "2026-11-27T04:15:00Z",
            "firstStopBreachedAt": None,
        })
        self.assertIsNotNone(res["recordBreach"])
        self.assertEqual(res["recordBreach"]["price"], 188.5)
        self.assertEqual(res["recordBreach"]["source"], "BREEZE_LIVE")

    def test_fresh_setup_links_qualified_engine_with_own_levels(self):
        fs = evaluate_fresh_setup({
            "market": "IN",
            "recoveryStatus": "REBOUND_DETECTED",
            "evaluatedAt": "2026-11-27T09:00:00Z",
            "trendContinuation": {
                "status": "TREND_CONTINUATION_READY",
                "setupVariant": "EP_REBOUND",
                "score": 88,
                "entry": 192.0,
                "stop": 178.5,
                "target": 219.0,
            },
        })
        self.assertEqual(fs["freshSetupStatus"], "QUALIFIED")
        self.assertEqual(fs["freshSetupEngine"], "TREND_CONTINUATION")
        self.assertEqual(fs["freshSetupStop"], 178.5)
        self.assertEqual(fs["freshSetupFirstQualifiedAt"], "2026-11-27T09:00:00Z")

    def test_fresh_setup_reports_main_blocker_when_none_qualifies(self):
        fs = evaluate_fresh_setup({
            "market": "IN",
            "recoveryStatus": "REBOUND_DETECTED",
            "evaluatedAt": "2026-11-27T09:00:00Z",
            "strongSwing": {
                "status": "WATCHLIST",
                "gates": [
                    {"key": "trend", "passed": False, "blocking": True},
                    {"key": "follow_through", "passed": False, "blocking": True},
                ],
            },
            "trendContinuation": {"status": "EXTENDED_RISK"},
        })
        self.assertEqual(fs["freshSetupStatus"], "BLOCKED")
        self.assertIn("Strong Swing (WATCHLIST): trend, follow through", fs["freshSetupBlocker"])
        self.assertIn("Trend Continuation: EXTENDED RISK", fs["freshSetupBlocker"])


if __name__ == "__main__":
    unittest.main()
