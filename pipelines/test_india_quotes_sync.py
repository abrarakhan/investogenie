import unittest

from india_quotes_sync import load_assets


class _Cursor:
    def __init__(self) -> None:
        self.sql = ""

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, sql, _params) -> None:
        self.sql = sql

    def fetchall(self):
        return []


class _Connection:
    def __init__(self) -> None:
        self.last_cursor = _Cursor()

    def cursor(self):
        return self.last_cursor


class IndiaQuotePriorityTests(unittest.TestCase):
    def test_candidate_targets_survive_weekends_and_holiday_gaps(self) -> None:
        connection = _Connection()

        load_assets(connection, "NSE", None, priority_only=True)

        self.assertEqual(connection.last_cursor.sql.count("interval '7 days'"), 2)
        self.assertNotIn("interval '1 day'", connection.last_cursor.sql)

    def test_same_session_breeze_quotes_are_not_selected_for_fallback_overwrite(self) -> None:
        connection = _Connection()

        load_assets(connection, "NSE", None, priority_only=True)

        self.assertIn("q.source='BREEZE_LIVE'", connection.last_cursor.sql)
        self.assertIn("Asia/Kolkata", connection.last_cursor.sql)
        self.assertNotIn("q.updated_at >= now() - interval '20 minutes'", connection.last_cursor.sql)


if __name__ == "__main__":
    unittest.main()
