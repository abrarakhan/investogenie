#!/usr/bin/env python3
"""Incrementally synchronize NSE daily OHLCV from Yahoo Finance into Postgres.

The application reads public.daily_ohlcv, so this pipeline uses the database as
the master dataset. It fetches only each ticker's missing window and upserts a
small overlap used to detect stock splits. A large adjusted-price discontinuity
causes that ticker's ten-year history to be rebuilt with adjusted OHLC values.

    DATABASE_URL=postgresql://localhost:5432/investogenie \
      python pipelines/nse_yfinance_sync.py

Use --symbols AAREYDRUGS,GLOSTERLTD or --limit 10 for a targeted test run.
"""

from __future__ import annotations

import argparse
import re
import os
import time
from dataclasses import dataclass
from datetime import date, timedelta

import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
import requests
import yfinance as yf


DEFAULT_DATABASE_URL = "postgresql://localhost:5432/investogenie"
OVERLAP_DAYS = 10
HISTORY_DAYS = 365 * 10 + 10
ADJUSTMENT_RATIO_LOW = 0.75
ADJUSTMENT_RATIO_HIGH = 1.34
GOOGLE_FINANCE_URL = "https://www.google.com/finance/quote/{symbol}:NSE?hl=en"
YAHOO_SUFFIX_BY_EXCHANGE = {"NSE": "NS", "BSE": "BO"}
HTTP_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 Chrome/120 Safari/537.36"
    )
}


@dataclass(frozen=True)
class AssetState:
    asset_id: str
    ticker: str
    last_date: date | None
    last_close: float | None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--database-url",
        default=os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL),
        help="Postgres connection URL (defaults to DATABASE_URL or local Investogenie DB)",
    )
    parser.add_argument("--symbols", help="Comma-separated NSE symbols to synchronize")
    parser.add_argument(
        "--exchange",
        choices=sorted(YAHOO_SUFFIX_BY_EXCHANGE),
        default="NSE",
        help="Indian exchange to synchronize. NSE uses Yahoo .NS; BSE uses Yahoo .BO.",
    )
    parser.add_argument("--limit", type=int, help="Maximum number of symbols to process")
    parser.add_argument("--sleep", type=float, default=1.2, help="Seconds between Yahoo requests")
    parser.add_argument("--retries", type=int, default=3, help="Download attempts per symbol")
    parser.add_argument("--history-days", type=int, default=HISTORY_DAYS, help="Calendar days for first/full history fetch")
    parser.add_argument("--dry-run", action="store_true", help="Fetch and validate without writing")
    parser.add_argument(
        "--no-full-adjustment",
        action="store_true",
        help="Do not rebuild ten-year history when a split-scale adjustment is detected",
    )
    return parser.parse_args()


def load_assets(conn, requested: set[str] | None, limit: int | None, exchange: str) -> list[AssetState]:
    params: list[object] = []
    symbol_filter = ""
    if requested:
        params.append(sorted(requested))
        symbol_filter = "and a.ticker = any(%s)"

    limit_sql = ""
    if limit is not None:
        params.append(max(1, limit))
        limit_sql = "limit %s"

    with conn.cursor() as cur:
        quote_source = f"{exchange}_BHAVCOPY"
        cur.execute(
            f"""
            select a.id::text, a.ticker, latest.date, latest.close
              from public.assets a
              left join lateral (
                select o.date, o.close
                  from public.daily_ohlcv o
                 where o.asset_id = a.id
                 order by o.date desc
                 limit 1
              ) latest on true
             where a.exchange = %s
               and a.asset_class = 'STOCK'
               and a.is_active = true
               and a.ticker !~ '-RE[0-9]*$'
               and exists (
                 select 1 from public.latest_quotes q
                  where q.asset_id = a.id
                    and q.source = %s
               )
               {symbol_filter}
             order by coalesce(latest.date, date '1900-01-01'), a.ticker
             {limit_sql}
            """,
            [exchange, quote_source, *params],
        )
        return [
            AssetState(
                asset_id=row[0],
                ticker=row[1],
                last_date=row[2],
                last_close=float(row[3]) if row[3] is not None else None,
            )
            for row in cur.fetchall()
        ]


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


def download(symbol: str, start: date, end: date, retries: int, exchange: str) -> pd.DataFrame:
    suffix = YAHOO_SUFFIX_BY_EXCHANGE[exchange]
    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            frame = yf.download(
                f"{symbol}.{suffix}",
                start=start.isoformat(),
                end=end.isoformat(),
                auto_adjust=True,
                actions=False,
                progress=False,
                threads=False,
                timeout=30,
            )
            return normalize_download(frame)
        except Exception as exc:  # yfinance raises several provider-specific errors
            last_error = exc
            if attempt < retries:
                time.sleep(2 ** (attempt - 1))
    raise RuntimeError(f"Yahoo download failed after {retries} attempts: {last_error}")


