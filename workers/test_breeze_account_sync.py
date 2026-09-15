import unittest

from breeze_account_sync import as_number, external_key, response_rows


class BreezeAccountSyncTest(unittest.TestCase):
    def test_response_rows_accepts_list_and_object(self):
        self.assertEqual(response_rows({"Success": [{"stock_code": "TATMOT"}], "Error": None})[0]["stock_code"], "TATMOT")
        self.assertEqual(response_rows({"Success": {"available_balance": "1000"}, "Error": None})[0]["available_balance"], "1000")

    def test_response_error_is_not_treated_as_empty_success(self):
        with self.assertRaisesRegex(RuntimeError, "expired"):
            response_rows({"Success": None, "Error": "Session expired"})

    def test_external_keys_keep_distinct_orders(self):
        first = external_key("ORDER", {"order_id": "101"}, 0)
        second = external_key("ORDER", {"order_id": "102"}, 1)
        self.assertNotEqual(first, second)

    def test_number_parser_handles_broker_format(self):
        self.assertEqual(str(as_number("1,180.50")), "1180.50")


if __name__ == "__main__":
    unittest.main()
