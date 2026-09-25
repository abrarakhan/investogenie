import unittest
from datetime import date

import pandas as pd

from us_market_sync import quote_from_section


class USMarketSyncTest(unittest.TestCase):
    def test_intraday_quote_builds_current_session_ohlcv(self):
        frame = pd.DataFrame({
            "Open": [100.0, 101.0], "High": [102.0, 104.0],
            "Low": [99.0, 100.5], "Close": [101.0, 103.0],
            "Volume": [1_000, 1_500],
        }, index=pd.DatetimeIndex([
            "2026-09-24 13:30:00+00:00", "2026-09-24 13:35:00+00:00",
        ]))

        quote = quote_from_section(frame, 98.0, date(2026, 9, 24))

        self.assertIsNotNone(quote)
        self.assertEqual(quote.price, 103.0)
        self.assertEqual(quote.open, 100.0)
        self.assertEqual(quote.high, 104.0)
        self.assertEqual(quote.low, 99.0)
        self.assertEqual(quote.volume, 2_500)
        self.assertEqual(quote.source, "YAHOO_FINANCE_LIVE")
        self.assertAlmostEqual(quote.change_pct or 0, 5.1020408, places=5)

    def test_intraday_quote_rejects_previous_session(self):
        frame = pd.DataFrame(
            {"Close": [100.0]},
            index=pd.DatetimeIndex(["2026-09-23 19:55:00+00:00"]),
        )
        self.assertIsNone(quote_from_section(frame, 99.0, date(2026, 9, 24)))


if __name__ == "__main__":
    unittest.main()
