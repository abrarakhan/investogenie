#!/usr/bin/env python3
"""Replace a finished India session's one-minute candles with Breeze's own.

During the session the live worker builds provisional bars from the ticks it
happens to receive. After the close this fetches the authoritative candles, one
request per stock, and prunes sessions older than the retention window. Stocks
already completed for the day are skipped, so a re-run only fills what is missing.

The live list changes during a session, so a stock can be dropped from it after
a few minutes and keep only a fragment of the day. Those stocks are loaded too,
after the current list, so the fragment is replaced by the whole session.
"""

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
    CashInstrument,
    IST,
    database_url,
    india_market_bounds,
    load_breeze_credentials,
    load_cash_instruments,
    number,
    refresh_india_market_holidays,
)

SOURCE = "BREEZE_HISTORICAL"
CLOSE_GRACE = dt.timedelta(minutes=5)
MAX_CONSECUTIVE_FAILURES = 25


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=int(os.getenv("BREEZE_INTRADAY_LIMIT", "750")))
    parser.add_argument("--sleep", type=float, default=float(os.getenv("BREEZE_INTRADAY_SLEEP_SECONDS", "0.6")))
    parser.add_argument("--retention-days", type=int, default=int(os.getenv("BREEZE_INTRADAY_RETENTION_DAYS", "7")))
    parser.add_argument("--date", help="Session to load (YYYY-MM-DD); defaults to today in IST")
    parser.add_argument("--dry-run", action="store_true", help="Fetch and report without writing")
    return parser.parse_args()


def session_window(day: dt.date, now: dt.datetime) -> tuple[dt.datetime, dt.datetime] | None:
    """The session's open and close, or None when `day` has no finished session yet."""
    bounds = india_market_bounds(day)
    if bounds is None:
        return None
    opened = dt.datetime.combine(day, bounds[0], IST)
    closed = dt.datetime.combine(day, bounds[1], IST)
    return (opened, closed) if now >= closed + CLOSE_GRACE else None


def parse_bar_time(value: Any) -> dt.datetime | None:
    """Breeze reports candle times as IST wall-clock text."""
    text = str(value or "").strip().replace("T", " ").rstrip("Z")
    for pattern in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M"):
        try:
            return dt.datetime.strptime(text, pattern).replace(tzinfo=IST, second=0, microsecond=0)
        except ValueError:
            continue
    return None


def minute_bar(row: dict[str, Any], asset_id: str, opened: dt.datetime, closed: dt.datetime) -> tuple | None:
    """A candle inside the session with coherent prices, or None."""
    minute = parse_bar_time(row.get("datetime"))
    values = [number(row.get(key)) for key in ("open", "high", "low", "close")]
    if minute is None or not (opened <= minute < closed) or any(v is None or v <= 0 for v in values):
        return None
    open_price, high, low, close = values
    high = max(high, open_price, close)
    low = min(low, open_price, close)
    volume = number(row.get("volume"))
    return asset_id, minute, open_price, high, low, close, None if volume is None else max(0, int(volume)), SOURCE


def with_dropped(instruments: list, provisional: list[tuple]) -> list:
    """The current list, then every stock that holds provisional bars but has left the list."""
    listed = {str(item.asset_id) for item in instruments}
    extra = []
    for asset_id, ticker, exchange, breeze_code, token in provisional:
        if str(asset_id) in listed:
            continue
        listed.add(str(asset_id))
        extra.append(CashInstrument(str(asset_id), ticker, exchange, breeze_code, token, ""))
    return [*instruments, *extra]


def provisional_stocks(conn, opened: dt.datetime, closed: dt.datetime) -> list[tuple]:
    """Stocks with live-built bars in the session, with the Breeze contract they were streamed on."""
    with conn.cursor() as cur:
        cur.execute(
            """
            select m.asset_id::text,a.ticker,m.exchange_code,m.stock_code,m.token
              from public.breeze_instrument_map m
              join public.assets a on a.id=m.asset_id
             where m.exchange_code in ('NSE','BSE')
               and exists(select 1 from public.intraday_bars b
                           where b.asset_id=m.asset_id and b.bar_time >= %s and b.bar_time < %s
                             and b.source <> %s)
             order by m.exchange_code,a.ticker
            """,
            (opened, closed, SOURCE),
        )
        return cur.fetchall()


def allowance_spent(response: Any) -> bool:
    return isinstance(response, dict) and "limit exceed" in str(response.get("Error") or "").lower()


