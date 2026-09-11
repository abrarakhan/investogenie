#!/usr/bin/env python3
"""Refresh active Indian stock quotes and today's OHLCV in Yahoo batches."""

from __future__ import annotations

import argparse
import os
import time
from dataclasses import dataclass
from datetime import date, datetime
from zoneinfo import ZoneInfo

import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
import yfinance as yf


DEFAULT_DATABASE_URL = "postgresql://localhost:5432/investogenie"
SUFFIX = {"NSE": "NS", "BSE": "BO"}


@dataclass(frozen=True)
class Asset:
    asset_id: str
    ticker: str
    previous_close: float | None


@dataclass(frozen=True)
class Quote:
    price: float
    change_pct: float | None
    as_of: date
    open: float
    high: float
    low: float
    volume: int | None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL))
    parser.add_argument("--exchange", choices=["ALL", *sorted(SUFFIX)], default="ALL")
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--sleep", type=float, default=0.2)
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def load_assets(conn, exchange: str, limit: int | None) -> list[Asset]:
    params: list[object] = [exchange]
    limit_sql = ""
    if limit is not None:
        params.append(max(1, limit))
        limit_sql = "limit %s"
    with conn.cursor() as cur:
        cur.execute(
            f"""
            select a.id::text,a.ticker,latest.close,
                   exists (
                     select 1 from public.swing_trade_ledger l
                      where l.asset_id=a.id and l.status='OPEN'
                   ) ledger_open
              from public.assets a
              join lateral (
                select o.close
                  from public.daily_ohlcv o
                 where o.asset_id=a.id
                   and o.date >= current_date - interval '10 days'
                 order by o.date desc
                 limit 1
              ) latest on true
              left join lateral (
                select max(s.score) score
                  from public.swing_signals s
                 where s.asset_id=a.id
                   and s.verdict <> 'NO_SETUP'
              ) signal on true
             where a.exchange=%s
               and a.asset_class='STOCK'
               and a.is_active
               and a.ticker !~ '-RE[0-9]*$'
               and not exists (
                 select 1 from public.asset_tracking_exclusions x where x.asset_id=a.id
               )
             order by ledger_open desc,(signal.score is not null) desc,
                      signal.score desc nulls last,a.ticker
             {limit_sql}
            """,
            params,
        )
        return [
            Asset(row[0], row[1], float(row[2]) if row[2] is not None else None)
            for row in cur.fetchall()
        ]


def quote_from_section(section: pd.DataFrame, previous_close: float | None, today: date) -> Quote | None:
    if section.empty or "Close" not in section.columns:
        return None
    closes = pd.to_numeric(section["Close"], errors="coerce").dropna()
    closes = closes[closes > 0]
    if closes.empty:
        return None
    timestamp = pd.Timestamp(closes.index[-1])
    if timestamp.tzinfo is not None:
        timestamp = timestamp.tz_convert("Asia/Kolkata")
    as_of = timestamp.date()
    if as_of != today:
        return None
    price = float(closes.iloc[-1])
    def numeric_column(name: str) -> pd.Series:
        if name not in section.columns:
            return pd.Series(dtype="float64")
        return pd.to_numeric(section[name], errors="coerce").dropna()

    opens = numeric_column("Open")
    highs = numeric_column("High")
    lows = numeric_column("Low")
    volumes = numeric_column("Volume")
    open_price = float(opens.iloc[0]) if not opens.empty else price
    high_price = float(highs.max()) if not highs.empty else price
    low_price = float(lows.min()) if not lows.empty else price
    volume = int(volumes.clip(lower=0).sum()) if not volumes.empty else None
    change_pct = (
        (price - previous_close) / previous_close * 100
        if previous_close is not None and previous_close > 0
        else None
    )
    return Quote(price, change_pct, as_of, open_price, high_price, low_price, volume)


def fetch_batch(assets: list[Asset], exchange: str, retries: int, today: date) -> dict[str, Quote]:
    symbols = [f"{asset.ticker}.{SUFFIX[exchange]}" for asset in assets]
    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            frame = yf.download(
                tickers=symbols,
                period="1d",
                interval="5m",
                group_by="ticker",
                auto_adjust=False,
                actions=False,
                progress=False,
                threads=True,
                timeout=30,
            )
            result: dict[str, Quote] = {}
            if not isinstance(frame.columns, pd.MultiIndex):
                if len(assets) == 1:
                    quote = quote_from_section(frame, assets[0].previous_close, today)
                    if quote:
                        result[assets[0].asset_id] = quote
                return result
            available = set(frame.columns.get_level_values(0))
            for asset, symbol in zip(assets, symbols):
                if symbol not in available:
                    continue
                quote = quote_from_section(frame[symbol], asset.previous_close, today)
                if quote:
                    result[asset.asset_id] = quote
            return result
        except Exception as exc:
            last_error = exc
            if attempt < retries:
                time.sleep(2 ** (attempt - 1))
    print(f"Yahoo batch failed: {last_error}")
    return {}


