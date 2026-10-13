import unittest
from datetime import date, datetime

from corporate_results_sync import usable_dates, yahoo_symbol


class ResultsDateTests(unittest.TestCase):
    def test_keeps_dates_inside_the_window_and_dedupes(self):
        today = date(2026, 10, 13)
        values = [datetime(2026, 10, 20, 9, 0), date(2026, 10, 20), date(2026, 7, 25), date(2020, 1, 1), "n/a"]
        self.assertEqual(usable_dates(values, today), [date(2026, 7, 25), date(2026, 10, 20)])

    def test_symbols(self):
        self.assertEqual(yahoo_symbol("TCS", "NSE", "IN"), "TCS.NS")
        self.assertEqual(yahoo_symbol("BRK.B", "NYSE", "US"), "BRK-B")



class SelectionTests(unittest.TestCase):
    def sql(self, market="IN"):
        from unittest.mock import MagicMock
        from corporate_results_sync import select_assets
        conn = MagicMock()
        cursor = conn.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = []
        select_assets(conn, market, None, 1000, 20)
        return cursor.execute.call_args.args

    def test_defaults_to_nse_only(self):
        sql, params = self.sql("IN")
        self.assertIn("a.exchange='NSE'", sql)
        self.assertNotIn("NASDAQ", sql)
        self.assertEqual(params["limit"], 1000)

    def test_prioritises_trades_plans_and_shortlist_before_rotation(self):
        sql, params = self.sql()
        self.assertLess(sql.index("swing_pending_orders"), sql.index("armed_swing_plans"))
        self.assertLess(sql.index("armed_swing_plans"), sql.index("r.pivot*0.90"))
        self.assertIn("order by tier, last_success_at nulls first", sql)
        self.assertEqual(params["recheck_seconds"], 20 * 3600)


class CoverageTests(unittest.TestCase):
    def test_coverage_counts_only_the_apps_verified_rule(self):
        from unittest.mock import MagicMock
        from corporate_results_sync import (
            VERIFIED_MAX_CHECK_AGE_DAYS, VERIFIED_RECENT_RESULTS_DAYS, coverage,
        )
        conn = MagicMock()
        cursor = conn.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = (900, 600, 1000)
        self.assertEqual(coverage(conn, "IN"), (900, 600, 1000))
        sql, params = cursor.execute.call_args.args
        # Verified needs a usable date, not just a successful request.
        self.assertIn("e.event_date >= (select d from today)", sql)
        self.assertIn("e.event_date >= (select d from today) - %(recent_days)s", sql)
        self.assertEqual(params["tz"], "Asia/Kolkata")
        # Same thresholds as resultsCalendarCoverage() in lib/analytics/armedSwing.ts.
        self.assertEqual(VERIFIED_MAX_CHECK_AGE_DAYS, 7)
        self.assertEqual(VERIFIED_RECENT_RESULTS_DAYS, 70)

if __name__ == "__main__":
    unittest.main()
