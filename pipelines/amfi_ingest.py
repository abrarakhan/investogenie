"""
InvestoGenie — Indian market ingestion (AMFI NAVs + NSE Bhavcopy).

Fetches and parses:
  • Mutual Fund NAVs from the AMFI open feed (NAVAll.txt) -> assets +
    mutual_fund_meta + daily_ohlcv (NAV stored as the daily close in INR).
  • NSE equity Bhavcopy (end-of-day OHLCV) -> assets + daily_ohlcv.

Writes are idempotent upserts into the Supabase Postgres schema defined in
supabase/migrations/. Run with the service-role connection string so the writes
bypass RLS:

    DATABASE_URL=postgresql://... python pipelines/amfi_ingest.py

Multi-currency note: every Indian instrument is persisted with currency='INR';
the analytical layer never assumes a single base currency.
"""

from __future__ import annotations

import csv
import io
import os
import zipfile
from dataclasses import dataclass
from datetime import date, datetime

import requests
import psycopg2
import psycopg2.extras

AMFI_NAV_URL = "https://www.amfiindia.com/spages/NAVAll.txt"
# NSE Bhavcopy (UDiFF format). Replace DDMMYYYY at call time.
NSE_BHAVCOPY_URL = (
    "https://nsearchives.nseindia.com/content/cm/"
    "BhavCopy_NSE_CM_0_0_0_{yyyymmdd}_F_0000.csv.zip"
)
HTTP_HEADERS = {"User-Agent": "InvestoGenie-Ingestor/1.0 (contact@investogenie.app)"}


@dataclass
class NavRow:
    amfi_code: str
    isin: str
    scheme_name: str
    nav: float
    nav_date: date
    plan_type: str  # 'DIRECT' | 'REGULAR'


# --------------------------------------------------------------------------- #
# AMFI mutual-fund NAVs
# --------------------------------------------------------------------------- #
def fetch_amfi_nav() -> list[NavRow]:
    """Download and parse AMFI's semicolon-delimited NAVAll feed.

    The file groups schemes under fund-house headers; data lines have the shape:
        Scheme Code;ISIN Div Payout;ISIN Div Reinvest;Scheme Name;NAV;Date
    """
    resp = requests.get(AMFI_NAV_URL, headers=HTTP_HEADERS, timeout=60)
    resp.raise_for_status()

    rows: list[NavRow] = []
    for line in resp.text.splitlines():
        parts = line.split(";")
        if len(parts) < 6 or parts[0].strip() == "Scheme Code":
            continue  # header / fund-house separator / blank
        code, isin_payout, _isin_reinvest, name, nav_raw, date_raw = parts[:6]
        try:
            nav = float(nav_raw)
            nav_date = datetime.strptime(date_raw.strip(), "%d-%b-%Y").date()
        except ValueError:
            continue  # 'N.A.' NAV or malformed date — skip
        plan = "DIRECT" if "direct" in name.lower() else "REGULAR"
        rows.append(
            NavRow(
                amfi_code=code.strip(),
                isin=isin_payout.strip(),
                scheme_name=name.strip(),
                nav=nav,
                nav_date=nav_date,
                plan_type=plan,
            )
        )
    return rows


