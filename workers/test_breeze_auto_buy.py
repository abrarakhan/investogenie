import unittest
from decimal import Decimal

from breeze_auto_buy import available_funds, round_limit


class FakeBreeze:
    def __init__(self, payload):
        self.payload = payload

    def get_funds(self):
        return self.payload


class BreezeAutoBuySafetyTests(unittest.TestCase):
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
