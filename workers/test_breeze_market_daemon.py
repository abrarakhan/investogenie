import io
import hashlib
import unittest
from zipfile import ZipFile

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

import datetime as dt

from breeze_market_daemon import IST, decrypt_credential, is_india_market_session, parse_security_master, parse_tick_time, valid_ohlc


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


if __name__ == "__main__":
    unittest.main()
