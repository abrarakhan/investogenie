#!/usr/bin/env python3
"""Import point-in-time NSE shareholding-pattern filings.

The NSE master feed is the filing index shown on its corporate-filings page.
Only rows carrying an explicit promoter percentage are accepted; missing or
unrecognised data fails closed instead of being inferred.
"""
from __future__ import annotations

import argparse
import csv
import os
import re
from datetime import date, datetime, timedelta, timezone

import psycopg2
import requests
from psycopg2.extras import execute_values

API_URL = "https://www.nseindia.com/api/corporate-share-holdings-master"
REFERER = "https://www.nseindia.com/companies-listing/corporate-filings-shareholding-pattern"


def key(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def parse_date(value: str | None) -> date | None:
    if not value:
        return None
    text = value.strip()
    for fmt in ("%d-%b-%Y", "%d-%m-%Y", "%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(text[:11], fmt).date()
        except ValueError:
            pass
    return None


def parse_timestamp(value: str | None, fallback: date) -> datetime:
    if value:
        cleaned = value.strip().replace("Z", "+00:00")
        try:
            parsed = datetime.fromisoformat(cleaned)
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            parsed_date = parse_date(value)
            if parsed_date:
                return datetime.combine(parsed_date, datetime.min.time(), timezone.utc)
    return datetime.combine(fallback, datetime.min.time(), timezone.utc)


def numeric(value) -> float | None:
    if value is None:
        return None
    try:
        number = float(str(value).replace(",", "").replace("%", "").strip())
        return number if 0 <= number <= 100 else None
    except ValueError:
        return None


def first(row: dict, aliases: tuple[str, ...]):
    normalized = {key(str(k)): v for k, v in row.items()}
    for alias in aliases:
        if key(alias) in normalized:
            return normalized[key(alias)]
    return None


def parse_filing(row: dict) -> dict | None:
    symbol = str(first(row, ("symbol", "nseSymbol")) or "").strip().upper()
    period = parse_date(str(first(row, ("date", "asOnDate", "periodEndDate")) or ""))
    promoter = numeric(first(row, (
        "promoterAndPromoterGroup", "promoterPromoterGroup", "promoterHolding",
        "promoterHoldingPct", "promoterPercentage", "Promoter & Promoter Group",
        "Promoter & Promoter Group (A)", "pr_and_prgrp",
    )))
    if not symbol or not period or promoter is None:
        return None
    public = numeric(first(row, ("public", "publicShareholding", "publicHoldingPct", "public_val")))
    submission = first(row, ("submissionDate", "broadcastDate", "disclosedAt"))
    source_url = first(row, ("xbrl", "xbrlFileLink", "sourceUrl"))
    return {
        "symbol": symbol, "period": period,
        "disclosed_at": parse_timestamp(str(submission or ""), period),
        "promoter": promoter, "public": public,
        "source_url": str(source_url) if source_url else None,
    }


def nse_rows(days: int) -> list[dict]:
    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        "Accept": "application/json,text/plain,*/*", "Referer": REFERER,
    })
    session.get("https://www.nseindia.com/", timeout=30)
    today = date.today()
    response = session.get(API_URL, params={
        "index": "equities",
        "from_date": (today - timedelta(days=days)).strftime("%d-%m-%Y"),
        "to_date": today.strftime("%d-%m-%Y"),
    }, timeout=60)
    response.raise_for_status()
    body = response.json()
    if not isinstance(body, list):
        raise RuntimeError("NSE shareholding feed returned an unexpected shape")
    return body


def csv_rows(path: str) -> list[dict]:
    with open(path, encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=120)
    parser.add_argument("--csv", help="Official NSE Download CSV, useful when the website blocks automation")
    args = parser.parse_args()
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL is required")
    raw = csv_rows(args.csv) if args.csv else nse_rows(args.days)
    parsed = [filing for row in raw if (filing := parse_filing(row))]
    if not parsed:
        raise SystemExit("No explicit promoter-holding rows were found; refusing an empty/guessed import")
    conn = psycopg2.connect(database_url)
    try:
        symbols = sorted({row["symbol"] for row in parsed})
        with conn.cursor() as cur:
            cur.execute(
                """select distinct on (upper(ticker)) upper(ticker),id::text
                     from public.assets where country='IN' and exchange='NSE' and upper(ticker)=any(%s)
                    order by upper(ticker),is_active desc,created_at""",
                (symbols,),
            )
            assets = dict(cur.fetchall())
            payload = [(
                assets[row["symbol"]], row["period"], row["disclosed_at"],
                row["promoter"], row["public"], "NSE_SHAREHOLDING_PATTERN", row["source_url"],
            ) for row in parsed if row["symbol"] in assets]
            if not payload:
                raise RuntimeError("Shareholding filings did not match any active NSE asset")
            execute_values(cur, """insert into public.asset_shareholding_reports
                (asset_id,period_end_date,disclosed_at,promoter_holding_pct,public_holding_pct,source,source_url)
                values %s on conflict(asset_id,period_end_date) do update set
                  disclosed_at=excluded.disclosed_at,promoter_holding_pct=excluded.promoter_holding_pct,
                  public_holding_pct=excluded.public_holding_pct,source=excluded.source,
                  source_url=excluded.source_url,imported_at=now()""", payload, page_size=1000)
        conn.commit()
        print(f"[shareholding-sync] imported={len(payload)} parsed={len(parsed)} source_rows={len(raw)}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
