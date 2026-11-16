import unittest
from datetime import date

from shareholding_sync import parse_filing


class ShareholdingSyncTests(unittest.TestCase):
    def test_parses_explicit_nse_filing_values(self):
        parsed = parse_filing({
            "symbol": "ABC", "date": "31-MAR-2026", "submissionDate": "2026-04-15T10:30:00+05:30",
            "promoterAndPromoterGroup": "52.75", "public": "47.25", "xbrl": "https://example/x.xml",
        })
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed["symbol"], "ABC")
        self.assertEqual(parsed["period"], date(2026, 3, 31))
        self.assertEqual(parsed["promoter"], 52.75)

    def test_missing_promoter_percentage_fails_closed(self):
        self.assertIsNone(parse_filing({"symbol": "ABC", "date": "31-MAR-2026"}))

    def test_parses_current_nse_master_field_names(self):
        parsed = parse_filing({
            "symbol": "ABC", "date": "04-NOV-2026", "submissionDate": "14-NOV-2026",
            "pr_and_prgrp": "47.76", "public_val": "52.24",
        })
        self.assertEqual(parsed["promoter"], 47.76)
        self.assertEqual(parsed["public"], 52.24)


if __name__ == "__main__":
    unittest.main()
