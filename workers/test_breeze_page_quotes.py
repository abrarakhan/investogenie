import unittest

from breeze_page_quotes import execution_fields


class BreezePageQuoteTests(unittest.TestCase):
    def test_extracts_rest_execution_depth_and_circuit_bands(self):
        self.assertEqual(execution_fields({
            "best_bid_price": "687.60",
            "best_offer_price": "687.65",
            "best_bid_quantity": "1,200",
            "best_offer_quantity": 850,
            "lower_circuit": "554.00",
            "upper_circuit": 831,
        }), {
            "best_bid": 687.6,
            "best_ask": 687.65,
            "bid_quantity": 1200,
            "ask_quantity": 850,
            "lower_circuit": 554.0,
            "upper_circuit": 831.0,
        })

    def test_missing_execution_fields_fail_closed(self):
        self.assertEqual(execution_fields({}), {
            "best_bid": None,
            "best_ask": None,
            "bid_quantity": None,
            "ask_quantity": None,
            "lower_circuit": None,
            "upper_circuit": None,
        })


if __name__ == "__main__":
    unittest.main()
