import unittest
from datetime import datetime, timezone

from strategy_math.trade_recovery import (
    assess_trade_recovery,
    evaluate_fresh_setup,
    is_quote_verified_for_breach,
    is_window_expired,
)


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

    def test_verified_quote_stamps_first_breach_once_with_stop_level(self):
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
        self.assertEqual(res["recordBreach"]["stopLevel"], 190.0)
        self.assertEqual(res["recordBreach"]["source"], "BREEZE_LIVE")

    def test_live_quote_age_and_session_verification_for_in_and_us(self):
        now = datetime(2026, 11, 27, 15, 0, 0, tzinfo=timezone.utc)
        # US LIVE quote > 5 min old must fail verification
        self.assertFalse(is_quote_verified_for_breach(
            market="US", mode="LIVE", price=100.0, quote_as_of="2026-11-27",
            quote_source="YAHOO_LIVE", quote_updated_at="2026-11-27T14:50:00Z",
            expected_session_date="2026-11-27", now_utc=now,
        ))
        # US LIVE fresh quote on expected session passes
        self.assertTrue(is_quote_verified_for_breach(
            market="US", mode="LIVE", price=100.0, quote_as_of="2026-11-27",
            quote_source="YAHOO_LIVE", quote_updated_at="2026-11-27T14:58:00Z",
            expected_session_date="2026-11-27", now_utc=now,
        ))
        # EOD quote from prior session fails against exchange-calendar expected session
        self.assertFalse(is_quote_verified_for_breach(
            market="IN", mode="EOD", price=185.0, quote_as_of="2026-11-26",
            quote_source="NSE_EOD", quote_updated_at="2026-11-26T12:00:00Z",
            expected_session_date="2026-11-27", now_utc=now,
        ))

    def test_session_expiry_exact_boundary_matches_ledger_rule(self):
        # At sessions_held == expected_holding_days, plan is NOT yet expired
        self.assertFalse(is_window_expired(sessions_held=10, expected_holding_days=10, price=190.0, buy_price=200.0))
        # One session past expected_holding_days and below entry -> expired
        self.assertTrue(is_window_expired(sessions_held=11, expected_holding_days=10, price=190.0, buy_price=200.0))
        # Past expected_holding_days but above entry -> not expired below entry
        self.assertFalse(is_window_expired(sessions_held=11, expected_holding_days=10, price=205.0, buy_price=200.0))

    def test_fresh_setup_links_qualified_engine_when_recent_and_within_entry_band(self):
        fs = evaluate_fresh_setup({
            "market": "IN",
            "mode": "LIVE",
            "recoveryStatus": "REBOUND_DETECTED",
            "evaluatedAt": "2026-11-27T09:05:00Z",
            "expectedSessionDate": "2026-11-27",
            "quoteVerified": True,
            "currentPrice": 194.0,
            "trendContinuation": {
                "status": "TREND_CONTINUATION_READY",
                "setupVariant": "EP_REBOUND",
                "score": 88,
                "entry": 192.0,
                "stop": 178.5,
                "target": 219.0,
                "signalDate": "2026-11-27",
                "signalAt": "2026-11-27T09:00:00Z",
            },
        })
        self.assertEqual(fs["freshSetupStatus"], "QUALIFIED")
        self.assertEqual(fs["freshSetupEngine"], "TREND_CONTINUATION")
        self.assertEqual(fs["freshSetupStop"], 178.5)
        self.assertEqual(fs["freshSetupFirstQualifiedAt"], "2026-11-27T09:05:00Z")

    def test_same_day_hours_old_or_extended_signal_downgrades_to_recent_signal(self):
        # 45 minutes old in LIVE mode -> RECENT_SIGNAL (suppresses fresh-setup alert)
        stale_intraday = evaluate_fresh_setup({
            "market": "IN",
            "mode": "LIVE",
            "recoveryStatus": "STOP_RECLAIMED",
            "evaluatedAt": "2026-11-27T09:45:00Z",
            "expectedSessionDate": "2026-11-27",
            "quoteVerified": True,
            "currentPrice": 193.0,
            "strongSwing": {
                "status": "EXECUTION_READY",
                "strengthScore": 86,
                "entry": 192.0,
                "stop": 180.0,
                "target": 215.0,
                "gates": [{"key": "trend", "passed": True, "blocking": True}],
                "signalDate": "2026-11-27",
                "signalAt": "2026-11-27T09:00:00Z",
            },
        })
        self.assertEqual(stale_intraday["freshSetupStatus"], "RECENT_SIGNAL")
        self.assertIn("Recent strategy signal", stale_intraday["freshSetupLabel"])
        self.assertIn("45m old", stale_intraday["freshSetupBlocker"])

        # Recent but 8% above entry (exceeds 3% band) -> RECENT_SIGNAL
        extended = evaluate_fresh_setup({
            "market": "IN",
            "mode": "LIVE",
            "recoveryStatus": "STOP_RECLAIMED",
            "evaluatedAt": "2026-11-27T09:05:00Z",
            "expectedSessionDate": "2026-11-27",
            "quoteVerified": True,
            "currentPrice": 207.5,
            "trendContinuation": {
                "status": "TREND_CONTINUATION_READY",
                "setupVariant": "EP_REBOUND",
                "score": 88,
                "entry": 192.0,
                "stop": 178.5,
                "target": 219.0,
                "signalDate": "2026-11-27",
                "signalAt": "2026-11-27T09:02:00Z",
            },
        })
        self.assertEqual(extended["freshSetupStatus"], "RECENT_SIGNAL")
        self.assertIn(">3% above entry", extended["freshSetupBlocker"])

    def test_stale_prior_session_ready_signal_cannot_qualify(self):
        fs = evaluate_fresh_setup({
            "market": "IN",
            "mode": "EOD",
            "recoveryStatus": "STOP_RECLAIMED",
            "evaluatedAt": "2026-11-27T10:30:00Z",
            "expectedSessionDate": "2026-11-27",
            "quoteVerified": True,
            "currentPrice": 193.0,
            "strongSwing": {
                "status": "EXECUTION_READY",
                "strengthScore": 86,
                "entry": 192.0,
                "stop": 180.0,
                "target": 215.0,
                "signalDate": "2026-11-24",
            },
        })
        self.assertEqual(fs["freshSetupStatus"], "BLOCKED")
        self.assertIsNone(fs["freshSetupEngine"])
        self.assertIn("signal stale (2026-11-24)", fs["freshSetupBlocker"])

    def test_current_quote_below_setup_stop_cannot_qualify(self):
        fs = evaluate_fresh_setup({
            "market": "IN",
            "mode": "LIVE",
            "recoveryStatus": "REBOUND_DETECTED",
            "evaluatedAt": "2026-11-27T09:05:00Z",
            "expectedSessionDate": "2026-11-27",
            "quoteVerified": True,
            "currentPrice": 176.0,
            "trendContinuation": {
                "status": "TREND_CONTINUATION_READY",
                "setupVariant": "EP_REBOUND",
                "score": 88,
                "entry": 192.0,
                "stop": 178.5,
                "target": 219.0,
                "signalDate": "2026-11-27",
                "signalAt": "2026-11-27T09:02:00Z",
            },
        })
        self.assertEqual(fs["freshSetupStatus"], "BLOCKED")
        self.assertIn("current price below setup stop", fs["freshSetupBlocker"])

    def test_fresh_setup_reports_main_blocker_when_none_qualifies(self):
        fs = evaluate_fresh_setup({
            "market": "IN",
            "mode": "LIVE",
            "recoveryStatus": "REBOUND_DETECTED",
            "evaluatedAt": "2026-11-27T09:00:00Z",
            "expectedSessionDate": "2026-11-27",
            "quoteVerified": True,
            "currentPrice": 190.5,
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
