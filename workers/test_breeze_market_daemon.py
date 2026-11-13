import io
import hashlib
import unittest
from zipfile import ZipFile

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

import datetime as dt

from breeze_market_daemon import IST, MarketBatcher, MinuteBarBuilder, merge_minute_bars, order_event, order_notice, ReconnectWatch, circuit_limits, feed_stalled, order_flow, decrypt_credential, safe_ws_disconnect, is_india_market_session, parse_security_master, parse_tick_time, valid_ohlc


class ReconnectWatchTests(unittest.TestCase):
    def test_waits_for_the_client_to_reconnect_before_giving_up(self):
        watch = ReconnectWatch(90)
        self.assertIsNone(watch.observe(True, 0))
        self.assertEqual(watch.observe(False, 5), "dropped")
        self.assertIsNone(watch.observe(False, 60))
        self.assertEqual(watch.downtime(60), 55)
        self.assertEqual(watch.observe(True, 65), "recovered")
        self.assertIsNone(watch.observe(True, 70))

    def test_gives_up_after_the_grace_period(self):
        watch = ReconnectWatch(90)
        watch.observe(False, 0)
        self.assertIsNone(watch.observe(False, 85))
        self.assertEqual(watch.observe(False, 90), "expired")

    def test_gives_up_quickly_when_the_client_is_not_retrying(self):
        watch = ReconnectWatch(90)
        watch.observe(False, 0, reconnecting=False)
        self.assertIsNone(watch.observe(False, 5, reconnecting=False))
        self.assertEqual(watch.observe(False, 10, reconnecting=False), "expired")

    def test_cleanup_tolerates_an_already_dropped_socket(self):
        class Dropped:
            def ws_disconnect(self):
                raise RuntimeError("/ is not a connected namespace.")
        safe_ws_disconnect(Dropped())


