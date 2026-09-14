#!/usr/bin/env python3
"""Top up recent India daily candles from Breeze before exchange fallbacks run."""

from __future__ import annotations

import argparse
import datetime as dt
import os
import sys
import time
from pathlib import Path
from typing import Any

import psycopg2
from psycopg2.extras import execute_values

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "workers"))

from breeze_market_daemon import (  # noqa: E402
    database_url,
    load_breeze_credentials,
    load_cash_instruments,
    number,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--days", type=int, default=int(os.getenv("BREEZE_HISTORY_DAYS", "10")))
    parser.add_argument("--limit", type=int, default=int(os.getenv("BREEZE_HISTORY_LIMIT", "750")))
    parser.add_argument("--sleep", type=float, default=float(os.getenv("BREEZE_HISTORY_SLEEP_SECONDS", "0.2")))
    return parser.parse_args()


def iso_timestamp(day: dt.date, end: bool = False) -> str:
    clock = "23:59:59.000" if end else "00:00:00.000"
    return f"{day.isoformat()}T{clock}Z"


def parse_day(value: Any) -> dt.date | None:
    if not value:
        return None
    text = str(value).strip().replace("T", " ").split(" ", 1)[0]
    try:
        return dt.date.fromisoformat(text)
    except ValueError:
        return None


def candle(row: dict[str, Any], asset_id: str) -> tuple | None:
    day = parse_day(row.get("datetime") or row.get("date"))
    close = number(row.get("close"))
    if day is None or close is None or close <= 0:
        return None
    open_price = number(row.get("open")) or close
    high = number(row.get("high")) or close
    low = number(row.get("low")) or close
    volume = number(row.get("volume"))
    return asset_id, day, open_price, high, low, close, max(0, int(volume or 0)), "BREEZE_HISTORICAL"


def main() -> int:
    args = parse_args()
    credentials = load_breeze_credentials()
    if not credentials:
        print("[breeze-history] no saved credentials; using exchange fallback", flush=True)
        return 2

    # The SDK downloads the ICICI security master at import time.
    from breeze_connect import BreezeConnect
    import breeze_connect.breeze_connect as breeze_module

    breeze = BreezeConnect(api_key=credentials.api_key)
    try:
        breeze.generate_session(
            api_secret=credentials.api_secret,
            session_token=credentials.session_token,
        )
    except Exception as exc:
        print(f"[breeze-history] authentication failed; using exchange fallback: {exc}", file=sys.stderr, flush=True)
        return 2

    with psycopg2.connect(database_url()) as conn:
        instruments = load_cash_instruments(conn, breeze_module.zip, ["NSE", "BSE"], max(1, args.limit))

        today = dt.datetime.now(dt.timezone(dt.timedelta(hours=5, minutes=30))).date()
        start = today - dt.timedelta(days=max(1, args.days))
        fetched = 0
        resolved = 0
        rows: list[tuple] = []
        for instrument in instruments:
            fetched += 1
            try:
                response = breeze.get_historical_data_v2(
                    interval="1day",
                    from_date=iso_timestamp(start),
                    to_date=iso_timestamp(today, end=True),
                    stock_code=instrument.breeze_code,
                    exchange_code=instrument.exchange,
                    product_type="cash",
                )
                success = response.get("Success") if isinstance(response, dict) else None
                parsed = [candle(item, instrument.asset_id) for item in (success or []) if isinstance(item, dict)]
                valid = [item for item in parsed if item is not None]
                if valid:
                    rows.extend(valid)
                    resolved += 1
            except Exception as exc:
                print(f"[breeze-history] {instrument.exchange}:{instrument.ticker} failed: {exc}", file=sys.stderr)
            if args.sleep > 0:
                time.sleep(args.sleep)

        if rows:
            with conn.cursor() as cur:
                execute_values(
                    cur,
                    """
                    insert into public.daily_ohlcv
                      (asset_id,date,open,high,low,close,volume,source)
                    values %s
                    on conflict (asset_id,date) do update set
                      open=excluded.open,high=excluded.high,low=excluded.low,
                      close=excluded.close,volume=excluded.volume,source=excluded.source
                    """,
                    rows,
                    page_size=500,
                )
            conn.commit()

    print(
        f"[breeze-history] primary complete: instruments={fetched} resolved={resolved} bars={len(rows)}; "
        "Bhavcopy may now fill unresolved instruments",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