def store(conn, rows: list[tuple]) -> None:
    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            insert into public.intraday_bars
              (asset_id,bar_time,open,high,low,close,volume,source)
            values %s
            on conflict (asset_id,bar_time) do update set
              open=excluded.open,high=excluded.high,low=excluded.low,
              close=excluded.close,volume=excluded.volume,source=excluded.source
            """,
            rows,
            page_size=1000,
        )
    conn.commit()


def main() -> int:
    args = parse_args()
    refresh_india_market_holidays()
    now = dt.datetime.now(IST)
    day = dt.date.fromisoformat(args.date) if args.date else now.date()
    window = session_window(day, now)
    if window is None:
        print(f"[breeze-intraday] {day} has no finished session; nothing to do", flush=True)
        return 0
    opened, closed = window

    credentials = load_breeze_credentials()
    if not credentials:
        print("[breeze-intraday] no saved credentials; skipped", flush=True)
        return 0

    # The SDK downloads the ICICI security master at import time.
    from breeze_connect import BreezeConnect
    import breeze_connect.breeze_connect as breeze_module

    breeze = BreezeConnect(api_key=credentials.api_key)
    try:
        breeze.generate_session(api_secret=credentials.api_secret, session_token=credentials.session_token)
    except Exception as exc:
        print(f"[breeze-intraday] authentication failed; skipped: {exc}", file=sys.stderr, flush=True)
        return 2

    with psycopg2.connect(database_url()) as conn:
        listed = load_cash_instruments(conn, breeze_module.zip, ["NSE", "BSE"], max(1, args.limit))
        instruments = with_dropped(listed, provisional_stocks(conn, opened, closed))
        dropped = len(instruments) - len(listed)
        with conn.cursor() as cur:
            # A stock is complete once it has an authoritative bar from the session's last half hour.
            cur.execute(
                """
                select distinct asset_id::text from public.intraday_bars
                 where source=%s and bar_time >= %s and bar_time < %s
                """,
                (SOURCE, closed - dt.timedelta(minutes=30), closed),
            )
            complete = {row[0] for row in cur.fetchall()}
        conn.commit()
        todo = [item for item in instruments if str(item.asset_id) not in complete]

        resolved = stored = failures = 0
        stopped = None
        batch: list[tuple] = []
        for index, instrument in enumerate(todo, start=1):
            try:
                response = breeze.get_historical_data_v2(
                    interval="1minute",
                    from_date=f"{day.isoformat()}T00:00:00.000Z",
                    to_date=f"{day.isoformat()}T23:59:59.000Z",
                    stock_code=instrument.breeze_code,
                    exchange_code=instrument.exchange,
                    product_type="cash",
                )
                if allowance_spent(response):
                    stopped = "Breeze's daily allowance for candle requests is spent"
                    break
                success = response.get("Success") if isinstance(response, dict) else None
                bars = [minute_bar(item, instrument.asset_id, opened, closed) for item in (success or []) if isinstance(item, dict)]
                valid = [bar for bar in bars if bar is not None]
                if success and len(valid) < len(bars) / 2:
                    print(f"[breeze-intraday] {instrument.exchange}:{instrument.ticker}: only {len(valid)} of "
                          f"{len(bars)} candles fall inside the session", file=sys.stderr, flush=True)
                if valid:
                    resolved += 1
                    failures = 0
                    if args.dry_run:
                        print(f"[breeze-intraday] {instrument.exchange}:{instrument.ticker}: {len(valid)} bars, "
                              f"{valid[0][1]:%H:%M} to {valid[-1][1]:%H:%M}", flush=True)
                    else:
                        batch.extend(valid)
                else:
                    failures += 1
            except Exception as exc:
                failures += 1
                print(f"[breeze-intraday] {instrument.exchange}:{instrument.ticker} failed: {exc}", file=sys.stderr, flush=True)
            if failures >= MAX_CONSECUTIVE_FAILURES:
                stopped = f"{failures} stocks in a row returned no candles"
                break
            if len(batch) >= 15_000:
                store(conn, batch)
                stored += len(batch)
                batch = []
            if args.sleep > 0 and index < len(todo):
                time.sleep(args.sleep)
        if batch:
            store(conn, batch)
            stored += len(batch)

        pruned = 0
        if not args.dry_run and args.retention_days > 0:
            with conn.cursor() as cur:
                cur.execute("delete from public.intraday_bars where bar_time < %s", (now - dt.timedelta(days=args.retention_days),))
                pruned = cur.rowcount
            conn.commit()

    print(
        f"[breeze-intraday] {day}: {len(complete)} already complete, {resolved} of {len(todo)} loaded, "
        f"{dropped} of them dropped from the live list mid-session, "
        f"{stored} bars stored, {pruned} old bars pruned" + (f"; stopped early: {stopped}" if stopped else ""),
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
