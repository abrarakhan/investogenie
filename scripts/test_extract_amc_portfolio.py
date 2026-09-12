import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("extract-amc-portfolio.py")
SPEC = importlib.util.spec_from_file_location("extract_amc_portfolio", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class SheetMatchingTests(unittest.TestCase):
    def test_small_cap_abbreviation(self):
        self.assertEqual(MODULE.sheet_match_score("Nippon India Small Cap Fund - Growth", "SC")[0], 1.0)
        self.assertLess(MODULE.sheet_match_score("Nippon India Multi Cap Fund - Growth", "SC")[0], 1.0)

    def test_business_cycle_abbreviation(self):
        self.assertEqual(MODULE.sheet_match_score("ICICI Prudential Business Cycle Fund Growth", "BCYCLE")[0], 1.0)

    def test_descriptive_sheet_name(self):
        score = MODULE.sheet_match_score("Quant Infrastructure Fund - Direct Growth", "quant_Infrastructure_Fund")[0]
        self.assertGreaterEqual(score, 0.8)


if __name__ == "__main__":
    unittest.main()
