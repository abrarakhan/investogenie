import unittest
from unittest.mock import MagicMock

from us_history_sync import count_behind_session_assets, late_completion_error, load_assets


class EodSelectionTests(unittest.TestCase):
    def query(self, refresh_all, behind_session=None):
        conn = MagicMock()
        cursor = conn.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = []
        load_assets(conn, None, 100000, 260, 0, refresh_all, behind_session)
        self.params = cursor.execute.call_args.args[1]
        return cursor.execute.call_args.args[0]

    def test_eod_includes_same_session_bars(self):
        sql = self.query(True)
        self.assertNotIn("o.last_date < current_date", sql)
        self.assertIn("a.is_active=true", sql)
        self.assertIn("s.last_attempt_at", sql)

    def test_recurring_selection_is_unchanged(self):
        self.assertIn("o.last_date < current_date", self.query(False))

    def test_late_pass_selects_only_recent_assets_missing_the_session(self):
        sql = self.query(False, "2026-11-05")
        self.assertIn("o.last_date < %s::date", sql)
        self.assertIn("interval '14 days'", sql)
        self.assertIn("public.latest_quotes", sql)
        self.assertIn("a.exchange in ('NASDAQ','NYSE','AMEX','NYSEAMERICAN','NYSEARCA')", sql)
        self.assertIn("a.ticker ~ '-P[A-Z]?$'", sql)
        self.assertNotIn("current_date", sql)
        # No empty-result backoff: these symbols were just attempted by the EOD pass.
        self.assertNotIn("s.last_attempt_at <", sql)
        self.assertEqual(self.params[:3], ["2026-11-05", "2026-11-05", "2026-11-05"])

    def test_late_completion_rejects_provider_failures(self):
        self.assertEqual(late_completion_error(1000, 1, 0), "1 downloads failed")

    def test_late_completion_budget_uses_the_eligible_universe(self):
        # A retry that selected only one straggler must not fail on that straggler.
        self.assertIsNone(late_completion_error(6500, 0, 1))
        conn = MagicMock()
        cursor = conn.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = (1, 6500, ["WLYB"])
        self.assertEqual(count_behind_session_assets(conn, "2026-11-05"), (1, 6500, ["WLYB"]))
        sql, params = cursor.execute.call_args.args
        self.assertIn("count(*) filter (where o.last_date < %s::date)", sql)
        self.assertEqual(params, ["2026-11-05"] * 4)

    def test_late_completion_rejects_more_than_five_percent_remaining(self):
        self.assertIsNone(late_completion_error(1474, 0, 73))
        self.assertEqual(
            late_completion_error(1474, 0, 74),
            "74 session gaps remain (allowed 73 of 1474)",
        )


if __name__ == "__main__":
    unittest.main()