class BreezeMarketDaemonTests(unittest.TestCase):
    def test_security_master_maps_exchange_ticker_to_breeze_token(self):
        content = (
            '"Token","ShortName","Series","CompanyName","ExchangeCode"\n'
            '"2885","RELIND","EQ","RELIANCE INDUSTRIES","RELIANCE"\n'
            '"0","OLD","EQ","DELISTED","OLD"\n'
        )
        buffer = io.BytesIO()
        with ZipFile(buffer, "w") as archive:
            archive.writestr("NSEScripMaster.txt", content)
        buffer.seek(0)
        with ZipFile(buffer) as archive:
            result = parse_security_master(archive, "NSE")
        self.assertEqual(result, {"RELIANCE": ("RELIND", "2885", "RELIANCE INDUSTRIES")})

    def test_tick_time_does_not_depend_on_the_server_time_zone(self):
        import os, time
        previous = os.environ.get("TZ")
        try:
            # The SDK prints the feed's time in the server's zone: 07:04:56 UTC is 12:34:56 IST.
            os.environ["TZ"] = "UTC"; time.tzset()
            parsed = parse_tick_time("Wed Sep  9 07:04:56 2026")
            self.assertEqual((parsed.hour, parsed.minute, parsed.utcoffset()), (12, 34, IST.utcoffset(None)))
            os.environ["TZ"] = "Asia/Kolkata"; time.tzset()
            self.assertEqual(parse_tick_time("Wed Sep 09 12:34:56 2026").hour, 12)
        finally:
            if previous is None:
                os.environ.pop("TZ", None)
            else:
                os.environ["TZ"] = previous
            time.tzset()

    def test_unreadable_tick_time_is_rejected_not_stamped_now(self):
        self.assertIsNone(parse_tick_time("12/09/2026 12:34"))
        self.assertIsNotNone(parse_tick_time(None))
        self.assertEqual(parse_tick_time("2026-09-09 12:34:56").hour, 12)

    def test_feed_stall_needs_a_connected_socket_and_an_open_market(self):
        self.assertTrue(feed_stalled(200, connected=True, market_open=True, limit=180))
        self.assertFalse(feed_stalled(100, connected=True, market_open=True, limit=180))
        self.assertFalse(feed_stalled(900, connected=True, market_open=False, limit=180))
        self.assertFalse(feed_stalled(900, connected=False, market_open=True, limit=180))

    def test_a_full_batch_wakes_the_flusher_without_writing_on_the_tick_thread(self):
        import threading
        import breeze_market_daemon as module
        batcher = MarketBatcher.__new__(MarketBatcher)
        batcher.pending = {}; batcher.lock = threading.Lock(); batcher.wake = threading.Event()
        batcher.max_batch = 1; batcher.last_tick_at = 0.0; batcher.unreadable_times = 0
        batcher.minute_bars = MinuteBarBuilder()
        batcher.flush = lambda: self.fail("a tick thread must not write to the database")
        original = module.is_india_market_session
        module.is_india_market_session = lambda *args, **kwargs: True
        try:
            instrument = type("Instrument", (), {"asset_id": "a", "ticker": "T", "exchange": "NSE"})()
            batcher.enqueue(instrument, {"last": 100, "open": 99, "high": 101, "low": 98})
        finally:
            module.is_india_market_session = original
        self.assertTrue(batcher.wake.is_set())
        self.assertEqual(len(batcher.pending), 1)
        self.assertGreater(batcher.last_tick_at, 0.0)
        self.assertEqual(len(batcher.minute_bars.drain()), 1)  # the same tick also feeds the minute bar

    def test_circuit_limits_use_the_sdk_key_spelling(self):
        self.assertEqual(circuit_limits({"lowerCktLm": "229.50", "upperCktLm": 280.5}), (229.5, 280.5))
        self.assertEqual(circuit_limits({"lowerCktLM": 90, "upper_circuit": "110"}), (90.0, 110.0))

    def test_order_flow_reads_vwap_and_resting_quantities(self):
        self.assertEqual(order_flow({"avgPrice": "254.31", "totalBuyQt": 120000, "totalSellQ": "80,500"}), (254.31, 120000.0, 80500.0))
        self.assertEqual(order_flow({"avgPrice": 0, "last": 10}), (None, None, None))

    def test_missing_or_zero_circuit_limits_are_unknown(self):
        self.assertEqual(circuit_limits({"last": 100}), (None, None))
        self.assertEqual(circuit_limits({"lowerCktLm": 0, "upperCktLm": ""}), (None, None))

    def test_tick_time_is_ist_aware(self):
        parsed = parse_tick_time("Wed Sep 09 12:34:56 2026")
        self.assertEqual(parsed.isoformat(), "2026-09-09T12:34:56+05:30")

    def test_zero_low_is_treated_as_missing_not_as_a_market_price(self):
        self.assertEqual(valid_ohlc(803.05, "809.95", "825", "0"), (809.95, 825.0, 803.05))

    def test_live_ohlc_is_clamped_around_the_last_trade(self):
        self.assertEqual(valid_ohlc(105, "100", "102", "103"), (100.0, 105, 100.0))

    def test_live_ticks_are_accepted_only_during_the_same_open_session(self):
        friday = dt.datetime(2026, 9, 11, 12, 0, tzinfo=IST)
        self.assertTrue(is_india_market_session(friday, friday))
        self.assertFalse(is_india_market_session(friday, dt.datetime(2026, 9, 11, 16, 0, tzinfo=IST)))
        self.assertFalse(is_india_market_session(friday, dt.datetime(2026, 9, 12, 12, 0, tzinfo=IST)))

    def test_live_ticks_are_rejected_on_exchange_holidays(self):
        holiday = dt.datetime(2026, 9, 14, 12, 0, tzinfo=IST)
        self.assertFalse(is_india_market_session(holiday, holiday))

    def test_decrypts_node_compatible_credential(self):
        master_key = "test-credential-key"
        plaintext = "daily-session-token"
        key = hashlib.scrypt(
            master_key.encode(),
            salt=b"investogenie-credential-salt",
            n=2**14,
            r=8,
            p=1,
            dklen=32,
        )
        iv = bytes.fromhex("00112233445566778899aabbccddeeff")
        encrypted_with_tag = AESGCM(key).encrypt(iv, plaintext.encode(), None)
        ciphertext, tag = encrypted_with_tag[:-16], encrypted_with_tag[-16:]
        stored = f"{iv.hex()}:{tag.hex()}:{ciphertext.hex()}"

        self.assertEqual(decrypt_credential(stored, master_key), plaintext)


class MinuteBarTests(unittest.TestCase):
    DAY = dt.date(2026, 11, 13)  # a regular Friday session

    def at(self, hour, minute, second=0):
        return dt.datetime.combine(self.DAY, dt.time(hour, minute, second), IST)

    def test_folds_ticks_into_minutes_with_volume_from_the_running_total(self):
        bars = MinuteBarBuilder()
        bars.add("a", self.at(9, 15, 5), 100.0, 1_000)
        bars.add("a", self.at(9, 15, 40), 102.0, 1_500)
        bars.add("a", self.at(9, 15, 55), 99.0, 1_800)
        bars.add("a", self.at(9, 16, 2), 101.0, 2_100)
        self.assertEqual(bars.drain(self.at(9, 16, 30)), [("a", self.at(9, 15), 100.0, 102.0, 99.0, 99.0, 1_800)])
        # The 09:16 bar is still forming, so it is held back until its minute ends.
        self.assertEqual(bars.drain(self.at(9, 16, 59)), [])
        self.assertEqual(bars.drain(self.at(9, 17, 0)), [("a", self.at(9, 16), 101.0, 101.0, 101.0, 101.0, 300)])

    def test_volume_is_unknown_when_the_worker_starts_mid_session(self):
        bars = MinuteBarBuilder()
        bars.add("a", self.at(11, 0, 10), 50.0, 900_000)
        bars.add("a", self.at(11, 1, 10), 51.0, 900_400)
        first, second = bars.drain()
        self.assertIsNone(first[6])
        self.assertEqual(second[6], 400)

    def test_a_new_session_does_not_inherit_yesterdays_total(self):
        bars = MinuteBarBuilder()
        bars.add("a", self.at(15, 29, 0), 50.0, 5_000_000)
        bars.drain()
        next_day = dt.datetime.combine(dt.date(2026, 11, 16), dt.time(9, 15, 3), IST)
        bars.add("a", next_day, 52.0, 7_000)
        self.assertEqual(bars.drain()[0][6], 7_000)

    def test_ignores_a_late_tick_and_never_reports_negative_volume(self):
        bars = MinuteBarBuilder()
        bars.add("a", self.at(9, 15, 0), 100.0, 1_000)
        bars.add("a", self.at(9, 16, 0), 101.0, 900)   # the feed's total went backwards
        bars.add("a", self.at(9, 15, 59), 500.0, 950)  # late tick for the finished minute
        first, second = bars.drain()
        self.assertEqual(first[3], 100.0)
        self.assertEqual(second[6], 0)

    def test_merges_two_pieces_of_the_same_minute_into_one_row(self):
        minute = self.at(10, 0)
        merged = merge_minute_bars([
            ("a", minute, 10.0, 11.0, 9.5, 10.5, 100),
            ("b", minute, 20.0, 20.0, 20.0, 20.0, None),
            ("a", minute, 10.5, 12.0, 10.2, 11.8, 40),
        ])
        self.assertEqual(merged, [("a", minute, 10.0, 12.0, 9.5, 11.8, 140), ("b", minute, 20.0, 20.0, 20.0, 20.0, None)])


