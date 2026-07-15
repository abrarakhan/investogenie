#!/usr/bin/env python3
"""Local BreezeConnect Open Interest daemon.

Runs a live Breeze WebSocket session, subscribes to NSE derivatives in full mode,
and batches real-time Open Interest updates into public.daily_ohlcv.

Required environment:
  BREEZE_API_KEY
  BREEZE_API_SECRET
  BREEZE_SESSION_TOKEN          # daily session token
  DATABASE_URL                  # defaults to local investogenie Postgres

Contract sources, in priority order:
  1. BREEZE_CONTRACTS as semicolon-separated rows:
     LOCAL_TICKER:STOCK_CODE:PRODUCT_TYPE:EXPIRY_DATE:RIGHT:STRIKE

     Example:
     NIFTYFUT:NIFTY:futures:2026-07-30::
     NIFTY26073025000CE:NIFTY:options:2026-07-30:Call:25000

  2. public.derivative_meta rows joined to local assets.

For Breeze, NSE futures/options usually use exchange_code=NFO. Override with
BREEZE_EXCHANGE_CODE if your account/feed expects another value.
"""

from __future__ import annotations

import argparse
import datetime as dt
import inspect
import json
import os
import signal
import sys
import threading
import time
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Iterable
from zoneinfo import ZoneInfo

import psycopg2
from psycopg2.extras import execute_values

try:
    from breeze_connect import BreezeConnect
except ImportError as exc:  # pragma: no cover - local operator setup
    raise SystemExit(
        "breeze-connect is not installed. Run: .venv/bin/pip install -r workers/requirements.txt"
    ) from exc

DEFAULT_DATABASE_URL = "postgresql://localhost:5432/investogenie"
IST = ZoneInfo("Asia/Kolkata")
OI_KEYS = {
    "openinterest",
    "open_interest",
    "oi",
    "totalopeninterest",
    "total_open_interest",
    "opnint",
}
PRICE_KEYS = ("last", "ltp", "last_price", "close", "close_price", "lasttradedprice")
VOLUME_KEYS = ("volume", "total_quantity_traded", "totaltradedquantity", "ttq")


def env(name: str, default: str | None = None) -> str | None:
    value = os.getenv(name)
    return value if value not in (None, "") else default


def resolve_database_url() -> str:
    value = env("DATABASE_URL", DEFAULT_DATABASE_URL) or DEFAULT_DATABASE_URL
    if "localhost:54322" in value or "127.0.0.1:54322" in value:
        return DEFAULT_DATABASE_URL
    return value


def to_int(value: Any) -> int | None:
    if value in (None, "", "--", "-"):
        return None
    try:
        return int(Decimal(str(value).replace(",", "")))
    except Exception:
        return None


def to_float(value: Any) -> float | None:
    if value in (None, "", "--", "-"):
        return None
    try:
        return float(str(value).replace(",", ""))
    except Exception:
        return None


def normalize_key(value: Any) -> str:
    return str(value or "").replace(" ", "").replace("-", "_").lower()


def expiry_for_breeze(value: str | dt.date | None) -> str | None:
    if not value:
        return None
    if isinstance(value, dt.date):
        date = value
    else:
        date = dt.date.fromisoformat(str(value)[:10])
    return f"{date.isoformat()}T06:00:00.000Z"


def today_ist() -> dt.date:
    return dt.datetime.now(IST).date()


@dataclass(frozen=True)
class Contract:
    asset_id: str
    local_ticker: str
    stock_code: str
    product_type: str
    expiry_date: str | None = None
    right: str | None = None
    strike_price: str | None = None
    exchange_code: str = "NFO"

    @property
    def key(self) -> tuple[str, str, str | None, str | None, str | None]:
        return (
            self.stock_code.upper(),
            self.product_type.lower(),
            (self.expiry_date or "")[:10],
            (self.right or "").lower(),
            str(self.strike_price or ""),
        )


