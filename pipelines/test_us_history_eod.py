import unittest
from datetime import date, datetime
from zoneinfo import ZoneInfo

import pandas as pd
from unittest.mock import MagicMock, patch

from us_history_sync import (
    AssetState, count_behind_session_assets, fetch_window, late_completion_error,
    load_assets, normalize_download,
)


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
        self.assertIn("o.last_final_date < %s::date", sql)
        self.assertIn("interval '14 days'", sql)
        self.assertIn("public.latest_quotes", sql)
        self.assertIn("a.exchange in ('NASDAQ','NYSE','AMEX','NYSEAMERICAN','NYSEARCA')", sql)
        self.assertIn("a.ticker ~ '-P[A-Z]?$'", sql)
        self.assertNotIn("current_date", sql)
        # No empty-result backoff: these symbols were just attempted by the EOD pass.
        self.assertNotIn("s.last_attempt_at <", sql)
        self.assertEqual(self.params[:3], ["2026-11-05", "2026-11-05", "2026-11-05"])

    def test_us_history_excludes_unfinished_session_in_exchange_timezone(self):
        state = AssetState("id", "AAPL", "NASDAQ", 500, date(2026, 11, 25))
        args = MagicMock(force_full=False, min_bars=260)
        with patch("us_history_sync.datetime") as clock:
            eastern = ZoneInfo("America/New_York")
            clock.now.side_effect = [
                datetime(2026, 11, 27, 16, 14, tzinfo=eastern),
                datetime(2026, 11, 27, 16, 15, tzinfo=eastern),
            ]
            self.assertEqual(fetch_window(state, args)[1], date(2026, 11, 27))
            self.assertEqual(fetch_window(state, args)[1], date(2026, 11, 28))

    def test_history_keeps_unadjusted_quote_with_adjusted_candle(self):
        frame = pd.DataFrame(
            {"Open": [90.0], "High": [110.0], "Low": [80.0], "Close": [100.0],
             "Adj Close": [95.0], "Volume": [1000]},
            index=pd.DatetimeIndex(["2026-11-25"], name="Date"),
        )
        row = normalize_download(frame).iloc[0]
        self.assertEqual(row.unadjusted_close, 100.0)
        self.assertEqual(row.close, 95.0)

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
        self.assertIn("count(*) filter (where o.last_final_date is null or o.last_final_date < %s::date)", sql)
        self.assertEqual(params, ["2026-11-05"] * 4)

    def test_late_completion_rejects_more_than_five_percent_remaining(self):
        self.assertIsNone(late_completion_error(1474, 0, 73))
        self.assertEqual(
            late_completion_error(1474, 0, 74),
            "74 session gaps remain (allowed 73 of 1474)",
        )


if __name__ == "__main__":
    unittest.main()