class OrderUpdateTests(unittest.TestCase):
    TICK = {
        "sourceNumber": "1", "userId": "ABC123", "orderMatchAccount": "8500001234", "key": "k",
        "orderExchangeCode": "NSE", "stockCode": "relind", "orderFlow": "Buy", "orderStatus": "Executed",
        "orderReference": "20261113N100000042", "orderQuantity": "10", "orderExecutedQuantity": "10",
        "averageExecutedRate": "1450.5", "orderLimitRate": "1451",
    }

    def test_reads_an_order_update_and_drops_account_identifiers(self):
        event = order_event(self.TICK)
        self.assertEqual((event["reference"], event["status"], event["exchange"], event["stock_code"]),
                         ("20261113N100000042", "Executed", "NSE", "RELIND"))
        self.assertEqual((event["quantity"], event["executed"], event["average_price"]), (10.0, 10.0, 1450.5))
        self.assertNotIn("userId", event["raw"])
        self.assertNotIn("orderMatchAccount", event["raw"])

    def test_a_price_tick_or_an_incomplete_message_is_not_an_order_update(self):
        self.assertIsNone(order_event({"symbol": "4.1!2885", "last": 100}))
        self.assertIsNone(order_event({"orderReference": "X1"}))
        self.assertIsNone(order_event({"orderStatus": "Executed"}))

    def test_notifies_for_a_fill_using_the_app_ticker(self):
        title, body, signature = order_notice(order_event(self.TICK), "RELIANCE")
        self.assertEqual(title, "InvestoGenie: order executed")
        self.assertEqual(body, "Buy 10 RELIANCE at ₹1,450.50 — executed. Open Trade Ledger to review it.")
        self.assertEqual(signature, "ORDER|20261113N100000042|Executed|10")

    def test_a_partial_fill_reports_progress_and_each_step_notifies_once(self):
        partial = order_event({**self.TICK, "orderStatus": "Partially Executed", "orderExecutedQuantity": "4"})
        _, body, first = order_notice(partial, None)
        self.assertEqual(body, "Buy RELIND: 4 of 10 filled at ₹1,450.50 average — partially executed. Open Trade Ledger to review it.")
        later = order_event({**self.TICK, "orderStatus": "Partially Executed", "orderExecutedQuantity": "7"})
        self.assertNotEqual(first, order_notice(later, None)[2])

    def test_large_quantities_are_written_out_in_full(self):
        big = order_event({**self.TICK, "orderQuantity": "1250000", "orderExecutedQuantity": "1250000"})
        self.assertIn("Buy 1250000 RELIANCE", order_notice(big, "RELIANCE")[1])

    def test_an_order_with_no_fill_shows_no_price(self):
        for status in ("Rejected", "Cancelled", "Expired"):
            unfilled = order_event({**self.TICK, "orderStatus": status, "orderExecutedQuantity": "0", "averageExecutedRate": "0.00"})
            self.assertEqual(order_notice(unfilled, "RELIANCE")[1], f"Buy 10 RELIANCE — {status.lower()}. Open Trade Ledger to review it.")

    def test_the_price_does_not_change_the_signature(self):
        repriced = order_event({**self.TICK, "averageExecutedRate": "1450.55"})
        self.assertEqual(order_notice(repriced, "RELIANCE")[2], order_notice(order_event(self.TICK), "RELIANCE")[2])

    def test_routine_states_do_not_notify(self):
        for status in ("Requested", "Queued", "Ordered"):
            self.assertIsNone(order_notice(order_event({**self.TICK, "orderStatus": status}), "RELIANCE"))
        self.assertIsNotNone(order_notice(order_event({**self.TICK, "orderStatus": "Rejected"}), "RELIANCE"))


if __name__ == "__main__":
    unittest.main()