class OIBatcher:
    def __init__(self, dsn: str, flush_seconds: float, max_batch: int, min_asset_interval: float):
        self.dsn = dsn
        self.flush_seconds = flush_seconds
        self.max_batch = max_batch
        self.min_asset_interval = min_asset_interval
        self.pending: dict[tuple[str, dt.date], dict[str, Any]] = {}
        self.last_seen: dict[str, float] = {}
        self.lock = threading.Lock()
        self.stop_event = threading.Event()
        self.thread = threading.Thread(target=self._loop, name="oi-flusher", daemon=True)
        self.conn = psycopg2.connect(dsn)
        self.thread.start()

    def enqueue(self, asset_id: str, date: dt.date, oi: int, price: float | None, volume: int | None) -> None:
        now = time.monotonic()
        with self.lock:
            previous = self.last_seen.get(asset_id, 0)
            if now - previous < self.min_asset_interval and (asset_id, date) in self.pending:
                # Keep the latest value in memory, but avoid forcing flush churn.
                pass
            self.last_seen[asset_id] = now
            self.pending[(asset_id, date)] = {
                "asset_id": asset_id,
                "date": date,
                "open_interest": oi,
                "close": price,
                "volume": volume,
            }
            should_flush = len(self.pending) >= self.max_batch
        if should_flush:
            self.flush()

    def flush(self) -> int:
        with self.lock:
            rows = list(self.pending.values())
            self.pending.clear()
        if not rows:
            return 0
        payload = [
            (row["asset_id"], row["date"], row["open_interest"], row["close"], row["volume"])
            for row in rows
        ]
        with self.conn.cursor() as cur:
            execute_values(
                cur,
                """
                insert into public.daily_ohlcv (asset_id, date, open_interest, close, volume)
                values %s
                on conflict (asset_id, date) do update set
                  open_interest = excluded.open_interest,
                  close = coalesce(excluded.close, public.daily_ohlcv.close),
                  volume = coalesce(excluded.volume, public.daily_ohlcv.volume)
                """,
                payload,
                page_size=500,
            )
        self.conn.commit()
        print(f"[breeze-oi] flushed {len(payload)} OI rows")
        return len(payload)

    def _loop(self) -> None:
        while not self.stop_event.wait(self.flush_seconds):
            try:
                self.flush()
            except Exception as exc:
                print(f"[breeze-oi] flush failed: {exc}", file=sys.stderr)
                self.conn.rollback()

    def close(self) -> None:
        self.stop_event.set()
        self.thread.join(timeout=self.flush_seconds + 1)
        self.flush()
        self.conn.close()


def load_contracts_from_env(conn, exchange_code: str) -> list[Contract]:
    raw = env("BREEZE_CONTRACTS")
    if not raw:
        return []
    rows = []
    tickers = []
    for chunk in raw.split(";"):
        if not chunk.strip():
            continue
        parts = [part.strip() for part in chunk.split(":")]
        if len(parts) != 6:
            raise SystemExit(
                "BREEZE_CONTRACTS rows must be LOCAL_TICKER:STOCK_CODE:PRODUCT_TYPE:EXPIRY_DATE:RIGHT:STRIKE"
            )
        local_ticker, stock_code, product_type, expiry, right, strike = parts
        rows.append((local_ticker.upper(), stock_code.upper(), product_type, expiry, right or None, strike or None))
        tickers.append(local_ticker.upper())

    with conn.cursor() as cur:
        cur.execute(
            "select id::text,ticker from public.assets where upper(ticker)=any(%s) and country='IN'",
            (tickers,),
        )
        asset_map = {ticker.upper(): asset_id for asset_id, ticker in cur.fetchall()}

    contracts = []
    for local_ticker, stock_code, product_type, expiry, right, strike in rows:
        asset_id = asset_map.get(local_ticker)
        if not asset_id:
            raise SystemExit(f"No local IN asset found for BREEZE_CONTRACTS ticker {local_ticker}")
        contracts.append(
            Contract(
                asset_id=asset_id,
                local_ticker=local_ticker,
                stock_code=stock_code,
                product_type=product_type,
                expiry_date=expiry_for_breeze(expiry),
                right=right,
                strike_price=strike,
                exchange_code=exchange_code,
            )
        )
    return contracts


