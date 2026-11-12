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
import json
import os
import signal
import sys
import threading
import time
import urllib.request
from dataclasses import dataclass
from decimal import Decimal
from typing import Any
from zipfile import ZipFile

import psycopg2
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from psycopg2.extras import execute_values

IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
EQUITY_SERIES = {"EQ", "BE", "BZ", "SM", "ST", "SZ", "DR"}
NSE_HOLIDAY_URL = "https://www.nseindia.com/api/holiday-master?type=trading"
INDIA_MARKET_OPEN = dt.time(9, 15)
INDIA_MARKET_CLOSE = dt.time(15, 30)
INDIA_MARKET_HOLIDAYS = {
    dt.date.fromisoformat(value)
    for value in (
        "2026-01-15", "2026-01-26", "2026-03-03", "2026-03-26",
        "2026-03-31", "2026-04-03", "2026-04-14", "2026-05-01",
        "2026-05-28", "2026-06-26", "2026-09-14", "2026-10-02",
        "2026-10-20", "2026-11-10", "2026-11-24", "2026-12-25",
    )
}


def load_india_special_sessions() -> dict[dt.date, tuple[dt.time, dt.time]]:
    path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "config", "market-special-sessions.json",
    )
    try:
        with open(path, encoding="utf-8") as source:
            rows = json.load(source).get("IN", {})
        return {
            dt.date.fromisoformat(date_value): (
                dt.time(int(values["openMinutes"]) // 60, int(values["openMinutes"]) % 60),
                dt.time(int(values["closeMinutes"]) // 60, int(values["closeMinutes"]) % 60),
            )
            for date_value, values in rows.items()
        }
    except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError):
        return {}


INDIA_SPECIAL_SESSIONS = load_india_special_sessions()


def india_market_bounds(date_value: dt.date) -> tuple[dt.time, dt.time] | None:
    special = INDIA_SPECIAL_SESSIONS.get(date_value)
    if special:
        return special
    if date_value.weekday() >= 5 or date_value in INDIA_MARKET_HOLIDAYS:
        return None
    return INDIA_MARKET_OPEN, INDIA_MARKET_CLOSE


def load_runtime_market_holidays() -> bool:
    default_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".runtime-india-market-holidays.json")
    path = env("MARKET_CALENDAR_FILE", default_path)
    try:
        with open(path, encoding="utf-8") as snapshot:
            payload = json.load(snapshot)
        dates = payload.get("holidays", []) if payload.get("market") == "IN" else []
        for value in dates:
            INDIA_MARKET_HOLIDAYS.add(dt.date.fromisoformat(str(value)))
        return bool(dates)
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return False


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
                   -- Canonical shared quotes come only from the designated
                   -- system owner's Breeze session (users.is_system_owner),
                   -- never an ordinary user's or another admin's account.
                   and u.is_system_owner
                """,
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


def circuit_limits(tick: dict[str, Any]) -> tuple[float | None, float | None]:
    """The session's lower and upper price bands from a Breeze tick.

    The SDK spells the keys lowerCktLm/upperCktLm. A missing or non-positive
    value means the band is unknown, never a real limit of zero.
    """
    def read(*keys: str) -> float | None:
        for key in keys:
            value = number(tick.get(key))
            if value is not None and value > 0:
                return value
        return None
    return (read("lowerCktLm", "lowerCktLM", "lower_circuit"),
            read("upperCktLm", "upperCktLM", "upper_circuit"))


def order_flow(tick: dict[str, Any]) -> tuple[float | None, float | None, float | None]:
    """Session VWAP and total resting buy and sell quantity from a Breeze tick."""
    def positive(*keys: str) -> float | None:
        for key in keys:
            value = number(tick.get(key))
            if value is not None and value > 0:
                return value
        return None
    return (positive("avgPrice", "average_price"), positive("totalBuyQt", "total_buy_quantity"),
            positive("totalSellQ", "total_sell_quantity"))


def integer(value: Any) -> int | None:
    parsed = number(value)
    return int(parsed) if parsed is not None else None


def valid_ohlc(price: float, open_value: Any, high_value: Any, low_value: Any) -> tuple[float, float, float]:
    """Return a positive, internally consistent live candle.

    Breeze may send zero for an unavailable session low/high. Persisting that
    sentinel as a real price corrupts ATR and every pattern detector that reads
    daily_ohlcv, so missing fields fall back to the observed trade price.
    """
    open_price = number(open_value)
    high = number(high_value)
    low = number(low_value)
    open_price = open_price if open_price is not None and open_price > 0 else price
    high = high if high is not None and high > 0 else max(open_price, price)
    low = low if low is not None and low > 0 else min(open_price, price)
    return open_price, max(high, open_price, price), min(low, open_price, price)


def refresh_india_market_holidays() -> bool:
    """Merge the official NSE capital-market calendar into the fail-safe set."""
    loaded_snapshot = load_runtime_market_holidays()
    request = urllib.request.Request(
        NSE_HOLIDAY_URL,
        headers={"Accept": "application/json", "User-Agent": "InvestoGenie/1.0 market-calendar"},
    )
    try:
        with urllib.request.urlopen(request, timeout=4) as response:
            payload = json.load(response)
        added = 0
        for holiday in payload.get("CM", []):
            value = str(holiday.get("tradingDate", ""))
            try:
                INDIA_MARKET_HOLIDAYS.add(dt.datetime.strptime(value, "%d-%b-%Y").date())
                added += 1
            except ValueError:
                continue
        return added > 0 or loaded_snapshot
    except Exception as exc:
        print(f"[breeze-market] official holiday refresh unavailable: {exc}; using bundled calendar", file=sys.stderr, flush=True)
        return loaded_snapshot


def is_india_market_session(timestamp: dt.datetime, now: dt.datetime | None = None) -> bool:
    """Accept only a live tick from the currently open Indian cash session."""
    tick_time = timestamp.astimezone(IST)
    current = (now or dt.datetime.now(IST)).astimezone(IST)
    bounds = india_market_bounds(current.date())
    if bounds is None:
        return False
    market_open, market_close = bounds
    return (
        tick_time.date() == current.date()
        and market_open <= tick_time.time().replace(tzinfo=None) <= market_close
        and market_open <= current.time().replace(tzinfo=None) <= market_close
    )


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
               ) or exists(
                 select 1 from public.forward_test_positions f where f.asset_id=a.id and f.status='OPEN'
               ) then 0 when exists(
                 select 1 from public.live_market_targets t
                  where t.asset_id=a.id and t.last_seen_at >= now() - interval '1 day'
               ) then 1 when exists(
                 select 1 from public.swing_signals s
                  where s.asset_id=a.id and s.verdict <> 'NO_SETUP'
               ) then 2 when exists(
                 select 1 from public.universe_members u where u.asset_id=a.id and u.universe='NIFTY_500'
               ) then 3 else 4 end,
               -- More stocks are flagged in a day than the feed can carry. Keep the ones
               -- a scan is flagging now ahead of ones it flagged earlier and dropped;
               -- alphabetical order used to decide which candidates lost their live price.
               case when exists(
                 select 1 from public.live_market_targets t
                  where t.asset_id=a.id and t.last_seen_at >= now() - interval '15 minutes'
               ) then 0 else 1 end,
               a.exchange,a.ticker
            """,
            (exchanges,),
        )
        assets = cur.fetchall()

    instruments: list[CashInstrument] = []
    seen_contracts: set[tuple[str, str]] = set()
    for asset_id, ticker, exchange in assets:
        match = masters[exchange].get(str(ticker).upper())
        if not match:
            continue
        breeze_code, token, company_name = match
        contract = (exchange, breeze_code)
        # Duplicate asset rows can resolve to the same Breeze cash contract.
        # Subscribe once and retain the mapping that already owns that contract.
        if contract in seen_contracts:
            continue
        seen_contracts.add(contract)
        instruments.append(CashInstrument(asset_id, ticker, exchange, breeze_code, token, company_name))
        if limit > 0 and len(instruments) >= limit:
            break
    if instruments:
        mappings = [
            (item.asset_id, item.exchange, item.breeze_code, item.token, dt.datetime.now(dt.timezone.utc))
            for item in instruments
        ]
        with conn.cursor() as cur:
            # An asset can be renamed or move between Breeze master entries. A
            # single INSERT cannot resolve both the asset PK and contract
            # unique key when the old mapping occupies the other constraint.
            # Clear only the exact incoming asset/contract keys, then replace
            # them atomically with the current security-master ownership.
            execute_values(
                cur,
                """
                delete from public.breeze_instrument_map existing
                 using (values %s) as incoming(asset_id,exchange_code,stock_code)
                 where existing.asset_id=incoming.asset_id::uuid
                    or (existing.exchange_code,existing.stock_code)=(incoming.exchange_code,incoming.stock_code)
                """,
                [(asset_id, exchange, stock_code) for asset_id, exchange, stock_code, _token, _updated_at in mappings],
                page_size=500,
            )
            execute_values(
                cur,
                """
                insert into public.breeze_instrument_map
                  (asset_id,exchange_code,stock_code,token,updated_at)
                values %s
                on conflict (asset_id) do update set
                  exchange_code=excluded.exchange_code,
                  stock_code=excluded.stock_code,
                  token=excluded.token,
                  updated_at=excluded.updated_at
                """,
                mappings,
                page_size=500,
            )
        conn.commit()
    return instruments


