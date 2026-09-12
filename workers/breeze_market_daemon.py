#!/usr/bin/env python3
"""Breeze cash-market WebSocket -> InvestoGenie quote and daily OHLCV bridge.

The worker is intentionally separate from the web process. It subscribes with
ICICI security-master tokens, coalesces rapid ticks in memory, and writes one
latest row per asset every few seconds. Bhavcopy remains the EOD reconciliation
source because Breeze historical candles are unadjusted and REST-limited.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import io
import os
import signal
import sys
import threading
import time
from dataclasses import dataclass
from decimal import Decimal
from typing import Any
from zipfile import ZipFile

import psycopg2
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from psycopg2.extras import execute_values

IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
EQUITY_SERIES = {"EQ", "BE", "BZ", "SM", "ST", "SZ", "DR"}


def env(name: str, default: str | None = None) -> str | None:
    value = os.getenv(name)
    return value if value not in (None, "") else default


def database_url() -> str:
    return env("DATABASE_URL", "postgresql://localhost:5432/investogenie") or ""


@dataclass(frozen=True)
class BreezeCredentials:
    api_key: str
    api_secret: str
    session_token: str
    fingerprint: str


def decrypt_credential(value: str, master_key: str) -> str:
    iv_hex, tag_hex, ciphertext_hex = value.split(":", 2)
    key = hashlib.scrypt(
        master_key.encode(),
        salt=b"investogenie-credential-salt",
        n=2**14,
        r=8,
        p=1,
        dklen=32,
    )
    encrypted_and_tag = bytes.fromhex(ciphertext_hex) + bytes.fromhex(tag_hex)
    return AESGCM(key).decrypt(bytes.fromhex(iv_hex), encrypted_and_tag, None).decode()


def load_breeze_credentials() -> BreezeCredentials | None:
    master_key = env("CREDENTIAL_ENCRYPTION_KEY")
    if master_key:
        with psycopg2.connect(database_url()) as conn, conn.cursor() as cur:
            cur.execute(
                """
                select c.breeze_api_key_encrypted,c.breeze_api_secret_encrypted,
                       c.breeze_session_token_encrypted
                  from public.user_credentials c
                  join public.users u on u.id=c.user_id
                 where c.breeze_api_key_encrypted is not null
                   and c.breeze_api_secret_encrypted is not null
                   and c.breeze_session_token_encrypted is not null
                 order by (u.email=%s) desc,u.created_at asc
                 limit 1
                """,
                (env("DEFAULT_USER_EMAIL", ""),),
            )
            row = cur.fetchone()
        if row:
            fingerprint = hashlib.sha256("|".join(row).encode()).hexdigest()
            return BreezeCredentials(
                decrypt_credential(row[0], master_key),
                decrypt_credential(row[1], master_key),
                decrypt_credential(row[2], master_key),
                fingerprint,
            )

    api_key = env("BREEZE_API_KEY")
    api_secret = env("BREEZE_API_SECRET")
    session_token = env("BREEZE_SESSION_TOKEN")
    if api_key and api_secret and session_token:
        fingerprint = hashlib.sha256(f"{api_key}|{api_secret}|{session_token}".encode()).hexdigest()
        return BreezeCredentials(api_key, api_secret, session_token, fingerprint)
    return None


def wait_for_breeze_credentials(stop_event: threading.Event) -> BreezeCredentials | None:
    announced = False
    while not stop_event.is_set():
        try:
            credentials = load_breeze_credentials()
            if credentials:
                return credentials
        except Exception as exc:
            print(f"[breeze-market] credential lookup failed: {exc}", file=sys.stderr, flush=True)
        if not announced:
            print("[breeze-market] waiting for credentials in Settings", flush=True)
            announced = True
        stop_event.wait(30)
    return None


def wait_for_credential_change(
    previous_fingerprint: str,
    stop_event: threading.Event,
) -> BreezeCredentials | None:
    while not stop_event.wait(30):
        try:
            credentials = load_breeze_credentials()
            if credentials and credentials.fingerprint != previous_fingerprint:
                return credentials
        except Exception as exc:
            print(f"[breeze-market] credential lookup failed: {exc}", file=sys.stderr, flush=True)
    return None


def number(value: Any) -> float | None:
    if value in (None, "", "--", "-"):
        return None
    try:
        return float(Decimal(str(value).replace(",", "").replace("C", "")))
    except Exception:
        return None


def integer(value: Any) -> int | None:
    parsed = number(value)
    return int(parsed) if parsed is not None else None


def normalized_row(row: dict[str, str]) -> dict[str, str]:
    return {str(key).strip().strip('"').lower(): str(value or "").strip().strip('"') for key, value in row.items()}


@dataclass(frozen=True)
class CashInstrument:
    asset_id: str
    ticker: str
    exchange: str
    breeze_code: str
    token: str
    company_name: str

    @property
    def stream_token(self) -> str:
        prefix = "4.1!" if self.exchange == "NSE" else "1.1!"
        return f"{prefix}{self.token}"


def parse_security_master(archive: ZipFile, exchange: str) -> dict[str, tuple[str, str, str]]:
    filename = "NSEScripMaster.txt" if exchange == "NSE" else "BSEScripMaster.txt"
    output: dict[str, tuple[str, str, str]] = {}
    with archive.open(filename) as raw:
        reader = csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig", errors="replace"))
        for original in reader:
            row = normalized_row(original)
            ticker = row.get("exchangecode", "").upper()
            token = row.get("token", "")
            breeze_code = row.get("shortname", "").upper()
            series = row.get("series", "").upper()
            if not ticker or not token or token == "0" or not breeze_code:
                continue
            if series and series not in EQUITY_SERIES:
                continue
            output[ticker] = (breeze_code, token, row.get("companyname", ""))
    return output


def load_cash_instruments(conn, archive: ZipFile, exchanges: list[str], limit: int) -> list[CashInstrument]:
    masters = {exchange: parse_security_master(archive, exchange) for exchange in exchanges}
    with conn.cursor() as cur:
        cur.execute(
            """
            select a.id::text,a.ticker,a.exchange
              from public.assets a
             where a.country='IN' and a.asset_class='STOCK'
               and a.exchange=any(%s) and coalesce(a.is_active,true)
               and not exists(select 1 from public.asset_tracking_exclusions x where x.asset_id=a.id)
             order by
               case when exists(
                 select 1 from public.swing_trade_ledger l where l.asset_id=a.id and l.status='OPEN'
               ) then 0 when exists(
                 select 1 from public.swing_signals s
                  where s.asset_id=a.id and s.verdict <> 'NO_SETUP'
               ) then 1 when exists(
                 select 1 from public.universe_members u where u.asset_id=a.id and u.universe='NIFTY_500'
               ) then 2 else 3 end,
               a.exchange,a.ticker
            """,
            (exchanges,),
        )
        assets = cur.fetchall()

    instruments: list[CashInstrument] = []
    for asset_id, ticker, exchange in assets:
        match = masters[exchange].get(str(ticker).upper())
        if not match:
            continue
        breeze_code, token, company_name = match
        instruments.append(CashInstrument(asset_id, ticker, exchange, breeze_code, token, company_name))
        if limit > 0 and len(instruments) >= limit:
            break
    return instruments


def parse_tick_time(value: Any) -> dt.datetime:
    if value:
        for pattern in ("%a %b %d %H:%M:%S %Y", "%Y-%m-%d %H:%M:%S"):
            try:
                return dt.datetime.strptime(str(value), pattern).replace(tzinfo=IST)
            except ValueError:
                pass
    return dt.datetime.now(IST)


class MarketBatcher:
    def __init__(self, dsn: str, flush_seconds: float, max_batch: int):
        self.flush_seconds = flush_seconds
        self.max_batch = max_batch
        self.pending: dict[str, dict[str, Any]] = {}
        self.lock = threading.Lock()
        self.flush_lock = threading.Lock()
        self.stop_event = threading.Event()
        self.conn = psycopg2.connect(dsn)
        self.thread = threading.Thread(target=self._loop, name="breeze-db-flusher", daemon=True)
        self.thread.start()

    def enqueue(self, instrument: CashInstrument, tick: dict[str, Any]) -> None:
        price = number(tick.get("last") or tick.get("ltp") or tick.get("close"))
        if price is None or price <= 0:
            return
        timestamp = parse_tick_time(tick.get("ltt") or tick.get("datetime"))
        row = {
            "asset_id": instrument.asset_id,
            "ticker": instrument.ticker,
            "exchange": instrument.exchange,
            "timestamp": timestamp,
            "date": timestamp.date(),
            "price": price,
            "change_pct": number(tick.get("change")),
            "open": number(tick.get("open")),
            "high": number(tick.get("high")),
            "low": number(tick.get("low")),
            "volume": integer(tick.get("ttq") or tick.get("volume") or tick.get("total_quantity_traded")),
        }
        with self.lock:
            self.pending[instrument.asset_id] = row
            should_flush = len(self.pending) >= self.max_batch
        if should_flush:
            self.flush()

    def flush(self) -> int:
        with self.flush_lock:
            return self._flush_locked()

    def _flush_locked(self) -> int:
        with self.lock:
            rows = list(self.pending.values())
            self.pending.clear()
        if not rows:
            return 0
        try:
            with self.conn.cursor() as cur:
                execute_values(
                    cur,
                    """
                    insert into public.latest_quotes
                      (asset_id,price,change_pct,currency,as_of,source,updated_at)
                    values %s
                    on conflict (asset_id) do update set
                      price=excluded.price,change_pct=excluded.change_pct,
                      currency=excluded.currency,as_of=excluded.as_of,
                      source=excluded.source,updated_at=excluded.updated_at
                    where public.latest_quotes.as_of is null or public.latest_quotes.as_of <= excluded.as_of
                    """,
                    [(r["asset_id"], r["price"], r["change_pct"], "INR", r["timestamp"], "BREEZE_LIVE", dt.datetime.now(dt.timezone.utc)) for r in rows],
                    page_size=500,
                )
                execute_values(
                    cur,
                    """
                    insert into public.daily_ohlcv
                      (asset_id,date,open,high,low,close,volume)
                    values %s
                    on conflict (asset_id,date) do update set
                      open=coalesce(public.daily_ohlcv.open,excluded.open),
                      high=case when excluded.high is null then public.daily_ohlcv.high when public.daily_ohlcv.high is null then excluded.high else greatest(public.daily_ohlcv.high,excluded.high) end,
                      low=case when excluded.low is null then public.daily_ohlcv.low when public.daily_ohlcv.low is null then excluded.low else least(public.daily_ohlcv.low,excluded.low) end,
                      close=excluded.close,
                      volume=case when excluded.volume is null then public.daily_ohlcv.volume when public.daily_ohlcv.volume is null then excluded.volume else greatest(public.daily_ohlcv.volume,excluded.volume) end
                    """,
                    [(r["asset_id"], r["date"], r["open"], r["high"], r["low"], r["price"], r["volume"]) for r in rows],
                    page_size=500,
                )
            self.conn.commit()
        except Exception:
            self.conn.rollback()
            with self.lock:
                for row in rows:
                    self.pending.setdefault(row["asset_id"], row)
            raise
        print(f"[breeze-market] flushed {len(rows)} cash quotes", flush=True)
        return len(rows)

    def _loop(self) -> None:
        while not self.stop_event.wait(self.flush_seconds):
            try:
                self.flush()
            except Exception as exc:
                print(f"[breeze-market] database flush failed: {exc}", file=sys.stderr, flush=True)

    def close(self) -> None:
        self.stop_event.set()
        self.thread.join(timeout=self.flush_seconds + 2)
        self.flush()
        self.conn.close()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Stream Breeze NSE/BSE cash quotes into Postgres")
    parser.add_argument("--limit", type=int, default=int(env("BREEZE_CASH_LIMIT", "750") or "750"))
    parser.add_argument("--flush-seconds", type=float, default=float(env("BREEZE_DB_FLUSH_SECONDS", "3") or "3"))
    parser.add_argument("--max-batch", type=int, default=int(env("BREEZE_DB_MAX_BATCH", "500") or "500"))
    parser.add_argument("--subscription-batch-size", type=int, default=int(env("BREEZE_SUBSCRIBE_BATCH_SIZE", "100") or "100"))
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    process_stop_event = threading.Event()

    def stop_process(signum: int, _frame: Any) -> None:
        print(f"[breeze-market] stopping on signal {signum}", flush=True)
        process_stop_event.set()

    signal.signal(signal.SIGINT, stop_process)
    signal.signal(signal.SIGTERM, stop_process)
    credentials = wait_for_breeze_credentials(process_stop_event)
    if not credentials:
        return 0

    # Import lazily: the SDK downloads its security master during import. This
    # keeps parser tests offline and turns provider failure into a worker error.
    from breeze_connect import BreezeConnect
    import breeze_connect.breeze_connect as breeze_module

    while True:
        breeze = BreezeConnect(api_key=credentials.api_key)
        try:
            breeze.generate_session(
                api_secret=credentials.api_secret,
                session_token=credentials.session_token,
            )
            break
        except Exception as exc:
            if "session key is expired" not in str(exc).lower():
                raise
            print(
                "[breeze-market] session token expired; update it in Settings. "
                "Waiting for the saved token to change.",
                file=sys.stderr,
                flush=True,
            )
            refreshed = wait_for_credential_change(credentials.fingerprint, process_stop_event)
            if not refreshed:
                return 0
            credentials = refreshed
    exchanges = [value.strip().upper() for value in (env("BREEZE_CASH_EXCHANGES", "NSE,BSE") or "").split(",")]
    exchanges = [value for value in exchanges if value in {"NSE", "BSE"}]
    with psycopg2.connect(database_url()) as conn:
        instruments = load_cash_instruments(conn, breeze_module.zip, exchanges, args.limit)
    print(f"[breeze-market] mapped {len(instruments)} active cash instruments", flush=True)
    if args.dry_run:
        for instrument in instruments[:20]:
            print(f"{instrument.exchange}:{instrument.ticker} -> {instrument.stream_token} ({instrument.breeze_code})")
        return 0
    if not instruments:
        raise SystemExit("No active NSE/BSE assets matched the Breeze security master")

    by_stream_token = {instrument.stream_token.upper(): instrument for instrument in instruments}
    batcher = MarketBatcher(database_url(), args.flush_seconds, args.max_batch)
    stop_event = process_stop_event

    def on_ticks(payload: Any) -> None:
        ticks = payload if isinstance(payload, list) else [payload]
        for tick in ticks:
            if not isinstance(tick, dict):
                continue
            instrument = by_stream_token.get(str(tick.get("symbol") or "").upper())
            if instrument:
                batcher.enqueue(instrument, tick)

    breeze.on_ticks = on_ticks
    breeze.ws_connect()
    print("[breeze-market] websocket connected", flush=True)

    subscribe_sleep = float(env("BREEZE_SUBSCRIBE_SLEEP", "0.1") or "0.1")
    subscription_batch_size = max(1, args.subscription_batch_size)
    subscribed = 0
    for start in range(0, len(instruments), subscription_batch_size):
        batch = instruments[start:start + subscription_batch_size]
        result = breeze.subscribe_feeds(stock_token=[instrument.stream_token for instrument in batch])
        if isinstance(result, str) and result.lower().startswith("exception"):
            labels = f"{batch[0].exchange}:{batch[0].ticker}..{batch[-1].exchange}:{batch[-1].ticker}"
            print(f"[breeze-market] subscription batch failed {labels}: {result}", file=sys.stderr)
        else:
            subscribed += len(batch)
        time.sleep(subscribe_sleep)
    print(f"[breeze-market] subscribed {subscribed}/{len(instruments)} instruments", flush=True)

    last_credential_check = time.monotonic()
    try:
        while not stop_event.wait(5):
            handler = getattr(breeze, "sio_rate_refresh_handler", None)
            socket = getattr(handler, "sio", None)
            if socket is not None and not socket.connected:
                raise ConnectionError("Breeze WebSocket disconnected")
            if time.monotonic() - last_credential_check >= 30:
                current = load_breeze_credentials()
                if current is None or current.fingerprint != credentials.fingerprint:
                    raise ConnectionError("Breeze credentials changed; reconnecting")
                last_credential_check = time.monotonic()
    finally:
        try:
            breeze.ws_disconnect()
        finally:
            batcher.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
