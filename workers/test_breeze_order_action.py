import unittest
from decimal import Decimal as D

from breeze_order_action import filled_quantity, problems

# The field names Breeze uses for an order in the account's order list.
ORDER = {
    "order_id": "20261113N100000042", "exchange_code": "NSE", "stock_code": "RELIND", "action": "Buy",
    "order_type": "Limit", "status": "Ordered", "quantity": "10", "pending_quantity": "10",
    "cancelled_quantity": "0", "price": "1450.00", "validity": "Day", "expiry_date": "", "right": "Others",
}


class OrderActionTests(unittest.TestCase):
    def test_an_open_cash_order_can_be_cancelled(self):
        self.assertEqual(problems(ORDER, "CANCEL", None, None), [])

    def test_a_finished_order_is_refused(self):
        for status in ("Executed", "Cancelled", "Rejected", "Expired", ""):
            self.assertTrue(problems({**ORDER, "status": status}, "CANCEL", None, None), status)

    def test_anything_but_an_nse_cash_order_is_refused(self):
        self.assertTrue(problems({**ORDER, "exchange_code": "NFO"}, "CANCEL", None, None))
        self.assertTrue(problems({**ORDER, "expiry_date": "27-Nov-2026"}, "CANCEL", None, None))
        self.assertTrue(problems({**ORDER, "right": "Call"}, "CANCEL", None, None))

    def test_a_valid_price_or_quantity_change_is_allowed(self):
        self.assertEqual(problems(ORDER, "MODIFY", D("1448.50"), D("10")), [])
        self.assertEqual(problems(ORDER, "MODIFY", D("1450.00"), D("8")), [])

    def test_a_change_needs_a_tick_sized_price_and_whole_shares(self):
        self.assertTrue(problems(ORDER, "MODIFY", D("1448.52"), D("10")))
        self.assertTrue(problems(ORDER, "MODIFY", D("0"), D("10")))
        self.assertTrue(problems(ORDER, "MODIFY", None, D("10")))
        self.assertTrue(problems(ORDER, "MODIFY", D("1448.50"), D("2.5")))
        self.assertTrue(problems(ORDER, "MODIFY", D("1448.50"), D("0")))

    def test_a_change_that_changes_nothing_is_refused(self):
        self.assertTrue(problems(ORDER, "MODIFY", D("1450"), D("10")))

    def test_quantity_cannot_drop_to_what_has_already_filled(self):
        partial = {**ORDER, "status": "Partially Executed", "pending_quantity": "6"}
        self.assertEqual(filled_quantity(partial), D("4"))
        self.assertTrue(problems(partial, "MODIFY", D("1450"), D("4")))
        self.assertEqual(problems(partial, "MODIFY", D("1450"), D("5")), [])

    def test_only_limit_orders_can_be_changed(self):
        self.assertTrue(problems({**ORDER, "order_type": "Market"}, "MODIFY", D("1448.50"), D("10")))
        self.assertEqual(problems({**ORDER, "order_type": "Market"}, "CANCEL", None, None), [])


if __name__ == "__main__":
    unittest.main()
