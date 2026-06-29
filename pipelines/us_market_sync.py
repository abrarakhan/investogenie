#!/usr/bin/env python3
"""Synchronize US quotes and company financials into local PostgreSQL.

Quotes are fetched in Yahoo Finance batches. Symbols without a usable Yahoo
close fall back to Google Finance, with a configurable cap to avoid hammering
the provider. Financial statements are refreshed only when missing or stale.
Monetary statement values are stored in USD millions; Indian values remain in
Rs. crore through stock_fundamentals_sync.py.
"""

from __future__ import annotations

import argparse
import os
import re
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
import requests
import yfinance as yf

from stock_fundamentals_sync import CompanyState, fetch_company, upsert_reports


DEFAULT_DATABASE_URL = "postgresql://localhost:5432/investogenie"
USD_MILLION = 1_000_000
GOOGLE_URL = "https://www.google.com/finance/quote/{ticker}:{exchange}?hl=en"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 Chrome/120 Safari/537.36"
    )
}
GOOGLE_EXCHANGE = {
    "NASDAQ": "NASDAQ",
    "NYSE": "NYSE",
    "AMEX": "NYSEAMERICAN",
    "CBOE": "BATS",
    "OTC": "OTCMKTS",
}


@dataclass(frozen=True)
class USAsset:
    asset_id: str
    ticker: str
    exchange: str
    yahoo_symbol: str


@dataclass(frozen=True)
class Quote:
    price: float
    change_pct: float | None
    as_of: date | None
    source: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--database-url",
        default=os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL),
    )
    parser.add_argument("--symbols", help="Comma-separated US tickers")
    parser.add_argument("--quotes-only", action="store_true")
    parser.add_argument("--fundamentals-only", action="store_true")
    parser.add_argument("--quote-limit", type=int)
    parser.add_argument("--quote-batch-size", type=int, default=100)
    parser.add_argument("--google-fallback-limit", type=int, default=100)
    parser.add_argument("--fundamentals-limit", type=int, default=250)
    parser.add_argument("--stale-days", type=int, default=7)
    parser.add_argument("--sleep", type=float, default=0.4)
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument("--force-fundamentals", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def yahoo_symbol(ticker: str) -> str:
    return ticker.replace("/", "-").replace(".", "-")


def requested_symbols(raw: str | None) -> set[str] | None:
    if not raw:
        return None
    return {symbol.strip().upper() for symbol in raw.split(",") if symbol.strip()}


def load_assets(conn, requested: set[str] | None, limit: int | None) -> list[USAsset]:
    params: list[object] = []
    filters = ["a.country='US'", "a.asset_class='STOCK'", "a.is_active=true"]
    if requested:
        filters.append("a.ticker=any(%s)")
        params.append(sorted(requested))
    limit_sql = ""
    if limit is not None:
        params.append(max(1, limit))
        limit_sql = "limit %s"

    with conn.cursor() as cur:
        cur.execute(
            f"""
            select a.id::text,a.ticker,a.exchange
              from public.assets a
              left join public.latest_quotes q on q.asset_id=a.id
              left join public.quote_sync_state s
                on s.asset_id=a.id and s.provider='YAHOO_GOOGLE_US'
             where {' and '.join(filters)}
             order by s.last_attempt_at nulls first,
                      coalesce(q.updated_at,timestamptz '1900-01-01'),a.ticker,a.exchange
             {limit_sql}
            """,
            params,
        )
        return [
            USAsset(row[0], row[1], row[2] or "", yahoo_symbol(row[1]))
            for row in cur.fetchall()
        ]


def quote_from_section(section: pd.DataFrame) -> Quote | None:
    if section.empty or "Close" not in section.columns:
        return None
    closes = pd.to_numeric(section["Close"], errors="coerce").dropna()
    closes = closes[closes > 0]
    if closes.empty:
        return None
    price = float(closes.iloc[-1])
    previous = float(closes.iloc[-2]) if len(closes) > 1 else None
    change_pct = (
        (price - previous) / previous * 100
        if previous is not None and previous != 0
        else None
    )
    timestamp = pd.Timestamp(closes.index[-1])
    return Quote(price, change_pct, timestamp.date(), "YAHOO_FINANCE")


def fetch_yahoo_batch(symbols: list[str], retries: int) -> dict[str, Quote]:
    if not symbols:
        return {}
    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            frame = yf.download(
                tickers=symbols,
                period="5d",
                interval="1d",
                group_by="ticker",
                auto_adjust=False,
                actions=False,
                progress=False,
                threads=True,
                timeout=30,
            )
            result: dict[str, Quote] = {}
            if not isinstance(frame.columns, pd.MultiIndex):
                if len(symbols) == 1:
                    quote = quote_from_section(frame)
                    if quote:
                        result[symbols[0]] = quote
                return result
            available = set(frame.columns.get_level_values(0))
            for symbol in symbols:
                if symbol not in available:
                    continue
                quote = quote_from_section(frame[symbol])
                if quote:
                    result[symbol] = quote
            return result
        except Exception as exc:
            last_error = exc
            if attempt < retries:
                time.sleep(2 ** (attempt - 1))
    print(f"   Yahoo batch failed: {last_error}")
    return {}


def fetch_google_quote(asset: USAsset) -> Quote:
    exchange = GOOGLE_EXCHANGE.get(asset.exchange, asset.exchange)
    if not exchange:
        raise ValueError("unsupported exchange")
    response = requests.get(
        GOOGLE_URL.format(ticker=asset.ticker, exchange=exchange),
        headers=HEADERS,
        timeout=30,
    )
    response.raise_for_status()
    symbol = re.escape(f'{asset.ticker}:{exchange}')
    match = re.search(
        rf'([-+0-9.E]+),2,([-+0-9.E]+),2,([-+0-9.E]+),2,"USD","{symbol}"',
        response.text,
    )
    if not match:
        raise ValueError("Google Finance quote data was not found")
    price = float(match.group(1))
    change_pct = float(match.group(3))
    if price <= 0:
        raise ValueError(f"invalid Google Finance price {price}")
    return Quote(price, change_pct, date.today(), "GOOGLE_FINANCE")


def upsert_quotes(conn, rows: list[tuple]) -> int:
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
            rows,
            page_size=500,
        )
    conn.commit()
    return len(rows)


