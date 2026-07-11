#!/usr/bin/env python3
"""Incrementally synchronize US daily OHLCV from Yahoo Finance into Postgres.

This is the local-machine companion to the quote/fundamentals sync. It grows US
technical-scan coverage without requiring a paid Tiingo token: each run picks the
US stocks with the least history, fetches only the missing adjusted daily bars,
and upserts them into public.daily_ohlcv.

Examples:
  DATABASE_URL=postgresql://localhost:5432/investogenie \
    python pipelines/us_history_sync.py --limit 250

  python pipelines/us_history_sync.py --symbols AAPL,MSFT,NVDA --force-full
"""

from __future__ import annotations

import argparse
import os
import time
from dataclasses import dataclass
from datetime import date, timedelta

import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
import yfinance as yf


DEFAULT_DATABASE_URL = "postgresql://localhost:5432/investogenie"
DEFAULT_MIN_BARS = 260
DEFAULT_HISTORY_DAYS = 365 * 3 + 30
OVERLAP_DAYS = 7


@dataclass(frozen=True)
class AssetState:
    asset_id: str
    ticker: str
    exchange: str | None
    bar_count: int
    last_date: date | None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--database-url",
        default=os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL),
        help="Postgres connection URL (defaults to DATABASE_URL or local Investogenie DB)",
    )
    parser.add_argument("--symbols", help="Comma-separated US tickers to synchronize")
    parser.add_argument("--limit", type=int, default=250, help="Maximum tickers to process this run")
    parser.add_argument("--min-bars", type=int, default=DEFAULT_MIN_BARS, help="Coverage target per ticker")
    parser.add_argument("--history-days", type=int, default=DEFAULT_HISTORY_DAYS, help="Calendar days for first full fetch")
    parser.add_argument("--sleep", type=float, default=0.25, help="Seconds between Yahoo requests")
    parser.add_argument("--retries", type=int, default=2, help="Download attempts per symbol")
    parser.add_argument("--force-full", action="store_true", help="Fetch full history window even if ticker has bars")
    parser.add_argument("--dry-run", action="store_true", help="Fetch and validate without writing")
    return parser.parse_args()


def requested_symbols(raw: str | None) -> set[str] | None:
    if not raw:
        return None
    return {symbol.strip().upper() for symbol in raw.split(",") if symbol.strip()}


def yahoo_symbol(ticker: str) -> str:
    return ticker.replace("/", "-").replace(".", "-")


def load_assets(conn, requested: set[str] | None, limit: int | None, min_bars: int) -> list[AssetState]:
    params: list[object] = []
    filters = ["a.country='US'", "a.asset_class='STOCK'", "a.is_active=true"]
    if requested:
        filters.append("a.ticker=any(%s)")
        params.append(sorted(requested))
    else:
        filters.append("coalesce(o.bar_count, 0) < %s")
        params.append(min_bars)

    limit_sql = ""
    if limit is not None and not requested:
        params.append(max(1, limit))
        limit_sql = "limit %s"

    with conn.cursor() as cur:
        cur.execute(
            f"""
            select a.id::text,a.ticker,a.exchange,
                   coalesce(o.bar_count,0)::int,o.last_date
              from public.assets a
              left join (
                select asset_id,count(*) bar_count,max(date) last_date
                  from public.daily_ohlcv
                 group by asset_id
              ) o on o.asset_id=a.id
             where {' and '.join(filters)}
             order by coalesce(o.bar_count,0), o.last_date nulls first, a.ticker, a.exchange
             {limit_sql}
            """,
            params,
        )
        return [AssetState(row[0], row[1], row[2], int(row[3]), row[4]) for row in cur.fetchall()]


