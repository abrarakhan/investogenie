from datetime import date
import unittest

from sec_edgar_fundamentals import build_company_statements


def fact(val, end, form, filed, *, start=None, fp="Q1", fy=2026):
    row = {"val": val, "end": end, "form": form, "filed": filed, "fp": fp, "fy": fy}
    if start:
        row["start"] = start
    return row


def concept(unit, rows):
    return {"units": {unit: rows}}


class SecEdgarFundamentalsTests(unittest.TestCase):
    def fixture(self):
        return {"facts": {"us-gaap": {
            "RevenueFromContractWithCustomerExcludingAssessedTax": concept("USD", [
                fact(90_000_000, "2026-03-31", "10-Q", "2026-04-20", start="2026-01-01"),
                # Amendment must replace the original quarter.
                fact(100_000_000, "2026-03-31", "10-Q/A", "2026-04-25", start="2026-01-01"),
                # Six-month YTD value must not masquerade as a standalone quarter.
                fact(220_000_000, "2026-06-30", "10-Q", "2026-07-20", start="2026-01-01", fp="Q2"),
                fact(400_000_000, "2025-12-31", "10-K", "2026-02-20", start="2025-01-01", fp="FY", fy=2025),
            ]),
            "NetIncomeLoss": concept("USD", [
                fact(10_000_000, "2026-03-31", "10-Q", "2026-04-20", start="2026-01-01"),
                fact(40_000_000, "2025-12-31", "10-K", "2026-02-20", start="2025-01-01", fp="FY", fy=2025),
            ]),
            "OperatingIncomeLoss": concept("USD", [
                fact(15_000_000, "2026-03-31", "10-Q", "2026-04-20", start="2026-01-01"),
                fact(60_000_000, "2025-12-31", "10-K", "2026-02-20", start="2025-01-01", fp="FY", fy=2025),
            ]),
            "Assets": concept("USD", [
                fact(500_000_000, "2026-03-31", "10-Q", "2026-04-20"),
                fact(480_000_000, "2025-12-31", "10-K", "2026-02-20", fp="FY", fy=2025),
            ]),
            "LiabilitiesCurrent": concept("USD", [
                fact(100_000_000, "2026-03-31", "10-Q", "2026-04-20"),
                fact(90_000_000, "2025-12-31", "10-K", "2026-02-20", fp="FY", fy=2025),
            ]),
            "StockholdersEquity": concept("USD", [
                fact(300_000_000, "2026-03-31", "10-Q", "2026-04-20"),
            ]),
            "NetCashProvidedByUsedInOperatingActivities": concept("USD", [
                fact(20_000_000, "2026-03-31", "10-Q", "2026-04-20", start="2026-01-01"),
            ]),
            "PaymentsToAcquirePropertyPlantAndEquipment": concept("USD", [
                fact(5_000_000, "2026-03-31", "10-Q", "2026-04-20", start="2026-01-01"),
            ]),
        }}}

    def test_builds_quarterly_and_annual_reports_in_usd_millions(self):
        reports, balances, cash = build_company_statements(self.fixture())
        quarter = next(row for row in reports if row["report_type"] == "QUARTERLY")
        annual = next(row for row in reports if row["report_type"] == "ANNUAL")
        self.assertEqual(quarter["period_end_date"], date(2026, 3, 31))
        self.assertEqual(quarter["revenue"], 100.0)
        self.assertEqual(quarter["net_profit"], 10.0)
        self.assertEqual(quarter["capital_employed"], 400.0)
        self.assertEqual(quarter["roce"], 3.75)
        self.assertEqual(annual["revenue"], 400.0)
        self.assertFalse(any(row["period_end_date"] == date(2026, 6, 30) for row in reports))
        self.assertEqual(next(row for row in balances if row["report_type"] == "QUARTERLY")["total_assets"], 500.0)
        self.assertEqual(cash[0]["capital_expenditure"], -5.0)
        self.assertEqual(cash[0]["free_cash_flow"], 15.0)

    def test_missing_optional_concepts_stay_null_instead_of_blocking(self):
        reports, balances, cash = build_company_statements(self.fixture())
        quarter = next(row for row in reports if row["report_type"] == "QUARTERLY")
        self.assertIsNone(quarter["ebitda"])
        self.assertIsNone(quarter["eps"])
        self.assertTrue(balances)
        self.assertTrue(cash)

    def test_aliases_are_selected_per_period_and_preferred_within_period(self):
        fixture = self.fixture()
        fixture["facts"]["us-gaap"]["Revenues"] = concept("USD", [
            fact(70_000_000, "2024-03-31", "10-Q", "2024-04-20", start="2024-01-01", fy=2024),
            # The lower-priority alias must not replace the preferred concept
            # for a period where both exist, even if it was filed later.
            fact(999_000_000, "2026-03-31", "10-Q", "2026-04-30", start="2026-01-01"),
        ])
        reports, _, _ = build_company_statements(fixture)
        by_date = {row["period_end_date"]: row for row in reports if row["report_type"] == "QUARTERLY"}
        self.assertEqual(by_date[date(2024, 3, 31)]["revenue"], 70.0)
        self.assertEqual(by_date[date(2026, 3, 31)]["revenue"], 100.0)

    def test_leap_day_period_computes_yoy_without_invalid_date(self):
        fixture = self.fixture()
        fixture["facts"]["us-gaap"]["RevenueFromContractWithCustomerExcludingAssessedTax"] = concept("USD", [
            fact(80_000_000, "2023-02-28", "10-Q", "2023-04-20", start="2022-12-01", fy=2023),
            fact(100_000_000, "2024-02-29", "10-Q", "2024-04-20", start="2023-12-01", fy=2024),
        ])
        reports, _, _ = build_company_statements(fixture)
        latest = next(row for row in reports if row["period_end_date"] == date(2024, 2, 29))
        self.assertEqual(latest["sales_variance_yoy"], 25.0)


if __name__ == "__main__":
    unittest.main()
