#!/usr/bin/env python3
"""Fetch the one-minute path of the days a historical replay traded.

The replay judges the entry band once, at the open, because a daily bar is all it has.
The live screen judges it against the quote all session, so a stock that opens outside
the band and walks into it later is offered to you and was never in the replay's sample.
Nobody can say how large that difference is without the intraday path of those days.

Breeze serves one-minute candles back to at least 2017, which covers the whole replay
window. This fetches them for a run's signals, one request per stock-session, and writes
them to `intraday_bars` under its own source so the operational sync's retention prune
leaves them alone.

It is resumable by design. Breeze's daily candle allowance is shared with the account
sync and the page-quote refresh, so a full backfill may take several days of allowance;
every pair already stored is skipped, so re-running continues rather than restarts.
"""
from __future__ import annotations

import argparse
import datetime as dt
import os
import sys
import time
from pathlib import Path

import psycopg2
from psycopg2.extras import execute_values

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "workers"))
sys.path.insert(0, str(ROOT / "pipelines"))

from breeze_intraday_sync import minute_bar, parse_bar_time, session_window  # noqa: E402,F401
from breeze_market_daemon import database_url, decrypt_credential, env  # noqa: E402

# Its own source, so `breeze_intraday_sync --retention-days` cannot prune research history
# that costs days of API allowance to rebuild.
SOURCE = "BREEZE_REPLAY"


def pending_pairs(conn, run_id: str, limit: int | None) -> list[tuple]:
    """Signals whose entry session has no intraday path stored yet.

    Skipping what is already present is what makes a part-finished run resumable, and the
    allowance makes part-finished runs the normal case rather than the exception.
    """
    with conn.cursor() as cur:
        cur.execute(
            """select s.asset_id::text, s.ticker, s.entry_date, m.stock_code, m.exchange_code
                 from public.strong_swing_replay_signals s
                 join public.breeze_instrument_map m on m.asset_id=s.asset_id
                where s.run_id=%s and s.entry_date is not null
                  and not exists (
                    select 1 from public.intraday_bars b
                     where b.asset_id=s.asset_id
                       and (b.bar_time at time zone 'Asia/Kolkata')::date = s.entry_date)
                order by s.entry_date desc
                limit %s""",
            (run_id, limit if limit else None),
        )
        return cur.fetchall()


def store(conn, rows: list[tuple]) -> None:
    if not rows:
        return
    with conn.cursor() as cur:
        execute_values(
            cur,
            """insert into public.intraday_bars
                 (asset_id,bar_time,open,high,low,close,volume,source)
               values %s
               on conflict (asset_id,bar_time) do nothing""",
            rows,
            page_size=1000,
        )
    conn.commit()


def allowance_spent(response) -> bool:
    text = str(response.get("Error") or "") if isinstance(response, dict) else ""
    return "limit" in text.lower() or "exceed" in text.lower()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-id", required=True, help="strong_swing_replay_runs.id to cover")
    parser.add_argument("--limit", type=int, default=400, help="stock-sessions to fetch this pass")
    parser.add_argument("--sleep", type=float, default=0.6)
    parser.add_argument("--dry-run", action="store_true")
    options = parser.parse_args()

    if not os.environ.get("DATABASE_URL"):
        raise SystemExit("DATABASE_URL is required")
    conn = psycopg2.connect(database_url())
    try:
        pairs = pending_pairs(conn, options.run_id, options.limit)
        with conn.cursor() as cur:
            cur.execute(
                """select count(*) from public.strong_swing_replay_signals s
                     join public.breeze_instrument_map m on m.asset_id=s.asset_id
                    where s.run_id=%s and s.entry_date is not null""",
                (options.run_id,),
            )
            total = cur.fetchone()[0]
        print(f"{len(pairs)} stock-sessions to fetch this pass, of {total} mapped signals", flush=True)
        if options.dry_run or not pairs:
            for asset_id, ticker, day, code, exchange in pairs[:10]:
                print(f"  {exchange}:{ticker} {day} ({code})")
            return 0

        with conn.cursor() as cur:
            cur.execute(
                """select breeze_api_key_encrypted,breeze_api_secret_encrypted,
                          breeze_session_token_encrypted from public.user_credentials
                    where breeze_session_token_encrypted is not null limit 1""")
            credential = cur.fetchone()
        if not credential or not all(credential):
            raise SystemExit("No Breeze session is connected")
        secret_key = env("CREDENTIAL_ENCRYPTION_KEY") or ""
        key, secret, token = [decrypt_credential(value, secret_key) for value in credential]
        from breeze_connect import BreezeConnect
        breeze = BreezeConnect(api_key=key)
        breeze.generate_session(api_secret=secret, session_token=token)

        fetched = stored = empty = 0
        for index, (asset_id, ticker, day, code, exchange) in enumerate(pairs, start=1):
            window = session_window(day, dt.datetime.now(dt.timezone.utc))
            if window is None:
                empty += 1
                continue
            opened, closed = window
            try:
                response = breeze.get_historical_data_v2(
                    interval="1minute",
                    from_date=f"{day.isoformat()}T00:00:00.000Z",
                    to_date=f"{day.isoformat()}T23:59:59.000Z",
                    stock_code=code, exchange_code=exchange, product_type="cash",
                )
            except Exception as exc:  # the SDK raises several provider-specific errors
                print(f"  {exchange}:{ticker} {day}: {str(exc)[:80]}", file=sys.stderr, flush=True)
                time.sleep(options.sleep)
                continue
            if allowance_spent(response):
                print("Breeze's daily candle allowance is spent; re-run tomorrow to continue",
                      file=sys.stderr, flush=True)
                break
            success = response.get("Success") if isinstance(response, dict) else None
            bars = [minute_bar(item, asset_id, opened, closed) for item in (success or []) if isinstance(item, dict)]
            valid = [bar[:-1] + (SOURCE,) for bar in bars if bar is not None]
            fetched += 1
            if valid:
                store(conn, valid)
                stored += len(valid)
            else:
                empty += 1
            if index % 50 == 0:
                print(f"  {index}/{len(pairs)} sessions, {stored} bars stored", flush=True)
            time.sleep(options.sleep)
        print(f"Fetched {fetched} sessions, stored {stored} bars, {empty} returned nothing", flush=True)
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
