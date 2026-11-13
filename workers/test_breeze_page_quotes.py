import unittest

import datetime as dt

from breeze_market_daemon import IST
from breeze_page_quotes import execution_fields, materially_changed, same_session


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

    def test_material_change_ignores_equivalent_numeric_types(self):
        previous = ("100.50", "1.2", "100.4", "100.6", "90", "110")
        current = (100.5, 1.2, 100.4, 100.6, 90.0, 110.0)
        self.assertFalse(materially_changed(previous, current))

    def test_material_change_detects_price_depth_or_circuit_updates(self):
        previous = (100, 1, 99, 101, 90, 110)
        self.assertTrue(materially_changed(previous, (101, 1, 99, 101, 90, 110)))
        self.assertTrue(materially_changed(previous, (100, 1, 99, 102, 90, 110)))
        self.assertTrue(materially_changed(previous, (100, 1, 99, 101, 90, 111)))

    def test_material_change_detects_missing_or_new_values(self):
        self.assertTrue(materially_changed(None, (100, None)))
        self.assertTrue(materially_changed((100, None), (100, 1)))
        self.assertFalse(materially_changed((100, None), (100, None)))

    def test_same_session_reads_the_stored_date_column(self):
        tick = dt.datetime(2026, 11, 13, 10, 7, 33, tzinfo=IST)
        self.assertTrue(same_session(dt.date(2026, 11, 13), tick))
        self.assertFalse(same_session(dt.date(2026, 11, 12), tick))
        self.assertTrue(same_session(dt.datetime(2026, 11, 13, 9, 15, tzinfo=IST), tick))
        self.assertFalse(same_session(None, tick))


if __name__ == "__main__":
    unittest.main()