def normalize_download(frame: pd.DataFrame) -> pd.DataFrame:
    if frame.empty:
        return frame
    out = frame.copy()
    if isinstance(out.columns, pd.MultiIndex):
        out.columns = out.columns.get_level_values(0)
    out = out.reset_index()
    date_column = "Date" if "Date" in out.columns else out.columns[0]
    out = out.rename(columns={date_column: "date"})
    out.columns = [str(column).lower() for column in out.columns]
    required = ["date", "open", "high", "low", "close", "volume"]
    if any(column not in out.columns for column in required):
        raise ValueError(f"Unexpected yfinance columns: {list(out.columns)}")

    out = out[required].copy()
    out["date"] = pd.to_datetime(out["date"], utc=True).dt.date
    for column in ("open", "high", "low", "close", "volume"):
        out[column] = pd.to_numeric(out[column], errors="coerce")
    out = out.dropna(subset=["date", "open", "high", "low", "close"])
    out = out[(out[["open", "high", "low", "close"]] > 0).all(axis=1)]
    out = out[
        (out["low"] <= out["open"])
        & (out["open"] <= out["high"])
        & (out["low"] <= out["close"])
        & (out["close"] <= out["high"])
    ]
    out["volume"] = out["volume"].fillna(0).clip(lower=0).round().astype("int64")
    return out.sort_values("date").drop_duplicates("date", keep="last")


def fetch_window(state: AssetState, args: argparse.Namespace) -> tuple[date, date]:
    today = date.today()
    end = today + timedelta(days=1)  # yfinance end is exclusive.
    if args.force_full or state.last_date is None or state.bar_count < max(5, args.min_bars // 4):
        start = today - timedelta(days=max(args.history_days, int(args.min_bars * 1.6)))
    else:
        start = state.last_date - timedelta(days=OVERLAP_DAYS)
    return start, end


def download(state: AssetState, args: argparse.Namespace) -> pd.DataFrame:
    start, end = fetch_window(state, args)
    symbol = yahoo_symbol(state.ticker)
    last_error: Exception | None = None
    for attempt in range(1, max(1, args.retries) + 1):
        try:
            frame = yf.download(
                symbol,
                start=start.isoformat(),
                end=end.isoformat(),
                auto_adjust=True,
                actions=False,
                progress=False,
                threads=False,
                timeout=30,
            )
            return normalize_download(frame)
        except Exception as exc:
            last_error = exc
            if attempt < max(1, args.retries):
                time.sleep(2 ** (attempt - 1))
    raise RuntimeError(f"Yahoo download failed after {args.retries} attempts: {last_error}")


def upsert_bars(conn, asset_id: str, frame: pd.DataFrame) -> int:
    rows = [
        (
            asset_id,
            row.date,
            float(row.open),
            float(row.high),
            float(row.low),
            float(row.close),
            int(row.volume),
        )
        for row in frame.itertuples(index=False)
    ]
    if not rows:
        return 0
    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            insert into public.daily_ohlcv
              (asset_id,date,open,high,low,close,volume)
            values %s
            on conflict (asset_id,date) do update set
              open=excluded.open,
              high=excluded.high,
              low=excluded.low,
              close=excluded.close,
              volume=excluded.volume
            """,
            rows,
            page_size=500,
        )
    conn.commit()
    return len(rows)


def main() -> None:
    args = parse_args()
    requested = requested_symbols(args.symbols)
    conn = psycopg2.connect(args.database_url)
    try:
        assets = load_assets(conn, requested, args.limit, args.min_bars)
        print(f"Synchronizing US OHLCV for {len(assets)} stocks (target {args.min_bars} bars).")
        fetched = 0
        bars_written = 0
        no_data = 0
        failed = 0
        for index, state in enumerate(assets, 1):
            print(f"[{index}/{len(assets)}] {state.ticker} bars={state.bar_count} last={state.last_date or '-'}")
            try:
                frame = download(state, args)
                if frame.empty:
                    no_data += 1
                    print("   no bars returned")
                else:
                    fetched += 1
                    count = 0 if args.dry_run else upsert_bars(conn, state.asset_id, frame)
                    bars_written += count
                    print(f"   upserted {count} bars ({frame['date'].min()}..{frame['date'].max()})")
            except Exception as exc:
                conn.rollback()
                failed += 1
                print(f"   ERROR: {exc}")
            if index < len(assets) and args.sleep > 0:
                time.sleep(args.sleep)
        print(
            "US OHLCV sync complete: "
            f"stocks={len(assets)} fetched={fetched} bars_written={bars_written} "
            f"no_data={no_data} failed={failed}"
        )
    finally:
        conn.close()


if __name__ == "__main__":
    main()
