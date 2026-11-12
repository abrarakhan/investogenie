import datetime as dt
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "workers"))

from breeze_intraday_sync import SOURCE, allowance_spent, minute_bar, parse_bar_time, session_window  # noqa: E402
from breeze_market_daemon import IST  # noqa: E402

DAY = dt.date(2026, 11, 13)  # a regular Friday session
OPENED = dt.datetime.combine(DAY, dt.time(9, 15), IST)
CLOSED = dt.datetime.combine(DAY, dt.time(15, 30), IST)


class BreezeIntradaySyncTests(unittest.TestCase):
    def test_waits_until_the_session_has_closed(self):
        self.assertIsNone(session_window(DAY, dt.datetime.combine(DAY, dt.time(15, 31), IST)))
        self.assertEqual(session_window(DAY, dt.datetime.combine(DAY, dt.time(15, 40), IST)), (OPENED, CLOSED))

    def test_a_weekend_has_no_session(self):
        saturday = dt.date(2026, 11, 14)
        self.assertIsNone(session_window(saturday, dt.datetime.combine(saturday, dt.time(18, 0), IST)))

    def test_reads_candle_times_as_ist(self):
        self.assertEqual(parse_bar_time("2026-11-13 09:15:00"), OPENED)
        self.assertEqual(parse_bar_time("2026-11-13T10:02:00.000Z"), dt.datetime.combine(DAY, dt.time(10, 2), IST))
        self.assertIsNone(parse_bar_time("13-Nov-2026"))

    def test_builds_a_bar_and_repairs_an_inconsistent_range(self):
        row = {"datetime": "2026-11-13 09:15:00", "open": "100", "high": "99", "low": "101", "close": "100.5", "volume": "1200"}
        self.assertEqual(minute_bar(row, "a", OPENED, CLOSED), ("a", OPENED, 100.0, 100.5, 100.0, 100.5, 1200, SOURCE))

    def test_drops_candles_outside_the_session_or_without_a_price(self):
        base = {"open": "100", "high": "101", "low": "99", "close": "100", "volume": "5"}
        self.assertIsNone(minute_bar({**base, "datetime": "2026-11-13 15:30:00"}, "a", OPENED, CLOSED))
        self.assertIsNone(minute_bar({**base, "datetime": "2026-11-13 09:14:00"}, "a", OPENED, CLOSED))
        self.assertIsNone(minute_bar({**base, "datetime": "2026-11-12 10:00:00"}, "a", OPENED, CLOSED))
        self.assertIsNone(minute_bar({**base, "close": "0", "datetime": "2026-11-13 10:00:00"}, "a", OPENED, CLOSED))

    def test_keeps_a_bar_whose_volume_is_missing(self):
        row = {"datetime": "2026-11-13 10:00:00", "open": 10, "high": 11, "low": 9, "close": 10}
        self.assertIsNone(minute_bar(row, "a", OPENED, CLOSED)[6])

    def test_recognises_a_spent_allowance(self):
        self.assertTrue(allowance_spent({"Success": None, "Status": 5, "Error": "Limit exceed: API call per day:"}))
        self.assertFalse(allowance_spent({"Success": [], "Status": 200, "Error": None}))


if __name__ == "__main__":
    unittest.main()
