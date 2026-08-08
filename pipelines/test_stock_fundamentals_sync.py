import unittest

import pandas as pd

from stock_fundamentals_sync import (
    build_balance_sheets,
    build_cash_flows,
    build_reports,
)


class StatementNormalizationTests(unittest.TestCase):
    def setUp(self):
        self.period = pd.Timestamp("2025-03-31")

    def test_balance_sheet_maps_provider_lines_and_normalizes_units(self):
        frame = pd.DataFrame(
            {
                self.period: {
                    "Total Assets": 1_000_000,
                    "Current Assets": 400_000,
                    "Cash And Cash Equivalents": 100_000,
                    "Accounts Receivable": 80_000,
                    "Current Liabilities": 200_000,
                    "Total Debt": 150_000,
                    "Stockholders Equity": 500_000,
                }
            }
        )
        rows = build_balance_sheets(frame, "ANNUAL", monetary_divisor=1_000)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["total_assets"], 1000)
        self.assertEqual(rows[0]["cash_and_equivalents"], 100)
        self.assertEqual(rows[0]["receivables"], 80)
        self.assertEqual(rows[0]["shareholders_equity"], 500)

    def test_cash_flow_preserves_provider_signs(self):
        frame = pd.DataFrame(
            {
                self.period: {
                    "Operating Cash Flow": 300_000,
                    "Capital Expenditure": -90_000,
                    "Free Cash Flow": 210_000,
                    "Cash Dividends Paid": -50_000,
                    "Repurchase Of Capital Stock": -25_000,
                }
            }
        )
        rows = build_cash_flows(frame, "ANNUAL", monetary_divisor=1_000)
        self.assertEqual(rows[0]["operating_cash_flow"], 300)
        self.assertEqual(rows[0]["capital_expenditure"], -90)
        self.assertEqual(rows[0]["free_cash_flow"], 210)
        self.assertEqual(rows[0]["dividends_paid"], -50)

    def test_income_statement_keeps_quality_inputs(self):
        income = pd.DataFrame(
            {
                self.period: {
                    "Total Revenue": 2_000_000,
                    "Net Income": 240_000,
                    "EBIT": 400_000,
                    "EBITDA": 500_000,
                    "Gross Profit": 900_000,
                    "Interest Expense": 40_000,
                    "Tax Provision": 60_000,
                    "Diluted Average Shares": 10_000,
                }
            }
        )
        balance = pd.DataFrame(
            {self.period: {"Total Assets": 4_000_000, "Current Liabilities": 1_000_000}}
        )
        rows = build_reports(income, balance, "ANNUAL", monetary_divisor=1_000)
        self.assertEqual(rows[0]["gross_profit"], 900)
        self.assertEqual(rows[0]["ebitda"], 500)
        self.assertEqual(rows[0]["interest_expense"], 40)
        self.assertEqual(rows[0]["capital_employed"], 3000)
        self.assertAlmostEqual(rows[0]["roce"], 13.3333, places=4)


if __name__ == "__main__":
    unittest.main()
