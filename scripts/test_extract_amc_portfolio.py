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

    def test_franklin_title_inside_abbreviated_sheet(self):
        import pandas as pd

        frame = pd.DataFrame([
            ["Franklin India Focused Equity Fund", ""],
            ["Portfolio Statement as on August 31, 2026", ""],
        ])
        score = MODULE.sheet_content_match_score(
            "Franklin India Focused Equity Fund - Growth",
            frame,
        )
        self.assertGreaterEqual(score, 0.85)

    def test_franklin_cash_line_in_first_column_completes_full_snapshot(self):
        import pandas as pd

        frame = pd.DataFrame([
            ["ISIN Number", "Name of the Instrument", "% to Net Assets"],
            ["INE090A01021", "ICICI Bank Ltd", "96.1"],
            ["", "Total", "96.1"],
            ["Call, Cash & Other Assets", "", "3.9"],
            ["", "Net Assets", "100"],
        ])
        rows = MODULE.parse_frame(frame, full=True)
        self.assertEqual([row["stock_name"] for row in rows], [
            "ICICI Bank Ltd",
            "Call, Cash & Other Assets",
        ])
        self.assertAlmostEqual(sum(row["weight_percentage"] for row in rows), 100.0)


if __name__ == "__main__":
    unittest.main()
