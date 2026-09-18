import unittest
from unittest.mock import MagicMock

from us_history_sync import load_assets


class EodSelectionTests(unittest.TestCase):
    def query(self, refresh_all):
        conn = MagicMock()
        cursor = conn.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = []
        load_assets(conn, None, 100000, 260, 0, refresh_all)
        return cursor.execute.call_args.args[0]

    def test_eod_includes_same_session_bars(self):
        sql = self.query(True)
        self.assertNotIn("o.last_date < current_date", sql)
        self.assertIn("a.is_active=true", sql)
        self.assertIn("s.last_attempt_at", sql)

    def test_recurring_selection_is_unchanged(self):
        self.assertIn("o.last_date < current_date", self.query(False))


if __name__ == "__main__":
    unittest.main()
