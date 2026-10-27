#!/usr/bin/env python3
"""Build point-in-time screener features and forward-return backtest outcomes.

All calculations live in Python.  The web layer only filters stored values and
aggregates outcomes, so current screens and historical tests share one contract.
"""
from __future__ import annotations

import argparse
import os
from datetime import date, timedelta

import numpy as np
import pandas as pd
import psycopg2
from psycopg2.extras import execute_values

FEATURE_VERSION = "technical_v1"
INCREMENTAL_WRITE_DAYS = 120
# 320 calendar days comfortably contains the 200 completed trading sessions
# needed by the longest indicator, including weekends and exchange holidays.
INCREMENTAL_LOOKBACK_DAYS = 320


def history_start_date(today: date, years: int, incremental: bool) -> date:
    """Bound input history without changing any feature formula.

    Incremental runs rewrite only the recent window, so loading five years for
    every active stock needlessly consumes several gigabytes. The retained
    lookback still supplies every row required by the 200-session indicators.
    """
    if incremental:
        return today - timedelta(days=INCREMENTAL_WRITE_DAYS + INCREMENTAL_LOOKBACK_DAYS)
    return today - timedelta(days=max(4, years) * 366 + INCREMENTAL_LOOKBACK_DAYS)


def compute_features(frame: pd.DataFrame) -> pd.DataFrame:
    df = frame.sort_values("date").copy()
    close = pd.to_numeric(df["close"], errors="coerce")
    high = pd.to_numeric(df["high"], errors="coerce")
    low = pd.to_numeric(df["low"], errors="coerce")
    volume = pd.to_numeric(df["volume"], errors="coerce")
    for window in (20, 50, 100, 150, 200):
        df[f"sma_{window}"] = close.rolling(window, min_periods=window).mean()
    for span in (20, 50):
        df[f"ema_{span}"] = close.ewm(span=span, adjust=False, min_periods=span).mean()
    for window in (20, 50, 100, 150, 200):
        df[f"distance_sma_{window}_pct"] = (close / df[f"sma_{window}"] - 1.0) * 100.0
    for span in (20, 50):
        df[f"distance_ema_{span}_pct"] = (close / df[f"ema_{span}"] - 1.0) * 100.0
    for fast, slow in ((20, 50), (20, 100), (20, 150), (20, 200), (50, 100),
                       (50, 150), (50, 200), (100, 150), (100, 200), (150, 200)):
        df[f"sma_{fast}_vs_{slow}_pct"] = (df[f"sma_{fast}"] / df[f"sma_{slow}"] - 1.0) * 100.0

    delta = close.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / 14, adjust=False, min_periods=14).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / 14, adjust=False, min_periods=14).mean()
    rs = gain / loss.replace(0, np.nan)
    df["rsi_14"] = 100 - 100 / (1 + rs)
    prev_close = close.shift(1)
    true_range = pd.concat([(high - low), (high - prev_close).abs(), (low - prev_close).abs()], axis=1).max(axis=1)
    atr = true_range.ewm(alpha=1 / 14, adjust=False, min_periods=14).mean()
    df["atr_pct_14"] = atr / close * 100.0
    df["volume_ratio_20"] = volume / volume.rolling(20, min_periods=20).mean()
    for sessions in (5, 20, 63):
        df[f"return_{sessions}d"] = close.pct_change(sessions, fill_method=None) * 100.0
    for sessions in (5, 20, 60):
        df[f"forward_return_{sessions}d"] = (close.shift(-sessions) / close - 1.0) * 100.0
    df["close"] = close
    return df.replace([np.inf, -np.inf], np.nan)


COLUMNS = [
    "close", "sma_20", "sma_50", "sma_100", "sma_150", "sma_200", "ema_20", "ema_50",
    "distance_sma_20_pct", "distance_sma_50_pct", "distance_sma_100_pct", "distance_sma_150_pct",
    "distance_sma_200_pct", "distance_ema_20_pct", "distance_ema_50_pct",
    "sma_20_vs_50_pct", "sma_20_vs_100_pct", "sma_20_vs_150_pct", "sma_20_vs_200_pct",
    "sma_50_vs_100_pct", "sma_50_vs_150_pct", "sma_50_vs_200_pct", "sma_100_vs_150_pct",
    "sma_100_vs_200_pct", "sma_150_vs_200_pct", "rsi_14", "atr_pct_14", "volume_ratio_20",
    "return_5d", "return_20d", "return_63d", "forward_return_5d", "forward_return_20d",
    "forward_return_60d",
]


def db_value(value):
    return None if pd.isna(value) else float(value)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--market", choices=("IN", "US"))
    parser.add_argument("--years", type=int, default=5)
    parser.add_argument("--incremental", action="store_true", help="Rewrite only the recent 120 calendar days")
    parser.add_argument("--bootstrap", action="store_true", help="Full load when empty, otherwise incremental")
    args = parser.parse_args()
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL is required")
    conn = psycopg2.connect(database_url)
    try:
        incremental = args.incremental
        if args.bootstrap:
            with conn.cursor() as cur:
                cur.execute("""select exists(select 1 from public.screener_technical_daily d
                    join public.assets a on a.id=d.asset_id where (%s is null or a.country=%s))""",
                            (args.market, args.market))
                incremental = bool(cur.fetchone()[0])
        today = date.today()
        write_since = today - timedelta(days=INCREMENTAL_WRITE_DAYS) if incremental else None
        since = history_start_date(today, args.years, incremental)
        with conn.cursor() as cur:
            cur.execute(
                """select o.asset_id::text,o.date,o.open,o.high,o.low,o.close,o.volume
                     from public.daily_ohlcv o join public.assets a on a.id=o.asset_id
                    where a.asset_class='STOCK' and a.is_active and o.date >= %s
                      and (%s is null or a.country=%s)
                    order by o.asset_id,o.date""",
                (since, args.market, args.market),
            )
            rows = cur.fetchall()
        raw = pd.DataFrame(rows, columns=["asset_id", "date", "open", "high", "low", "close", "volume"])
        with conn.cursor() as cur:
            if args.market:
                cur.execute("""delete from public.screener_technical_daily d using public.assets a
                    where a.id=d.asset_id and a.country=%s and (%s::date is null or d.date >= %s::date)""",
                            (args.market, write_since, write_since))
            else:
                if write_since:
                    cur.execute("delete from public.screener_technical_daily where date >= %s", (write_since,))
                else:
                    cur.execute("truncate public.screener_technical_daily")
            cols = ",".join(["asset_id", "date", *COLUMNS, "feature_version"])
            insert_sql = f"insert into public.screener_technical_daily ({cols}) values %s"
            payload = []
            written = 0
            for asset_id, group in raw.groupby("asset_id", sort=False):
                computed = compute_features(group)
                if write_since:
                    computed = computed[computed["date"] >= write_since]
                for row in computed.itertuples(index=False):
                    values = [db_value(getattr(row, col)) for col in COLUMNS]
                    payload.append((asset_id, row.date, *values, FEATURE_VERSION))
                if len(payload) >= 50_000:
                    execute_values(cur, insert_sql, payload, page_size=5000)
                    written += len(payload)
                    payload.clear()
            if payload:
                execute_values(cur, insert_sql, payload, page_size=5000)
                written += len(payload)
        conn.commit()
        print(f"[screener-features] wrote {written} rows ({args.market or 'ALL'}, {'incremental' if incremental else 'full'})")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