def record_quote_attempts(
    conn,
    assets: list[USAsset],
    succeeded: set[str],
    errors: dict[str, str],
) -> None:
    attempted_at = datetime.now(timezone.utc)
    rows = [
        (
            asset.asset_id,
            "YAHOO_GOOGLE_US",
            attempted_at,
            attempted_at if asset.asset_id in succeeded else None,
            None if asset.asset_id in succeeded else errors.get(asset.asset_id, "quote unavailable"),
        )
        for asset in assets
    ]
    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            insert into public.quote_sync_state
              (asset_id,provider,last_attempt_at,last_success_at,last_error)
            values %s
            on conflict (asset_id,provider) do update set
              last_attempt_at=excluded.last_attempt_at,
              last_success_at=coalesce(excluded.last_success_at,public.quote_sync_state.last_success_at),
              last_error=excluded.last_error
            """,
            rows,
            page_size=500,
        )
    conn.commit()


def sync_quotes(conn, args: argparse.Namespace, requested: set[str] | None) -> None:
    assets = load_assets(conn, requested, args.quote_limit)
    by_yahoo: dict[str, list[USAsset]] = {}
    for asset in assets:
        by_yahoo.setdefault(asset.yahoo_symbol, []).append(asset)
    symbols = list(by_yahoo)
    batch_size = max(1, args.quote_batch_size)
    yahoo_quotes: dict[str, Quote] = {}
    print(f"Synchronizing quotes for {len(assets)} US listings ({len(symbols)} Yahoo symbols).")
    for start in range(0, len(symbols), batch_size):
        batch = symbols[start : start + batch_size]
        yahoo_quotes.update(fetch_yahoo_batch(batch, max(1, args.retries)))
        print(f"   Yahoo batch {start // batch_size + 1}: {len(yahoo_quotes)}/{len(symbols)} resolved")

    rows: list[tuple] = []
    unresolved: list[USAsset] = []
    succeeded: set[str] = set()
    errors: dict[str, str] = {}
    for symbol, symbol_assets in by_yahoo.items():
        quote = yahoo_quotes.get(symbol)
        if quote:
            for asset in symbol_assets:
                rows.append(
                    (asset.asset_id, quote.price, quote.change_pct, "USD", quote.as_of, quote.source)
                )
                succeeded.add(asset.asset_id)
        else:
            unresolved.extend(symbol_assets)
            for asset in symbol_assets:
                errors[asset.asset_id] = "Yahoo quote unavailable"

    google_resolved = 0
    google_failed = 0
    for asset in unresolved[: max(0, args.google_fallback_limit)]:
        try:
            quote = fetch_google_quote(asset)
            rows.append(
                (asset.asset_id, quote.price, quote.change_pct, "USD", quote.as_of, quote.source)
            )
            succeeded.add(asset.asset_id)
            errors.pop(asset.asset_id, None)
            google_resolved += 1
        except Exception as exc:
            google_failed += 1
            errors[asset.asset_id] = f"Yahoo unavailable; Google: {exc}"[:1000]
            print(f"   Google fallback {asset.ticker}@{asset.exchange}: {exc}")
        if args.sleep > 0:
            time.sleep(args.sleep)

    written = 0
    if not args.dry_run:
        written = upsert_quotes(conn, rows)
        record_quote_attempts(conn, assets, succeeded, errors)
    print(
        "US quote sync complete: "
        f"listings={len(assets)} yahoo={len(rows) - google_resolved} "
        f"google={google_resolved} google_failed={google_failed} "
        f"unresolved={max(0, len(unresolved) - google_resolved)} written={written}"
    )


def load_companies(
    conn,
    requested: set[str] | None,
    limit: int | None,
    stale_days: int,
    force: bool,
) -> list[CompanyState]:
    params: list[object] = []
    filters = ["a.country='US'", "a.asset_class='STOCK'", "a.is_active=true"]
    if requested:
        filters.append("a.ticker=any(%s)")
        params.append(sorted(requested))
    freshness = ""
    if not force:
        params.append(datetime.now(timezone.utc) - timedelta(days=max(0, stale_days)))
        freshness = "having not bool_and(f.asset_id is not null) or min(f.last_updated) < %s"
    limit_sql = ""
    if limit is not None:
        params.append(max(1, limit))
        limit_sql = "limit %s"
    with conn.cursor() as cur:
        cur.execute(
            f"""
            with coverage as (
              select asset_id,max(updated_at) last_updated
                from public.asset_financial_reports
               group by asset_id
            )
            select a.ticker,array_agg(a.id::text),min(f.last_updated),
                   bool_and(f.asset_id is not null) fully_covered
              from public.assets a
              left join coverage f on f.asset_id=a.id
              left join public.fundamentals_sync_state s
                on s.country='US' and s.ticker=a.ticker and s.provider='YAHOO_FINANCE_US'
             where {' and '.join(filters)}
             group by a.ticker,s.last_attempt_at
             {freshness}
             order by s.last_attempt_at nulls first,
                      coalesce(min(f.last_updated),timestamptz '1900-01-01'),a.ticker
             {limit_sql}
            """,
            params,
        )
        return [
            CompanyState(
                ticker=row[0],
                yahoo_symbol=yahoo_symbol(row[0]),
                asset_ids=tuple(row[1]),
                last_updated=row[2],
                fully_covered=bool(row[3]),
            )
            for row in cur.fetchall()
        ]


def record_fundamentals_attempt(
    conn,
    ticker: str,
    success: bool,
    error: str | None = None,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into public.fundamentals_sync_state
              (country,ticker,provider,last_attempt_at,last_success_at,last_error)
            values ('US',%s,'YAHOO_FINANCE_US',now(),
                    case when %s then now() else null end,%s)
            on conflict (country,ticker,provider) do update set
              last_attempt_at=excluded.last_attempt_at,
              last_success_at=case
                when %s then now()
                else public.fundamentals_sync_state.last_success_at
              end,
              last_error=excluded.last_error
            """,
            (ticker, success, error, success),
        )
    conn.commit()