def load_contracts_from_db(conn, exchange_code: str, limit: int | None) -> list[Contract]:
    with conn.cursor() as cur:
        cur.execute(
            """
            select a.id::text,
                   a.ticker,
                   coalesce(u.ticker, regexp_replace(a.ticker, '(FUT|CE|PE)$', '')) stock_code,
                   lower(dm.instrument::text) instrument,
                   dm.expiry_date,
                   dm.option_right::text,
                   dm.strike
              from public.derivative_meta dm
              join public.assets a on a.id=dm.asset_id
              left join public.assets u on u.id=dm.underlying_asset_id
             where a.country='IN' and a.exchange='NSE' and a.is_active
             order by dm.expiry_date asc, a.ticker asc
             limit %s
            """,
            (limit,),
        )
        rows = cur.fetchall()
    contracts = []
    for asset_id, ticker, stock_code, instrument, expiry, right, strike in rows:
        product_type = "options" if instrument == "option" else "futures"
        contracts.append(
            Contract(
                asset_id=asset_id,
                local_ticker=ticker,
                stock_code=stock_code,
                product_type=product_type,
                expiry_date=expiry_for_breeze(expiry),
                right={"CALL": "Call", "PUT": "Put"}.get(str(right or "").upper(), right),
                strike_price=None if strike is None else str(strike).rstrip("0").rstrip("."),
                exchange_code=exchange_code,
            )
        )
    return contracts


def extract_tick_items(payload: Any) -> Iterable[dict[str, Any]]:
    if payload is None:
        return []
    if isinstance(payload, dict):
        for key in ("ticks", "data", "quotes"):
            nested = payload.get(key)
            if isinstance(nested, list):
                return [item for item in nested if isinstance(item, dict)]
        return [payload]
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    return []


def find_oi(tick: dict[str, Any]) -> int | None:
    for key, value in tick.items():
        if normalize_key(key) in OI_KEYS:
            parsed = to_int(value)
            if parsed is not None:
                return parsed
        if isinstance(value, dict):
            nested = find_oi(value)
            if nested is not None:
                return nested
    return None


def first_number(tick: dict[str, Any], keys: Iterable[str], want_int: bool = False) -> int | float | None:
    wanted = {normalize_key(key) for key in keys}
    for key, value in tick.items():
        if normalize_key(key) in wanted:
            return to_int(value) if want_int else to_float(value)
    return None


def tick_key(tick: dict[str, Any]) -> tuple[str, str, str | None, str | None, str | None] | None:
    stock = tick.get("stock_code") or tick.get("stockCode") or tick.get("symbol") or tick.get("ticker")
    product = tick.get("product_type") or tick.get("productType") or tick.get("product")
    expiry = tick.get("expiry_date") or tick.get("expiryDate") or tick.get("expiry")
    right = tick.get("right") or tick.get("option_type") or tick.get("optionType")
    strike = tick.get("strike_price") or tick.get("strikePrice") or tick.get("strike")
    if not stock:
        name = tick.get("trading_symbol") or tick.get("tradingSymbol") or tick.get("name")
        if name:
            stock = str(name).split()[0]
    if not stock:
        return None
    product_value = str(product or "").lower()
    if product_value.startswith("future"):
        product_value = "futures"
    elif product_value.startswith("option"):
        product_value = "options"
    return (
        str(stock).upper(),
        product_value,
        str(expiry or "")[:10],
        str(right or "").lower(),
        str(strike or ""),
    )


def build_contract_maps(contracts: list[Contract]) -> tuple[dict[tuple[str, str, str | None, str | None, str | None], Contract], dict[str, Contract]]:
    by_contract = {contract.key: contract for contract in contracts}
    by_ticker = {contract.local_ticker.upper(): contract for contract in contracts}
    for contract in contracts:
        by_ticker.setdefault(contract.stock_code.upper(), contract)
    return by_contract, by_ticker


def resolve_contract(tick: dict[str, Any], by_contract: dict, by_ticker: dict[str, Contract]) -> Contract | None:
    key = tick_key(tick)
    if key and key in by_contract:
        return by_contract[key]
    for field in ("local_ticker", "ticker", "symbol", "stock_code", "stockCode", "trading_symbol", "tradingSymbol"):
        value = tick.get(field)
        if value:
            match = by_ticker.get(str(value).upper())
            if match:
                return match
    return None


