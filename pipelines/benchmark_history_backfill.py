#!/usr/bin/env python3
"""Extend a benchmark series backwards so historical replays can reach further.

The daily sync only ever fetches forward from an asset's newest bar, which is right
for a live feed and useless for history: NIFTYBEES starts at 2025-03-04 while a
thousand Indian stocks carry a decade of bars. The benchmark is the binding limit on
`strong_swing_replay`, because a stock-day with no benchmark behind it fails
`benchmark_data` and can never be judged.

The whole range is refetched rather than only the missing head. Yahoo returns
split- and dividend-adjusted prices as of the moment of the request, so stitching a
new old segment onto an old new one would leave a seam at the join; rewriting the
series in one pass keeps it internally consistent.

This writes market data. Run it against a development database first and inspect the
reported gap and overlap before pointing it at production.
"""
from __future__ import annotations

import argparse
import os
from datetime import date, datetime

import psycopg2

from nse_yfinance_sync import YAHOO_SUFFIX_BY_EXCHANGE, download, upsert_bars


def existing_coverage(conn, ticker: str, country: str) -> tuple[str, int, date | None, date | None]:
    with conn.cursor() as cur:
        cur.execute(
            """select a.id::text,count(o.*),min(o.date),max(o.date)
                 from public.assets a left join public.daily_ohlcv o on o.asset_id=a.id
                where a.ticker=%s and a.country=%s group by a.id""",
            (ticker, country),
        )
        row = cur.fetchone()
    if not row:
        raise SystemExit(f"No {country} asset with ticker {ticker}")
    return row[0], int(row[1]), row[2], row[3]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ticker", default="NIFTYBEES")
    parser.add_argument("--country", default="IN")
    parser.add_argument("--exchange", default="NSE", choices=sorted(YAHOO_SUFFIX_BY_EXCHANGE))
    parser.add_argument("--from", dest="start", default="2015-01-01")
    parser.add_argument("--retries", type=int, default=3)
    parser.add_argument("--dry-run", action="store_true")
    options = parser.parse_args()

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL is required")
    start = datetime.strptime(options.start, "%Y-%m-%d").date()

    conn = psycopg2.connect(database_url)
    try:
        asset_id, bars, first, last = existing_coverage(conn, options.ticker, options.country)
        print(f"{options.ticker}: {bars} bars on record"
              + (f", {first} to {last}" if first else ", none"))
        frame = download(options.ticker, start, date.today(), max(1, options.retries), options.exchange)
        if frame.empty:
            raise SystemExit(f"Yahoo returned no bars for {options.ticker} from {start}")
        fetched_first, fetched_last = frame["date"].min(), frame["date"].max()
        print(f"fetched {len(frame)} bars, {fetched_first} to {fetched_last}")
        if first and fetched_first >= first:
            print("nothing earlier than the existing series was returned; no backfill available")
        if options.dry_run:
            print("dry run; nothing written")
            return
        written = upsert_bars(conn, asset_id, frame)
        _, bars_after, first_after, last_after = existing_coverage(conn, options.ticker, options.country)
        print(f"wrote {written} bars; {options.ticker} now holds {bars_after} bars, "
              f"{first_after} to {last_after}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
