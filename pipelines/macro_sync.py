#!/usr/bin/env python3
"""Incrementally sync macro history into public.macro_indicators.

Sources use public FRED CSV downloads so the app has a repeatable, no-key path
for the macro lead/lag engine. Rows are upserted by (indicator_type, date), so
this can safely run on every server start and on every recurring market refresh.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import os
import sys
from dataclasses import dataclass
from io import StringIO
from typing import Iterable

import psycopg2
from psycopg2.extras import execute_values
import requests

DEFAULT_DATABASE_URL = "postgresql://localhost:5432/investogenie"
FRED_CSV_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}"


@dataclass(frozen=True)
class MacroSeries:
    key: str
    fred_id: str
    unit: str


SERIES: tuple[MacroSeries, ...] = (
    MacroSeries("US_10Y_YIELD", "DGS10", "percent"),
    MacroSeries("FED_FUNDS", "DFF", "percent"),
    MacroSeries("USD_INR", "DEXINUS", "inr_per_usd"),
    MacroSeries("BRENT_CRUDE", "DCOILBRENTEU", "usd_per_bbl"),
    MacroSeries("VIX", "VIXCLS", "index"),
    MacroSeries("US_DOLLAR_BROAD", "DTWEXBGS", "index"),
)


def resolve_database_url() -> str:
    value = os.getenv("DATABASE_URL") or DEFAULT_DATABASE_URL
    if "localhost:54322" in value or "127.0.0.1:54322" in value:
        return DEFAULT_DATABASE_URL
    return value


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sync macro history from FRED into Postgres")
    parser.add_argument("--years", type=int, default=int(os.getenv("MACRO_SYNC_YEARS", "5")))
    parser.add_argument("--series", help="Comma-separated InvestoGenie indicator keys to sync")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--timeout", type=float, default=float(os.getenv("MACRO_SYNC_TIMEOUT", "25")))
    return parser.parse_args()


def selected_series(series_arg: str | None) -> list[MacroSeries]:
    if not series_arg:
        env_value = os.getenv("MACRO_SYNC_SERIES")
        series_arg = env_value if env_value else None
    if not series_arg:
        return list(SERIES)
    wanted = {part.strip().upper() for part in series_arg.split(",") if part.strip()}
    known = {series.key: series for series in SERIES}
    unknown = sorted(wanted - set(known))
    if unknown:
        raise SystemExit(f"Unknown macro series: {', '.join(unknown)}")
    return [known[key] for key in wanted]


def fetch_fred(series: MacroSeries, start_date: dt.date, timeout: float) -> list[tuple[str, dt.date, float, str]]:
    response = requests.get(FRED_CSV_URL.format(series_id=series.fred_id), timeout=timeout)
    response.raise_for_status()
    reader = csv.DictReader(StringIO(response.text))
    rows: list[tuple[str, dt.date, float, str]] = []
    for row in reader:
        raw_date = row.get("observation_date") or row.get("DATE")
        raw_value = row.get(series.fred_id)
        if not raw_date or raw_value in (None, "", "."):
            continue
        try:
            obs_date = dt.date.fromisoformat(raw_date)
            value = float(raw_value)
        except ValueError:
            continue
        if obs_date < start_date:
            continue
        rows.append((series.key, obs_date, value, series.unit))
    return rows


def upsert_rows(conn, rows: Iterable[tuple[str, dt.date, float, str]]) -> int:
    payload = list(rows)
    if not payload:
        return 0
    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            insert into public.macro_indicators (indicator_type, date, value, unit)
            values %s
            on conflict (indicator_type, date) do update set
              value = excluded.value,
              unit = excluded.unit
            """,
            payload,
            page_size=1000,
        )
    conn.commit()
    return len(payload)


def main() -> int:
    args = parse_args()
    if args.years <= 0:
        raise SystemExit("--years must be positive")
    start_date = dt.date.today() - dt.timedelta(days=args.years * 366)
    total = 0
    all_rows: list[tuple[str, dt.date, float, str]] = []

    for series in selected_series(args.series):
        rows = fetch_fred(series, start_date, args.timeout)
        print(f"[macro-sync] {series.key}: fetched {len(rows)} rows since {start_date}")
        all_rows.extend(rows)

    if args.dry_run:
        print(f"[macro-sync] dry run; would upsert {len(all_rows)} rows")
        return 0

    with psycopg2.connect(resolve_database_url()) as conn:
        total = upsert_rows(conn, all_rows)
    print(f"[macro-sync] upserted {total} macro rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
