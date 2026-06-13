"""
InvestoGenie — US market ingestion (pricing + macro + SEC EDGAR filings).

Fetches and parses:
  • US equity end-of-day OHLCV from Stooq's open CSV endpoint -> assets +
    daily_ohlcv (currency='USD').
  • Macro indicators (US 10Y yield, Brent crude, USD/INR) from FRED's open CSV
    download endpoint -> macro_indicators.
  • Corporate filing facts from the SEC EDGAR open data API (company_tickers +
    companyconcept) -> used to enrich asset names / fundamentals.

Idempotent upserts into the Supabase schema. Run with the service-role DSN:

    DATABASE_URL=postgresql://... python pipelines/edgar_ingest.py

SEC requires a descriptive User-Agent; FRED's fredgraph CSV needs no key.
"""

from __future__ import annotations

import csv
import io
import os
from datetime import date, datetime

import requests
import psycopg2

SEC_HEADERS = {"User-Agent": "InvestoGenie Research contact@investogenie.app"}
SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
SEC_CONCEPT_URL = (
    "https://data.sec.gov/api/xbrl/companyconcept/CIK{cik:010d}/us-gaap/{tag}.json"
)
STOOQ_DAILY_URL = "https://stooq.com/q/d/l/?s={symbol}.us&i=d"
# FRED open CSV: 10Y yield (DGS10), Brent (DCOILBRENTEU), USD/INR (DEXINUS).
FRED_CSV_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={series}"
FRED_TO_INDICATOR = {
    "DGS10": ("US_10Y_YIELD", "percent"),
    "DCOILBRENTEU": ("BRENT_CRUDE", "usd_per_bbl"),
    "DEXINUS": ("USD_INR", "inr_per_usd"),
}


# --------------------------------------------------------------------------- #
# SEC EDGAR: ticker -> CIK map and a fundamental concept fetch
# --------------------------------------------------------------------------- #
def fetch_sec_ticker_map() -> dict[str, dict]:
    """Return { TICKER: {cik, title} } from SEC's open company_tickers.json."""
    resp = requests.get(SEC_TICKERS_URL, headers=SEC_HEADERS, timeout=60)
    resp.raise_for_status()
    out: dict[str, dict] = {}
    for row in resp.json().values():
        out[row["ticker"].upper()] = {"cik": int(row["cik_str"]), "title": row["title"]}
    return out


def fetch_concept(cik: int, tag: str = "Revenues") -> list[dict]:
    """Pull a single XBRL concept (e.g. annual Revenues) for a company."""
    resp = requests.get(
        SEC_CONCEPT_URL.format(cik=cik, tag=tag), headers=SEC_HEADERS, timeout=60
    )
    if resp.status_code == 404:
        return []
    resp.raise_for_status()
    units = resp.json().get("units", {})
    return units.get("USD", [])


# --------------------------------------------------------------------------- #
# Stooq: US equity daily OHLCV
# --------------------------------------------------------------------------- #
def fetch_us_ohlcv(symbol: str) -> list[dict]:
    resp = requests.get(STOOQ_DAILY_URL.format(symbol=symbol.lower()), timeout=60)
    resp.raise_for_status()
    reader = csv.DictReader(io.StringIO(resp.text))
    bars: list[dict] = []
    for row in reader:
        try:
            bars.append(
                {
                    "date": datetime.strptime(row["Date"], "%Y-%m-%d").date(),
                    "open": float(row["Open"]),
                    "high": float(row["High"]),
                    "low": float(row["Low"]),
                    "close": float(row["Close"]),
                    "volume": int(float(row["Volume"])),
                }
            )
        except (KeyError, ValueError):
            continue
    return bars


def upsert_us_equity(conn, symbol: str, name: str, bars: list[dict]) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO public.assets (ticker, name, asset_class, exchange, country, currency)
            VALUES (%s, %s, 'STOCK', 'NASDAQ', 'US', 'USD')
            ON CONFLICT (exchange, ticker) DO UPDATE SET name = EXCLUDED.name
            RETURNING id
            """,
            (symbol.upper(), name),
        )
        asset_id = cur.fetchone()[0]
        for b in bars:
            cur.execute(
                """
                INSERT INTO public.daily_ohlcv (asset_id, date, open, high, low, close, volume)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (asset_id, date) DO UPDATE SET
                    open = EXCLUDED.open, high = EXCLUDED.high,
                    low = EXCLUDED.low, close = EXCLUDED.close, volume = EXCLUDED.volume
                """,
                (asset_id, b["date"], b["open"], b["high"], b["low"], b["close"], b["volume"]),
            )
    conn.commit()
    return len(bars)


# --------------------------------------------------------------------------- #
# FRED: macro indicators
# --------------------------------------------------------------------------- #
def fetch_fred_series(series_id: str) -> list[tuple[date, float]]:
    resp = requests.get(FRED_CSV_URL.format(series=series_id), timeout=60)
    resp.raise_for_status()
    reader = csv.reader(io.StringIO(resp.text))
    header = next(reader, None)  # ['observation_date' or 'DATE', series_id]
    out: list[tuple[date, float]] = []
    for row in reader:
        if len(row) < 2 or row[1] in (".", ""):
            continue
        try:
            out.append((datetime.strptime(row[0], "%Y-%m-%d").date(), float(row[1])))
        except ValueError:
            continue
    _ = header
    return out


def upsert_macro(conn, series_id: str, points: list[tuple[date, float]]) -> int:
    indicator, unit = FRED_TO_INDICATOR[series_id]
    with conn.cursor() as cur:
        for d, v in points:
            cur.execute(
                """
                INSERT INTO public.macro_indicators (indicator_type, date, value, unit)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (indicator_type, date) DO UPDATE SET value = EXCLUDED.value
                """,
                (indicator, d, v, unit),
            )
    conn.commit()
    return len(points)


def main() -> None:
    dsn = os.environ["DATABASE_URL"]
    conn = psycopg2.connect(dsn, sslmode="require")
    try:
        sec = fetch_sec_ticker_map()
        for symbol in ("AAPL", "MSFT", "NVDA"):
            meta = sec.get(symbol, {"title": symbol})
            bars = fetch_us_ohlcv(symbol)
            print(f"{symbol}: upserted {upsert_us_equity(conn, symbol, meta['title'], bars)} bars")

        for series_id in FRED_TO_INDICATOR:
            pts = fetch_fred_series(series_id)
            print(f"{series_id}: upserted {upsert_macro(conn, series_id, pts)} macro points")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