def upsert_amfi(conn, rows: list[NavRow]) -> int:
    """Upsert funds into assets + mutual_fund_meta and the NAV into daily_ohlcv."""
    written = 0
    with conn.cursor() as cur:
        for r in rows:
            # 1) asset (one row per fund), keyed by (exchange='AMFI', ticker=code)
            cur.execute(
                """
                INSERT INTO public.assets (ticker, name, asset_class, exchange, country, currency)
                VALUES (%s, %s, 'MUTUAL_FUND', 'AMFI', 'IN', 'INR')
                ON CONFLICT (exchange, ticker) DO UPDATE SET name = EXCLUDED.name
                RETURNING id
                """,
                (r.amfi_code, r.scheme_name),
            )
            asset_id = cur.fetchone()[0]

            # 2) fund metadata (plan type drives DIRECT-plan optimization later)
            cur.execute(
                """
                INSERT INTO public.mutual_fund_meta (asset_id, amfi_code_in, plan_type)
                VALUES (%s, %s, %s)
                ON CONFLICT (asset_id) DO UPDATE SET plan_type = EXCLUDED.plan_type
                """,
                (asset_id, r.amfi_code, r.plan_type),
            )

            # 3) NAV as the day's close (volume/OI are not applicable to funds)
            cur.execute(
                """
                INSERT INTO public.daily_ohlcv (asset_id, date, open, high, low, close, volume)
                VALUES (%s, %s, %s, %s, %s, %s, NULL)
                ON CONFLICT (asset_id, date) DO UPDATE SET close = EXCLUDED.close
                """,
                (asset_id, r.nav_date, r.nav, r.nav, r.nav, r.nav),
            )
            written += 1
    conn.commit()
    return written


# --------------------------------------------------------------------------- #
# NSE equity Bhavcopy
# --------------------------------------------------------------------------- #
def fetch_nse_bhavcopy(trade_day: date) -> list[dict]:
    """Download and parse the NSE end-of-day Bhavcopy ZIP for a given day."""
    url = NSE_BHAVCOPY_URL.format(yyyymmdd=trade_day.strftime("%Y%m%d"))
    resp = requests.get(url, headers=HTTP_HEADERS, timeout=60)
    resp.raise_for_status()
    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        name = zf.namelist()[0]
        text = zf.read(name).decode("utf-8")
    reader = csv.DictReader(io.StringIO(text))
    out: list[dict] = []
    for row in reader:
        # UDiFF columns; only cash-segment equities (EQ-style series).
        if row.get("SctySrs", row.get("SERIES", "")).strip() not in ("EQ", "BE"):
            continue
        out.append(
            {
                "ticker": row.get("TckrSymb", row.get("SYMBOL", "")).strip(),
                "open": float(row.get("OpnPric", row.get("OPEN", 0)) or 0),
                "high": float(row.get("HghPric", row.get("HIGH", 0)) or 0),
                "low": float(row.get("LwPric", row.get("LOW", 0)) or 0),
                "close": float(row.get("ClsPric", row.get("CLOSE", 0)) or 0),
                "volume": int(float(row.get("TtlTradgVol", row.get("TOTTRDQTY", 0)) or 0)),
                "date": trade_day,
            }
        )
    return out


def upsert_bhavcopy(conn, bars: list[dict]) -> int:
    with conn.cursor() as cur:
        for b in bars:
            cur.execute(
                """
                INSERT INTO public.assets (ticker, name, asset_class, exchange, country, currency)
                VALUES (%s, %s, 'STOCK', 'NSE', 'IN', 'INR')
                ON CONFLICT (exchange, ticker) DO NOTHING
                """,
                (b["ticker"], b["ticker"]),
            )
            cur.execute(
                "SELECT id FROM public.assets WHERE exchange = 'NSE' AND ticker = %s",
                (b["ticker"],),
            )
            asset_id = cur.fetchone()[0]
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


def main() -> None:
    dsn = os.environ["DATABASE_URL"]
    conn = psycopg2.connect(dsn, sslmode="require")
    try:
        navs = fetch_amfi_nav()
        print(f"AMFI: parsed {len(navs)} NAV rows")
        print(f"AMFI: upserted {upsert_amfi(conn, navs)} funds")

        # Bhavcopy for the latest completed trading session (caller may loop dates).
        try:
            bars = fetch_nse_bhavcopy(date.today())
            print(f"Bhavcopy: upserted {upsert_bhavcopy(conn, bars)} equity bars")
        except requests.HTTPError as exc:
            print(f"Bhavcopy unavailable for today ({exc}); skipping.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