def parse_tick_time(value: Any) -> dt.datetime | None:
    """When the exchange last traded the stock, in IST.

    The SDK formats the feed's epoch time in the server's own time zone, so that
    form is read as local time and converted; the other form is already IST. A
    time that is present but unreadable returns None: stamping it "now" would
    pass an old price off as live. Only a tick with no time at all is stamped now.
    """
    if not value:
        return dt.datetime.now(IST)
    text = str(value)
    try:
        return dt.datetime.strptime(text, "%a %b %d %H:%M:%S %Y").astimezone(IST)
    except ValueError:
        pass
    try:
        return dt.datetime.strptime(text, "%Y-%m-%d %H:%M:%S").replace(tzinfo=IST)
    except ValueError:
        return None


class MinuteBarBuilder:
    """Fold live ticks into one-minute candles without any extra broker calls.

    A tick carries the last traded price and the session's cumulative volume, so a
    bar's volume is the rise in that total across the minute. The volume is left
    unknown when the total before the bar was never seen (the worker started
    mid-session); the after-close sync replaces these provisional bars anyway.
    Not thread-safe: the caller holds its own lock.
    """

    def __init__(self) -> None:
        self.current: dict[str, dict[str, Any]] = {}
        self.last_total: dict[str, tuple[dt.date, int]] = {}
        self.completed: list[tuple] = []

    def _finish(self, asset_id: str, bar: dict[str, Any]) -> None:
        volume = None
        if bar["base"] is not None and bar["total"] is not None:
            volume = max(0, bar["total"] - bar["base"])
        if bar["total"] is not None:
            self.last_total[asset_id] = (bar["minute"].date(), bar["total"])
        self.completed.append((asset_id, bar["minute"], bar["open"], bar["high"], bar["low"], bar["close"], volume))

    def add(self, asset_id: str, timestamp: dt.datetime, price: float, total_volume: int | None) -> None:
        minute = timestamp.astimezone(IST).replace(second=0, microsecond=0)
        bar = self.current.get(asset_id)
        if bar is not None and minute < bar["minute"]:
            return  # a late tick for a minute that has already moved on
        if bar is not None and minute == bar["minute"]:
            bar["high"] = max(bar["high"], price)
            bar["low"] = min(bar["low"], price)
            bar["close"] = price
            if total_volume is not None:
                bar["total"] = total_volume if bar["total"] is None else max(bar["total"], total_volume)
            return
        if bar is not None:
            self._finish(asset_id, bar)
        known = self.last_total.get(asset_id)
        if known is not None and known[0] == minute.date():
            base: int | None = known[1]
        else:
            bounds = india_market_bounds(minute.date())
            # Everything traded before the opening minute ends belongs to the opening bar.
            base = 0 if bounds is not None and minute.time().replace(tzinfo=None) <= bounds[0] else None
        self.current[asset_id] = {
            "minute": minute, "open": price, "high": price, "low": price, "close": price,
            "base": base, "total": total_volume,
        }

    def drain(self, now: dt.datetime | None = None) -> list[tuple]:
        """Completed bars; with `now`, also bars whose minute is over. Without it, everything."""
        cutoff = None if now is None else now.astimezone(IST).replace(second=0, microsecond=0)
        for asset_id in [key for key, bar in self.current.items() if cutoff is None or bar["minute"] < cutoff]:
            self._finish(asset_id, self.current.pop(asset_id))
        done, self.completed = self.completed, []
        return done


