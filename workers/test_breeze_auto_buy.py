import re
import unittest
from decimal import Decimal
from pathlib import Path

from breeze_auto_buy import STRONG_SWING_MODEL_VERSION, available_funds, candidates, round_limit


class FakeBreeze:
    def __init__(self, payload):
        self.payload = payload

    def get_funds(self):
        return self.payload


class RecordingCursor:
    def __init__(self, log):
        self.log = log

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        self.log.append((sql, params))

    def fetchall(self):
        return []


class RecordingConnection:
    def __init__(self):
        self.log = []

    def cursor(self):
        return RecordingCursor(self.log)


class BreezeAutoBuySafetyTests(unittest.TestCase):
    def test_strong_swing_rows_must_carry_the_current_calculation_version(self):
        conn = RecordingConnection()
        candidates(conn, "user", strong=True, adaptive=False)
        sql, params = conn.log[0]
        self.assertIn("s.metrics->>'modelVersion' = %s", sql)
        self.assertIn("s.projected_stop < s.confirmation_entry", sql)
        self.assertEqual(params, (STRONG_SWING_MODEL_VERSION,))

    def test_calculation_version_matches_the_server_engine(self):
        source = (Path(__file__).resolve().parents[1] / "lib/analytics/strongSwing.ts").read_text()
        found = re.search(r'STRONG_SWING_MODEL_VERSION = "([^"]+)"', source)
        self.assertIsNotNone(found)
        self.assertEqual(found.group(1), STRONG_SWING_MODEL_VERSION)

    def test_limit_price_rounds_up_to_nse_tick(self):
        self.assertEqual(round_limit(Decimal("101.011")), Decimal("101.05"))

    def test_spendable_cash_does_not_use_larger_bank_balance(self):
        payload = {"Success": [{"cash_limit": "5000", "total_bank_balance": "100000"}], "Error": None}
        self.assertEqual(available_funds(FakeBreeze(payload)), Decimal("5000"))

    def test_missing_spendable_cash_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError, "spendable cash"):
            available_funds(FakeBreeze({"Success": [{"total_bank_balance": "100000"}], "Error": None}))


if __name__ == "__main__":
    unittest.main()