def upsert_market_data(conn, rows: list[tuple]) -> int:
    if not rows:
        return 0
    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            insert into public.latest_quotes
              (asset_id,price,change_pct,currency,as_of,source)
            values %s
            on conflict (asset_id) do update set
              price=excluded.price,
              change_pct=excluded.change_pct,
              currency=excluded.currency,
              as_of=excluded.as_of,
              source=excluded.source,
              updated_at=now()
            """,
            [row[:6] for row in rows],
            page_size=500,
        )
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
            [
                (asset_id, as_of, open_price, high, low, price, volume)
                for asset_id, price, _change_pct, _currency, as_of, _source,
                    open_price, high, low, volume in rows
            ],
            page_size=500,
        )
    conn.commit()
    return len(rows)


def sync_nifty_history(conn, dry_run: bool) -> int:
    """Keep a short Nifty history for the ledger's market-shock detector."""
    with conn.cursor() as cur:
        cur.execute(
            """select id::text from public.assets
                 where ticker='NIFTY' and country='IN'
                 order by case when exchange='NSE' then 0 else 1 end limit 1"""
        )
        row = cur.fetchone()
    if not row:
        return 0

    frame = yf.download(
        "^NSEI",
        period="7d",
        interval="1d",
        auto_adjust=False,
        actions=False,
        progress=False,
        threads=False,
        timeout=30,
    )
    if frame.empty:
        return 0
    if isinstance(frame.columns, pd.MultiIndex):
        frame.columns = frame.columns.get_level_values(0)

    payload: list[tuple] = []
    for index, values in frame.iterrows():
        close = pd.to_numeric(values.get("Close"), errors="coerce")
        if pd.isna(close) or float(close) <= 0:
            continue
        volume = pd.to_numeric(values.get("Volume"), errors="coerce")
        payload.append((
            row[0], pd.Timestamp(index).date(),
            float(values["Open"]) if pd.notna(values.get("Open")) else None,
            float(values["High"]) if pd.notna(values.get("High")) else None,
            float(values["Low"]) if pd.notna(values.get("Low")) else None,
            float(close), int(volume) if pd.notna(volume) else None,
        ))
    if dry_run or not payload:
        return len(payload)
    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            insert into public.daily_ohlcv (asset_id,date,open,high,low,close,volume)
            values %s
            on conflict (asset_id,date) do update set
              open=excluded.open,high=excluded.high,low=excluded.low,
              close=excluded.close,volume=excluded.volume
            """,
            payload,
        )
    conn.commit()
    return len(payload)


def main() -> None:
    args = parse_args()
    today = datetime.now(ZoneInfo("Asia/Kolkata")).date()
    conn = psycopg2.connect(args.database_url)
    try:
        exchanges = ["NSE", "BSE"] if args.exchange == "ALL" else [args.exchange]
        benchmark_rows = sync_nifty_history(conn, args.dry_run) if "NSE" in exchanges else 0
        print(f"Nifty market-regime history: {benchmark_rows} session(s) refreshed.")
        for exchange in exchanges:
            assets = load_assets(conn, exchange, args.limit)
            batch_size = max(1, args.batch_size)
            resolved_count = 0
            written = 0
            print(f"Refreshing live quotes and OHLCV for {len(assets)} active {exchange} stocks.")
            for start in range(0, len(assets), batch_size):
                batch = assets[start : start + batch_size]
                resolved = fetch_batch(batch, exchange, max(1, args.retries), today)
                rows = [
                    (
                        asset_id, quote.price, quote.change_pct, "INR", quote.as_of,
                        "YAHOO_FINANCE_LIVE", quote.open, quote.high, quote.low, quote.volume,
                    )
                    for asset_id, quote in resolved.items()
                ]
                resolved_count += len(resolved)
                if not args.dry_run:
                    written += upsert_market_data(conn, rows)
                print(f"  {exchange} batch {start // batch_size + 1}: {resolved_count}/{len(assets)} resolved")
                if args.sleep > 0:
                    time.sleep(args.sleep)
            print(
                f"India live sync complete: exchange={exchange} "
                f"assets={len(assets)} resolved={resolved_count} written={written}"
            )
    finally:
        conn.close()


if __name__ == "__main__":
    main()