def sync_fundamentals(conn, args: argparse.Namespace, requested: set[str] | None) -> None:
    companies = load_companies(
        conn,
        requested,
        None if requested else args.fundamentals_limit,
        args.stale_days,
        args.force_fundamentals,
    )
    print(f"Synchronizing fundamentals for {len(companies)} US companies.")
    covered = 0
    reports_written = 0
    failed = 0
    for index, state in enumerate(companies, 1):
        print(f"[{index}/{len(companies)}] {state.ticker} ({state.yahoo_symbol})")
        try:
            reports, info = fetch_company(
                state,
                max(1, args.retries),
                monetary_divisor=USD_MILLION,
            )
            count = 0 if args.dry_run else upsert_reports(
                conn,
                state,
                reports,
                info,
                monetary_divisor=USD_MILLION,
                default_currency="USD",
                source="YAHOO_FINANCE_US",
            )
            covered += 1
            reports_written += count
            if not args.dry_run:
                record_fundamentals_attempt(conn, state.ticker, True)
            print(f"   upserted {len(reports)} reports")
        except Exception as exc:
            conn.rollback()
            failed += 1
            if not args.dry_run:
                record_fundamentals_attempt(conn, state.ticker, False, str(exc)[:1000])
            print(f"   ERROR: {exc}")
        if index < len(companies) and args.sleep > 0:
            time.sleep(args.sleep)
    print(
        "US fundamentals sync complete: "
        f"companies={len(companies)} covered={covered} "
        f"reports_written={reports_written} failed={failed}"
    )


def main() -> None:
    args = parse_args()
    if args.quotes_only and args.fundamentals_only:
        raise SystemExit("choose only one of --quotes-only or --fundamentals-only")
    requested = requested_symbols(args.symbols)
    conn = psycopg2.connect(args.database_url)
    try:
        if not args.fundamentals_only:
            sync_quotes(conn, args, requested)
        if not args.quotes_only:
            sync_fundamentals(conn, args, requested)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
