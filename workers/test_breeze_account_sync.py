import datetime as dt
import unittest

from breeze_account_sync import (
    INVESTOGENIE_ACTIVITY_START,
    enrich_holdings_with_prices,
    as_number,
    external_key,
    BrokerError,
    ORDER_HISTORY_WINDOW,
    fetch_rows,
    is_quota_error,
    replace_snapshot,
    sync_jobs,
    history_windows,
    response_rows,
    summarize_errors,
)


class BreezeAccountSyncTest(unittest.TestCase):
    def test_response_rows_accepts_list_and_object(self):
        self.assertEqual(response_rows({"Success": [{"stock_code": "TATMOT"}], "Error": None})[0]["stock_code"], "TATMOT")
        self.assertEqual(response_rows({"Success": {"available_balance": "1000"}, "Error": None})[0]["available_balance"], "1000")

    def test_response_error_is_not_treated_as_empty_success(self):
        with self.assertRaisesRegex(RuntimeError, "expired"):
            response_rows({"Success": None, "Error": "Session expired"})

    def test_no_data_found_is_a_successful_empty_snapshot(self):
        self.assertEqual(response_rows({"Success": None, "Error": "No Data Found"}), [])

    def test_transient_broker_failure_is_retried(self):
        responses = iter([RuntimeError("empty response"), {"Success": [{"order_id": "1"}]}])

        def fetch():
            response = next(responses)
            if isinstance(response, Exception):
                raise response
            return response

        self.assertEqual(fetch_rows(fetch, attempts=2), [{"order_id": "1"}])

    def test_broker_refusal_is_not_retried(self):
        calls = []

        def fetch():
            calls.append(1)
            return {"Success": None, "Error": "During market hours, you can check orders for any 5 days or up to 200 records."}

        with self.assertRaises(BrokerError):
            fetch_rows(fetch, attempts=3)
        self.assertEqual(len(calls), 1)

    def test_no_positions_is_a_successful_empty_snapshot(self):
        self.assertEqual(response_rows({"Success": None, "Error": "No Positions available."}), [])

    def test_daily_allowance_error_is_recognised(self):
        self.assertTrue(is_quota_error("Limit exceed: API call per day: "))
        self.assertFalse(is_quota_error("Session expired"))

    def test_order_history_windows_fit_the_market_hours_limit(self):
        end = INVESTOGENIE_ACTIVITY_START + dt.timedelta(days=24)
        for from_date, to_date in history_windows(INVESTOGENIE_ACTIVITY_START, end, ORDER_HISTORY_WINDOW):
            span = dt.datetime.fromisoformat(to_date.replace("Z", "+00:00")) - dt.datetime.fromisoformat(from_date.replace("Z", "+00:00"))
            self.assertLess(span, dt.timedelta(days=5))

    def test_routine_run_reads_only_recent_history(self):
        class Broker:
            def __getattr__(self, name):
                return lambda *args, **kwargs: {"Success": []}

        now = INVESTOGENIE_ACTIVITY_START + dt.timedelta(days=100)
        recent = sync_jobs(Broker(), now, full_history=False)
        full = sync_jobs(Broker(), now, full_history=True)
        self.assertLessEqual(len(recent), 12)
        self.assertGreater(len(full), 60)
        self.assertEqual([kind for kind, _ in recent[:3]], ["FUNDS", "HOLDING", "POSITION"])

    def test_merge_keeps_history_that_was_not_re_read(self):
        statements = []

        class Cursor:
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def execute(self, sql, params=None): statements.append((" ".join(sql.split()), params))
            def mogrify(self, *args): return b""

        class Conn:
            encoding = "UTF8"
            def cursor(self): return Cursor()

        replace_snapshot(Conn(), "u", "ORDER", [], merge=True)
        self.assertIn("external_key = any(%s)", statements[0][0])
        self.assertEqual(statements[0][1], ("u", "ORDER", []))
        statements.clear()
        replace_snapshot(Conn(), "u", "ORDER", [])
        self.assertNotIn("external_key", statements[0][0])

    def test_repeated_broker_errors_are_summarized_once(self):
        self.assertEqual(
            summarize_errors([
                "ORDER: history window unavailable",
                "ORDER: history window unavailable",
                "TRADE: session expired",
            ]),
            "ORDER: history window unavailable (repeated 2 times); TRADE: session expired",
        )

    def test_empty_broker_errors_have_no_summary(self):
        self.assertIsNone(summarize_errors([]))

    def test_reconciliation_starts_with_investogenie_activity(self):
        self.assertEqual(INVESTOGENIE_ACTIVITY_START.date().isoformat(), "2026-08-01")

    def test_broker_history_is_split_within_breeze_limit(self):
        end = INVESTOGENIE_ACTIVITY_START + dt.timedelta(days=24)
        windows = history_windows(INVESTOGENIE_ACTIVITY_START, end)

        self.assertEqual(len(windows), 3)
        for from_date, to_date in windows:
            start_at = dt.datetime.fromisoformat(from_date.replace("Z", "+00:00"))
            end_at = dt.datetime.fromisoformat(to_date.replace("Z", "+00:00"))
            self.assertLessEqual(end_at - start_at, dt.timedelta(days=9))

    def test_external_keys_keep_distinct_orders(self):
        first = external_key("ORDER", {"order_id": "101"}, 0)
        second = external_key("ORDER", {"order_id": "102"}, 1)
        self.assertNotEqual(first, second)

    def test_number_parser_handles_broker_format(self):
        self.assertEqual(str(as_number("1,180.50")), "1180.50")


class HoldingPriceTests(unittest.TestCase):
    def test_attaches_breeze_price_and_cost_keeping_demat_quantity(self):
        demat = [{"stock_code": "RELIND", "quantity": "10", "stock_ISIN": "INE002A01018"},
                 {"stock_code": "NOPRICE", "quantity": "5"}]
        portfolio = [{"stock_code": "relind", "quantity": "12", "current_market_price": "2950.5",
                      "average_price": "2400", "change_percentage": "-1.2"}]
        rows = enrich_holdings_with_prices(demat, portfolio)
        self.assertEqual(rows[0]["quantity"], "10")  # custody quantity wins
        self.assertEqual(rows[0]["current_market_price"], "2950.5")
        self.assertEqual(rows[0]["average_price"], "2400")
        self.assertEqual(rows[0]["price_source"], "BREEZE_PORTFOLIO")
        self.assertNotIn("price_source", rows[1])

    def test_ignores_portfolio_rows_without_a_price(self):
        rows = enrich_holdings_with_prices([{"stock_code": "X", "quantity": "1"}],
                                           [{"stock_code": "X", "current_market_price": ""}])
        self.assertNotIn("current_market_price", rows[0])


if __name__ == "__main__":
    unittest.main()