def subscribe_contract(breeze: Any, contract: Contract, mode_full: str) -> None:
    kwargs = {
        "exchange_code": contract.exchange_code,
        "stock_code": contract.stock_code,
        "product_type": contract.product_type,
        "expiry_date": contract.expiry_date,
        "right": contract.right,
        "strike_price": contract.strike_price,
        "get_exchange_quotes": True,
        "get_market_depth": True,
        "mode": mode_full,
    }
    kwargs = {key: value for key, value in kwargs.items() if value not in (None, "")}

    # BreezeConnect versions differ. Filter kwargs when the SDK exposes a concrete signature.
    signature = inspect.signature(breeze.subscribe_feeds)
    if not any(param.kind == inspect.Parameter.VAR_KEYWORD for param in signature.parameters.values()):
        allowed = set(signature.parameters)
        kwargs = {key: value for key, value in kwargs.items() if key in allowed}

    breeze.subscribe_feeds(**kwargs)
    print(
        "[breeze-oi] subscribed "
        f"{contract.local_ticker} ({contract.exchange_code}/{contract.stock_code}/{contract.product_type})"
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run local Breeze OI WebSocket daemon")
    parser.add_argument("--limit", type=int, default=int(env("BREEZE_SUBSCRIBE_LIMIT", "250") or "250"))
    parser.add_argument("--flush-seconds", type=float, default=float(env("BREEZE_DB_FLUSH_SECONDS", "2.0") or "2.0"))
    parser.add_argument("--max-batch", type=int, default=int(env("BREEZE_DB_MAX_BATCH", "250") or "250"))
    parser.add_argument("--min-asset-interval", type=float, default=float(env("BREEZE_DB_MIN_ASSET_INTERVAL", "3.0") or "3.0"))
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    api_key = env("BREEZE_API_KEY")
    api_secret = env("BREEZE_API_SECRET")
    session_token = env("BREEZE_SESSION_TOKEN")
    if not api_key or not api_secret or not session_token:
        raise SystemExit("Set BREEZE_API_KEY, BREEZE_API_SECRET, and BREEZE_SESSION_TOKEN before starting the daemon")

    exchange_code = env("BREEZE_EXCHANGE_CODE", "NFO") or "NFO"
    mode_full = env("BREEZE_MODE_FULL", "MODE_FULL") or "MODE_FULL"

    conn = psycopg2.connect(resolve_database_url())
    try:
        contracts = load_contracts_from_env(conn, exchange_code) or load_contracts_from_db(conn, exchange_code, args.limit)
    finally:
        conn.close()

    if not contracts:
        raise SystemExit(
            "No derivative contracts found. Add derivative_meta rows or set BREEZE_CONTRACTS, "
            "for example: NIFTYFUT:NIFTY:futures:2026-07-30::"
        )

    by_contract, by_ticker = build_contract_maps(contracts)
    print(f"[breeze-oi] loaded {len(contracts)} NSE derivative contracts")
    if args.dry_run:
        print(json.dumps([contract.__dict__ for contract in contracts[:10]], indent=2, default=str))
        return 0

    batcher = OIBatcher(resolve_database_url(), args.flush_seconds, args.max_batch, args.min_asset_interval)
    stop_event = threading.Event()

    def on_ticks(ticks: Any) -> None:
        for tick in extract_tick_items(ticks):
            oi = find_oi(tick)
            if oi is None:
                continue
            contract = resolve_contract(tick, by_contract, by_ticker)
            if not contract:
                print(f"[breeze-oi] unmapped OI tick: {tick}")
                continue
            price = first_number(tick, PRICE_KEYS)
            volume = first_number(tick, VOLUME_KEYS, want_int=True)
            batcher.enqueue(contract.asset_id, today_ist(), oi, price, volume)  # intraday OI updates today's bar

    breeze = BreezeConnect(api_key=api_key)
    breeze.generate_session(api_secret=api_secret, session_token=session_token)
    breeze.on_ticks = on_ticks
    breeze.ws_connect()
    print("[breeze-oi] websocket connected")

    for contract in contracts:
        try:
            subscribe_contract(breeze, contract, mode_full)
            time.sleep(float(env("BREEZE_SUBSCRIBE_SLEEP", "0.15") or "0.15"))
        except Exception as exc:
            print(f"[breeze-oi] subscription failed for {contract.local_ticker}: {exc}", file=sys.stderr)

    def stop(signum: int, _frame: Any) -> None:
        print(f"[breeze-oi] stopping on signal {signum}")
        stop_event.set()

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)

    try:
        while not stop_event.wait(1):
            pass
    finally:
        try:
            disconnect = getattr(breeze, "ws_disconnect", None)
            if callable(disconnect):
                disconnect()
        finally:
            batcher.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