def merge_minute_bars(bars: list[tuple]) -> list[tuple]:
    """One row per stock and minute, so a single statement never updates a row twice."""
    merged: dict[tuple, list] = {}
    for asset_id, minute, open_price, high, low, close, volume in bars:
        row = merged.get((asset_id, minute))
        if row is None:
            merged[(asset_id, minute)] = [asset_id, minute, open_price, high, low, close, volume]
            continue
        row[3] = max(row[3], high)
        row[4] = min(row[4], low)
        row[5] = close
        if volume is not None:
            row[6] = volume if row[6] is None else row[6] + volume
    return [tuple(row) for row in merged.values()]


class MarketBatcher:
    def __init__(self, dsn: str, flush_seconds: float, max_batch: int):
        self.flush_seconds = flush_seconds
        self.max_batch = max_batch
        self.pending: dict[str, dict[str, Any]] = {}
        self.lock = threading.Lock()
        self.flush_lock = threading.Lock()
        self.stop_event = threading.Event()
        self.wake = threading.Event()
        self.last_tick_at = time.monotonic()
        self.unreadable_times = 0
        self.minute_bars = None if env("BREEZE_MINUTE_BARS_DISABLED") == "1" else MinuteBarBuilder()
        self.pending_bars: list[tuple] = []
        self.bar_failures = 0
        self.conn = psycopg2.connect(dsn)
        self.thread = threading.Thread(target=self._loop, name="breeze-db-flusher", daemon=True)
        self.thread.start()

    def enqueue(self, instrument: CashInstrument, tick: dict[str, Any]) -> None:
        self.last_tick_at = time.monotonic()
        price = number(tick.get("last") or tick.get("ltp") or tick.get("close"))
        if price is None or price <= 0:
            return
        timestamp = parse_tick_time(tick.get("ltt") or tick.get("datetime"))
        if timestamp is None:
            self.unreadable_times += 1
            if self.unreadable_times in (1, 100, 10_000):
                print(f"[breeze-market] dropped a tick with an unreadable time ({self.unreadable_times} so far): "
                      f"{tick.get('ltt') or tick.get('datetime')!r}", file=sys.stderr, flush=True)
            return
        if not is_india_market_session(timestamp):
            return
        open_price, high, low = valid_ohlc(price, tick.get("open"), tick.get("high"), tick.get("low"))
        row = {
            "asset_id": instrument.asset_id,
            "ticker": instrument.ticker,
            "exchange": instrument.exchange,
            "timestamp": timestamp,
            "date": timestamp.date(),
            "price": price,
            "change_pct": number(tick.get("change")),
            "open": open_price,
            "high": high,
            "low": low,
            "volume": integer(tick.get("ttq") or tick.get("volume") or tick.get("total_quantity_traded")),
            "bid": number(tick.get("bPrice") or tick.get("best_bid_price")),
            "ask": number(tick.get("sPrice") or tick.get("best_offer_price")),
            "bid_qty": integer(tick.get("bQty") or tick.get("best_bid_quantity")),
            "ask_qty": integer(tick.get("sQty") or tick.get("best_offer_quantity")),
            **dict(zip(("lower_circuit", "upper_circuit"), circuit_limits(tick))),
            **dict(zip(("vwap", "buy_total", "sell_total"), order_flow(tick))),
        }
        with self.lock:
            self.pending[instrument.asset_id] = row
            if self.minute_bars is not None:
                self.minute_bars.add(instrument.asset_id, timestamp, price, row["volume"])
            should_flush = len(self.pending) >= self.max_batch
        if should_flush:
            # Never write from here. The socket client runs every message on its own
            # thread; if those threads queue behind a slow database write they pile up
            # until the service hits its task limit and the feed's reader dies.
            self.wake.set()

    def flush(self) -> int:
        with self.flush_lock:
            return self._flush_locked()

    def _flush_locked(self) -> int:
        with self.lock:
            rows = list(self.pending.values())
            self.pending.clear()
        if not rows:
            self._flush_minute_bars()
            return 0
        try:
            with self.conn.cursor() as cur:
                execute_values(
                    cur,
                    """
                    insert into public.latest_quotes
                      (asset_id,price,change_pct,currency,as_of,source,updated_at,best_bid,best_ask,bid_quantity,ask_quantity,lower_circuit,upper_circuit,
                       vwap,total_buy_quantity,total_sell_quantity)
                    values %s
                    on conflict (asset_id) do update set
                      price=excluded.price,change_pct=excluded.change_pct,
                      currency=excluded.currency,as_of=excluded.as_of,
                      source=excluded.source,updated_at=excluded.updated_at,
                      best_bid=excluded.best_bid,best_ask=excluded.best_ask,
                      bid_quantity=excluded.bid_quantity,ask_quantity=excluded.ask_quantity,
                      lower_circuit=case
                        when excluded.lower_circuit is not null then excluded.lower_circuit
                        when public.latest_quotes.as_of::date=excluded.as_of::date then public.latest_quotes.lower_circuit
                        else null end,
                      upper_circuit=case
                        when excluded.upper_circuit is not null then excluded.upper_circuit
                        when public.latest_quotes.as_of::date=excluded.as_of::date then public.latest_quotes.upper_circuit
                        else null end,
                      vwap=excluded.vwap,
                      total_buy_quantity=excluded.total_buy_quantity,
                      total_sell_quantity=excluded.total_sell_quantity
                    where public.latest_quotes.as_of is null or public.latest_quotes.as_of <= excluded.as_of
                    """,
                    [(r["asset_id"], r["price"], r["change_pct"], "INR", r["timestamp"], "BREEZE_LIVE", dt.datetime.now(dt.timezone.utc),r["bid"],r["ask"],r["bid_qty"],r["ask_qty"],r["lower_circuit"],r["upper_circuit"],
                      r["vwap"],r["buy_total"],r["sell_total"]) for r in rows],
                    page_size=500,
                )
                execute_values(
                    cur,
                    """
                    insert into public.daily_ohlcv
                      (asset_id,date,open,high,low,close,volume,source)
                    values %s
                    on conflict (asset_id,date) do update set
                      open=case when public.daily_ohlcv.open is null or public.daily_ohlcv.open <= 0 then excluded.open else public.daily_ohlcv.open end,
                      high=case when public.daily_ohlcv.high is null or public.daily_ohlcv.high <= 0 then excluded.high else greatest(public.daily_ohlcv.high,excluded.high) end,
                      low=case when public.daily_ohlcv.low is null or public.daily_ohlcv.low <= 0 then excluded.low else least(public.daily_ohlcv.low,excluded.low) end,
                      close=excluded.close,
                      volume=case when excluded.volume is null then public.daily_ohlcv.volume when public.daily_ohlcv.volume is null then excluded.volume else greatest(public.daily_ohlcv.volume,excluded.volume) end,
                      source=excluded.source
                    """,
                    [(r["asset_id"], r["date"], r["open"], r["high"], r["low"], r["price"], r["volume"], "BREEZE_LIVE") for r in rows],
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
        self._flush_minute_bars()
        return len(rows)

    def _flush_minute_bars(self, final: bool = False) -> int:
        """Store finished one-minute bars in their own transaction: a failure here
        must never cost a quote write."""
        if self.minute_bars is None:
            return 0
        with self.lock:
            fresh = self.minute_bars.drain(None if final else dt.datetime.now(IST))
        bars = merge_minute_bars(self.pending_bars + fresh)
        self.pending_bars = []
        if not bars:
            return 0
        try:
            with self.conn.cursor() as cur:
                execute_values(
                    cur,
                    """
                    insert into public.intraday_bars
                      (asset_id,bar_time,open,high,low,close,volume,source)
                    values %s
                    on conflict (asset_id,bar_time) do update set
                      high=greatest(public.intraday_bars.high,excluded.high),
                      low=least(public.intraday_bars.low,excluded.low),
                      close=excluded.close,
                      volume=case when excluded.volume is null then public.intraday_bars.volume
                                  else coalesce(public.intraday_bars.volume,0)+excluded.volume end
                    where public.intraday_bars.source <> 'BREEZE_HISTORICAL'
                    """,
                    [(*bar, "BREEZE_LIVE_TICKS") for bar in bars],
                    page_size=500,
                )
            self.conn.commit()
            self.bar_failures = 0
        except Exception as exc:
            self.conn.rollback()
            self.bar_failures += 1
            if len(bars) < 50_000:
                self.pending_bars = bars  # retried with the next flush
            if self.bar_failures in (1, 20, 500):
                print(f"[breeze-market] one-minute bar write failed ({self.bar_failures} in a row): {exc}",
                      file=sys.stderr, flush=True)
            return 0
        return len(bars)

    def _loop(self) -> None:
        while not self.stop_event.is_set():
            self.wake.wait(self.flush_seconds)
            self.wake.clear()
            if self.stop_event.is_set():
                break
            try:
                self.flush()
            except Exception as exc:
                print(f"[breeze-market] database flush failed: {exc}", file=sys.stderr, flush=True)

    def close(self) -> None:
        self.stop_event.set()
        self.wake.set()
        self.thread.join(timeout=self.flush_seconds + 2)
        self.flush()
        with self.flush_lock:
            self._flush_minute_bars(final=True)
        self.conn.close()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Stream Breeze NSE/BSE cash quotes into Postgres")
    parser.add_argument("--limit", type=int, default=int(env("BREEZE_CASH_LIMIT", "750") or "750"))
    parser.add_argument("--flush-seconds", type=float, default=float(env("BREEZE_DB_FLUSH_SECONDS", "3") or "3"))
    parser.add_argument("--max-batch", type=int, default=int(env("BREEZE_DB_MAX_BATCH", "500") or "500"))
    parser.add_argument("--subscription-batch-size", type=int, default=int(env("BREEZE_SUBSCRIBE_BATCH_SIZE", "100") or "100"))
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def feed_stalled(seconds_since_tick: float, connected: bool, market_open: bool, limit: float) -> bool:
    """A connected socket that delivers nothing during the session has died quietly.

    The socket client can lose its reader thread while still reporting
    "connected", so the drop detection never fires and prices simply stop.
    """
    return connected and market_open and seconds_since_tick >= limit


class ReconnectWatch:
    """Tracks WebSocket drops so the client's own reconnect gets a chance.

    python-socketio reconnects automatically (1-5 s back-off) and the Breeze SDK
    re-joins every subscribed token on reconnect. Exiting on the first missed
    5-second check threw that away and forced a full restart, which re-downloads
    SecurityMaster.zip. Only give up after `grace_seconds` without a connection.
    """

    # A drop the client is not retrying (server-side disconnect) is given up on quickly.
    NOT_RETRYING_SECONDS = 10.0

    def __init__(self, grace_seconds: float):
        self.grace_seconds = grace_seconds
        self.down_since: float | None = None

    def observe(self, connected: bool, now: float, reconnecting: bool = True) -> str | None:
        if connected:
            if self.down_since is None:
                return None
            self.down_since = None
            return "recovered"
        if self.down_since is None:
            self.down_since = now
            return "dropped"
        down_for = now - self.down_since
        if down_for >= self.grace_seconds or (not reconnecting and down_for >= self.NOT_RETRYING_SECONDS):
            return "expired"
        return None

    def downtime(self, now: float) -> float:
        return 0.0 if self.down_since is None else now - self.down_since


def safe_ws_disconnect(breeze: Any) -> None:
    """The SDK's ws_disconnect emits on the socket and raises if it already dropped."""
    try:
        breeze.ws_disconnect()
    except Exception as exc:
        print(f"[breeze-market] websocket cleanup skipped: {exc}", file=sys.stderr, flush=True)


def import_breeze_sdk(stop_event: threading.Event, attempts: int = 3, wait_seconds: float = 30.0, timeout_seconds: float = 60.0):
    """Import the SDK, which downloads SecurityMaster.zip at import time.

    The download has no timeout of its own, so a stalled ICICI server held the
    worker until the kernel gave up (~2 min) and then crashed it. Bound each try
    and retry a few times before failing.
    """
    import importlib
    import socket as socket_module

    for attempt in range(1, attempts + 1):
        previous = socket_module.getdefaulttimeout()
        socket_module.setdefaulttimeout(timeout_seconds)
        try:
            module = importlib.import_module("breeze_connect.breeze_connect")
            return module.BreezeConnect, module
        except Exception as exc:
            for name in ("breeze_connect.breeze_connect", "breeze_connect"):
                sys.modules.pop(name, None)
            if attempt == attempts:
                raise
            print(
                f"[breeze-market] SecurityMaster download failed (attempt {attempt}/{attempts}): {exc}; retrying in {wait_seconds:.0f} s",
                file=sys.stderr,
                flush=True,
            )
            if stop_event.wait(wait_seconds):
                raise SystemExit(0)
        finally:
            socket_module.setdefaulttimeout(previous)
    raise RuntimeError("unreachable")


def main() -> int:
    args = parse_args()
    process_stop_event = threading.Event()

    def stop_process(signum: int, _frame: Any) -> None:
        print(f"[breeze-market] stopping on signal {signum}", flush=True)
        process_stop_event.set()

    signal.signal(signal.SIGINT, stop_process)
    signal.signal(signal.SIGTERM, stop_process)
    refreshed_calendar = refresh_india_market_holidays()
    print(
        f"[breeze-market] NSE holiday calendar {'refreshed' if refreshed_calendar else 'using bundled fallback'}",
        flush=True,
    )
    credentials = wait_for_breeze_credentials(process_stop_event)
    if not credentials:
        return 0

    # Import lazily: the SDK downloads its security master during import. This
    # keeps parser tests offline and turns provider failure into a worker error.
    BreezeConnect, breeze_module = import_breeze_sdk(process_stop_event)

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
    last_calendar_refresh = time.monotonic()
    last_target_refresh = time.monotonic()
    target_refresh_seconds = max(60.0, float(env("BREEZE_TARGET_REFRESH_SECONDS", "120") or "120"))
    stall_seconds = max(60.0, float(env("BREEZE_FEED_STALL_SECONDS", "180") or "180"))
    batcher.last_tick_at = time.monotonic()
    session_open = False
    reconnect = ReconnectWatch(max(10.0, float(env("BREEZE_RECONNECT_GRACE_SECONDS", "90") or "90")))
    try:
        while not stop_event.wait(5):
            handler = getattr(breeze, "sio_rate_refresh_handler", None)
            socket = getattr(handler, "sio", None)
            if socket is not None:
                now = time.monotonic()
                downtime = reconnect.downtime(now)
                # python-socketio holds a background task while it is retrying.
                event = reconnect.observe(bool(socket.connected), now, getattr(socket, "_reconnect_task", None) is not None)
                if event == "dropped":
                    print("[breeze-market] websocket dropped; waiting for automatic reconnect", file=sys.stderr, flush=True)
                elif event == "recovered":
                    print(f"[breeze-market] websocket reconnected after {downtime:.0f} s", flush=True)
                elif event == "expired":
                    raise ConnectionError(f"Breeze WebSocket disconnected for {downtime:.0f} s; restarting")
                if reconnect.down_since is not None:
                    batcher.last_tick_at = now  # the silence is explained; restart the stall clock on recovery
                    continue
                if event == "recovered":
                    batcher.last_tick_at = now
                current_ist = dt.datetime.now(IST)
                market_open = is_india_market_session(current_ist, current_ist)
                if market_open and not session_open:
                    batcher.last_tick_at = now  # silence before the open is not a stall
                session_open = market_open
                silent_for = now - batcher.last_tick_at
                if feed_stalled(silent_for, bool(socket.connected), market_open, stall_seconds):
                    raise ConnectionError(f"Breeze feed delivered no ticks for {silent_for:.0f} s while connected; restarting")
            if time.monotonic() - last_credential_check >= 30:
                current = load_breeze_credentials()
                if current is None or current.fingerprint != credentials.fingerprint:
                    raise ConnectionError("Breeze credentials changed; reconnecting")
                last_credential_check = time.monotonic()
            if time.monotonic() - last_calendar_refresh >= 6 * 60 * 60:
                refresh_india_market_holidays()
                last_calendar_refresh = time.monotonic()
            if time.monotonic() - last_target_refresh >= target_refresh_seconds:
                # Candidate scans continuously refresh live_market_targets. Reconcile the
                # bounded WebSocket subscription set so a newly discovered near-breakout
                # stock receives authoritative intraday OHLCV without a service restart.
                try:
                    with psycopg2.connect(database_url()) as conn:
                        refreshed = load_cash_instruments(conn, breeze_module.zip, exchanges, args.limit)
                    previous_tokens = set(by_stream_token)
                    refreshed_by_token = {item.stream_token.upper(): item for item in refreshed}
                    refreshed_tokens = set(refreshed_by_token)
                    removed = sorted(previous_tokens - refreshed_tokens)
                    added = sorted(refreshed_tokens - previous_tokens)
                    for start in range(0, len(removed), subscription_batch_size):
                        breeze.unsubscribe_feeds(stock_token=removed[start:start + subscription_batch_size])
                        time.sleep(subscribe_sleep)
                    accepted = 0
                    failed_additions: set[str] = set()
                    for start in range(0, len(added), subscription_batch_size):
                        batch = added[start:start + subscription_batch_size]
                        result = breeze.subscribe_feeds(stock_token=batch)
                        if not (isinstance(result, str) and result.lower().startswith("exception")):
                            accepted += len(batch)
                        else:
                            failed_additions.update(batch)
                            print(f"[breeze-market] dynamic subscription failed: {result}", file=sys.stderr, flush=True)
                        time.sleep(subscribe_sleep)
                    # Excluding rejected additions makes the next refresh retry them.
                    by_stream_token = {
                        token: instrument for token, instrument in refreshed_by_token.items()
                        if token not in failed_additions
                    }
                    if added or removed:
                        print(
                            f"[breeze-market] refreshed targets: +{accepted}/-{len(removed)}; "
                            f"tracking {len(by_stream_token)} instruments",
                            flush=True,
                        )
                except Exception as exc:
                    print(f"[breeze-market] target refresh failed: {exc}", file=sys.stderr, flush=True)
                last_target_refresh = time.monotonic()
    finally:
        try:
            safe_ws_disconnect(breeze)
        finally:
            batcher.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
