import unittest

from breeze_order_preview import preview_costs

# The shape of Breeze's preview answer for one share at 907.05.
SAMPLE = {
    "brokerage": 6.8029, "exchange_turnover_charges": 0.0254, "stamp_duty": 0.1361, "stt": 0.9071,
    "sebi_charges": 0.0009, "gst": 1.2293, "total_turnover_and_sebi_charges": 0.0263,
    "total_other_charges": 2.2987, "total_brokerage": 9.1016,
}


class OrderPreviewTests(unittest.TestCase):
    def test_uses_the_brokers_total_and_itemises_the_parts(self):
        result = preview_costs(SAMPLE, 907.05, 1)
        self.assertEqual(result["orderValue"], 907.05)
        self.assertEqual(result["totalCharges"], 9.1)
        self.assertEqual(result["chargesPct"], 1.003)
        self.assertEqual([line["key"] for line in result["charges"]],
                         ["brokerage", "stt", "stamp_duty", "exchange_turnover_charges", "sebi_charges", "gst"])
        self.assertEqual(result["charges"][0], {"key": "brokerage", "label": "Brokerage", "amount": 6.8})

    def test_sums_the_parts_when_the_broker_gives_no_total(self):
        result = preview_costs({"brokerage": "20", "stt": "10.5", "gst": None}, 1000, 10)
        self.assertEqual(result["totalCharges"], 30.5)
        self.assertEqual(result["chargesPct"], 0.305)
        self.assertEqual(len(result["charges"]), 2)

    def test_refuses_an_answer_with_no_charges(self):
        with self.assertRaises(RuntimeError):
            preview_costs({"message": "ok"}, 100, 1)


if __name__ == "__main__":
    unittest.main()
