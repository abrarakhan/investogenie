import io
import hashlib
import unittest
from zipfile import ZipFile

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from breeze_market_daemon import decrypt_credential, parse_security_master, parse_tick_time


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