def fetch_google_quote(symbol: str) -> float:
    response = requests.get(
        GOOGLE_FINANCE_URL.format(symbol=symbol),
        headers=HTTP_HEADERS,
        timeout=30,
    )
    response.raise_for_status()
    html = response.text
    anchor = f">{symbol}:NSE</div>"
    start = html.find(anchor)
    if start < 0:
        raise ValueError("requested NSE symbol was not found in Google Finance response")

    # Restrict parsing to the requested quote card. The page also contains many
    # unrelated index cards with the same price element markup.
    quote_card = html[start : start + 25_000]
    match = re.search(
        r'jsname="Pdsbrc"[^>]*>\s*<span[^>]*>\s*'
        r'(?:₹|&#8377;)?\s*([0-9][0-9,]*(?:\.[0-9]+)?)',
        quote_card,
    )
    if not match:
        raise ValueError("Google Finance quote element was not found")
    price = float(match.group(1).replace(",", ""))
    if price <= 0:
        raise ValueError(f"Google Finance returned invalid price {price}")
    return price


def adjustment_detected(state: AssetState, frame: pd.DataFrame) -> tuple[bool, float | None]:
    if state.last_date is None or state.last_close is None or state.last_close <= 0:
        return False, None
    overlap = frame[frame["date"] == state.last_date]
    if overlap.empty:
        return False, None
    adjusted_close = float(overlap.iloc[-1]["close"])
    ratio = adjusted_close / state.last_close
    return ratio < ADJUSTMENT_RATIO_LOW or ratio > ADJUSTMENT_RATIO_HIGH, ratio


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


def upsert_google_quote(conn, asset_id: str, price: float) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into public.latest_quotes
              (asset_id,price,change_pct,currency,as_of,source)
            values (%s,%s,null,'INR',null,'GOOGLE_FINANCE')
            on conflict (asset_id) do update set
              price=excluded.price,
              change_pct=null,
              currency=excluded.currency,
              as_of=null,
              source=excluded.source,
              updated_at=now()
            """,
            (asset_id, price),
        )
    conn.commit()


def main() -> None:
    args = parse_args()
    requested = (
        {symbol.strip().upper() for symbol in args.symbols.split(",") if symbol.strip()}
        if args.symbols
        else None
    )
    today = date.today()

    conn = psycopg2.connect(args.database_url)
    try:
        assets = load_assets(conn, requested, args.limit, args.exchange)
        print(f"Identified {len(assets)} {args.exchange} stocks for incremental synchronization.")

        written = 0
        added = 0
        rebuilt = 0
        unchanged = 0
        failed = 0
        google_fallbacks = 0

        for index, state in enumerate(assets, 1):
            missing_start = (
                state.last_date + timedelta(days=1)
                if state.last_date
                else today - timedelta(days=max(1, args.history_days))
            )
            fetch_start = (
                state.last_date - timedelta(days=OVERLAP_DAYS)
                if state.last_date
                else missing_start
            )

            print(
                f"[{index}/{len(assets)}] {state.ticker}: "
                f"{missing_start.isoformat()} to {today.isoformat()}"
            )
            try:
                frame = download(state.ticker, fetch_start, today, max(1, args.retries), args.exchange)
                split, ratio = adjustment_detected(state, frame)
                if split and not args.no_full_adjustment:
                    print(f"   adjustment ratio {ratio:.4f}; rebuilding adjusted ten-year history")
                    frame = download(
                        state.ticker,
                        today - timedelta(days=max(1, args.history_days)),
                        today,
                        max(1, args.retries),
                        args.exchange,
                    )
                    rebuilt += 1

                if frame.empty:
                    if args.exchange == "NSE":
                        price = fetch_google_quote(state.ticker)
                        if not args.dry_run:
                            upsert_google_quote(conn, state.asset_id, price)
                        google_fallbacks += 1
                        print(f"   Yahoo returned no bars; Google Finance quote {price:.2f}")
                    else:
                        unchanged += 1
                        print("   Yahoo returned no bars")
                else:
                    new_count = int((frame["date"] >= missing_start).sum())
                    count = 0 if args.dry_run else upsert_bars(conn, state.asset_id, frame)
                    written += count
                    added += new_count
                    print(
                        f"   {'validated' if args.dry_run else 'upserted'} {len(frame)} bars"
                        f" ({new_count} new)"
                    )
            except Exception as exc:
                conn.rollback()
                try:
                    if args.exchange != "NSE":
                        raise
                    price = fetch_google_quote(state.ticker)
                    if not args.dry_run:
                        upsert_google_quote(conn, state.asset_id, price)
                    google_fallbacks += 1
                    print(f"   Yahoo error ({exc}); Google Finance quote {price:.2f}")
                except Exception as google_exc:
                    conn.rollback()
                    failed += 1
                    print(f"   ERROR: Yahoo: {exc}; Google Finance: {google_exc}")

            if index < len(assets) and args.sleep > 0:
                time.sleep(args.sleep)

        print(
            f"{args.exchange} sync complete: "
            f"processed={len(assets)} written={written} new={added} "
            f"rebuilt={rebuilt} unchanged={unchanged} "
            f"google_fallbacks={google_fallbacks} failed={failed}"
        )
        if failed:
            raise SystemExit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
