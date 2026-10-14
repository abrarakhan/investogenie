#!/usr/bin/env python3
"""Synchronize past and scheduled company results dates for the entry blackout.

Armed Swing blocks new entries within three sessions of a results release. Coverage is not
assumed: each checked asset records a sync state, and the application treats an asset as
verified only after a successful check within seven days that returned a usable results date.

Capacity goes where entries can happen. Only NSE runs by default (US Armed Swing is fail-closed
without a US depth source), and each run checks, in order: open trades and pending buy-stops,
recent Armed plans, the live Armed shortlist (same prefilter as the page), then the rest of NSE
by oldest check. Assets checked in the last 20 hours are skipped, so two daily runs cycle the
whole NSE universe in about a day and the shortlist is never more than a day old.

    DATABASE_URL=postgresql://localhost:5432/investogenie \\
      python pipelines/corporate_results_sync.py --limit 1000
"""
from __future__ import annotations

import argparse
import csv
import os
import re
import time
from datetime import date, datetime, timedelta, timezone

import psycopg2

DEFAULT_DATABASE_URL = "postgresql://localhost:5432/investogenie"
KEEP_PAST_DAYS = 400
KEEP_FUTURE_DAYS = 200


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL))
    parser.add_argument("--limit", type=int, default=1000)
    parser.add_argument("--market", choices=["IN", "US"], default="IN",
                        help="IN checks NSE stocks; US only on explicit request")
    parser.add_argument("--recheck-hours", type=float, default=20.0,
                        help="Skip assets successfully checked within this many hours")
    parser.add_argument("--symbols", help="Comma-separated tickers for a targeted run")
    parser.add_argument(
        "--nse-calendar-csv",
        help="Import an official NSE corporate-events CSV instead of querying Yahoo",
    )
    parser.add_argument("--sleep", type=float, default=0.25)
    return parser.parse_args()


def yahoo_symbol(ticker: str, exchange: str, country: str) -> str:
    if country == "IN":
        return f"{ticker}.{'BO' if exchange == 'BSE' else 'NS'}"
    return ticker.replace("/", "-").replace(".", "-")


def as_date(value) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if hasattr(value, "to_pydatetime"):
        return value.to_pydatetime().date()
    return None


def usable_dates(values, today: date) -> list[date]:
    out = set()
    for value in values:
        parsed = as_date(value)
        if parsed and today - timedelta(days=KEEP_PAST_DAYS) <= parsed <= today + timedelta(days=KEEP_FUTURE_DAYS):
            out.add(parsed)
    return sorted(out)


def read_nse_calendar_csv(path: str, today: date) -> tuple[dict[str, list[date]], date, date, date]:
    """Read a complete NSE corporate-events snapshot and its authoritative date window."""
    events: dict[str, set[date]] = {}
    covered_dates: set[date] = set()
    with open(path, encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        for raw in reader:
            row = {(key or "").strip().upper(): (value or "").strip() for key, value in raw.items()}
            ticker = row.get("SYMBOL", "").upper()
            purpose = row.get("PURPOSE", "")
            details = row.get("DETAILS", "")
            raw_date = row.get("DATE", "")
            if not ticker:
                continue
            try:
                event_date = datetime.strptime(raw_date, "%d-%b-%Y").date()
            except ValueError as exc:
                raise ValueError(f"Invalid NSE calendar date for {ticker}: {raw_date!r}") from exc
            if today - timedelta(days=KEEP_PAST_DAYS) <= event_date <= today + timedelta(days=KEEP_FUTURE_DAYS):
                covered_dates.add(event_date)
                if "financial results" in f"{purpose} {details}".lower():
                    events.setdefault(ticker, set()).add(event_date)
    if not covered_dates:
        raise ValueError("NSE calendar contains no events in the supported date window")
    filename_date = re.search(r"(\d{2}-[A-Za-z]{3}-\d{4})", os.path.basename(path))
    as_of = datetime.strptime(filename_date.group(1), "%d-%b-%Y").date() if filename_date else today
    return (
        {ticker: sorted(dates) for ticker, dates in sorted(events.items())},
        as_of,
        min(covered_dates),
        max(covered_dates),
    )


def parse_nse_calendar_csv(path: str, today: date) -> dict[str, list[date]]:
    return read_nse_calendar_csv(path, today)[0]


def import_nse_calendar(conn, path: str, today: date) -> tuple[int, int, list[str]]:
    """Store authoritative NSE result dates using exact NSE ticker matches."""
    events, as_of, coverage_from, coverage_through = read_nse_calendar_csv(path, today)
    if not events:
        raise ValueError("NSE calendar contains no financial-results events in the supported date window")
    with conn.cursor() as cur:
        cur.execute(
            """select id::text,ticker from public.assets
                where country='IN' and exchange='NSE' and asset_class='STOCK'
                  and ticker=any(%s)""",
            (list(events),),
        )
        assets = {ticker: asset_id for asset_id, ticker in cur.fetchall()}
        imported = 0
        for ticker, dates in events.items():
            asset_id = assets.get(ticker)
            if not asset_id:
                continue
            for event_date in dates:
                cur.execute(
                    """insert into public.corporate_events (asset_id,event_type,event_date,source)
                       values (%s,'RESULTS',%s,'NSE_CALENDAR')
                       on conflict (asset_id,event_type,event_date)
                       do update set source='NSE_CALENDAR',fetched_at=now()""",
                    (asset_id, event_date),
                )
                imported += 1
            cur.execute(
                """insert into public.corporate_event_sync_state
                     (asset_id,last_attempt_at,last_success_at,error)
                   values (%s,now(),now(),null)
                   on conflict (asset_id) do update
                     set last_attempt_at=now(),last_success_at=now(),error=null""",
                (asset_id,),
            )
        # Explicitly approved policy: a complete same-day NSE export proves negative coverage
        # for absent symbols, but only inside the date window carried by that snapshot.
        cur.execute(
            """insert into public.corporate_event_sync_state
                 (asset_id,last_attempt_at,last_success_at,error,authoritative_source,
                  authoritative_as_of,authoritative_coverage_from,
                  authoritative_coverage_through,authoritative_imported_at)
               select id,now(),now(),null,'NSE_CALENDAR',%s,%s,%s,now()
                 from public.assets
                where country='IN' and exchange='NSE' and asset_class='STOCK' and is_active
               on conflict (asset_id) do update set
                 last_attempt_at=now(),last_success_at=now(),error=null,
                 authoritative_source='NSE_CALENDAR',authoritative_as_of=excluded.authoritative_as_of,
                 authoritative_coverage_from=excluded.authoritative_coverage_from,
                 authoritative_coverage_through=excluded.authoritative_coverage_through,
                 authoritative_imported_at=now()""",
            (as_of, coverage_from, coverage_through),
        )
    conn.commit()
    unmatched = sorted(set(events) - set(assets))
    return imported, len(assets), unmatched


def fetch_results_dates(symbol: str) -> list:
    import yfinance as yf

    ticker = yf.Ticker(symbol)
    values: list = []
    calendar = ticker.calendar
    if isinstance(calendar, dict):
        values.extend(calendar.get("Earnings Date") or [])
    try:
        history = ticker.get_earnings_dates(limit=8)
        if history is not None:
            values.extend(list(history.index))
    except Exception:  # history is a supplement; the calendar alone is still a valid check
        pass
    return values


# Priority tiers, lowest first. Mirrors lib/armedSwing.ts: price >= floor, 20-session average
# traded value >= floor, and price within 10% of the 20-session pivot.
SELECTION_SQL = """
with universe as materialized (
  select a.id, a.ticker, coalesce(a.exchange,'') exchange, a.country
    from public.assets a
   where a.asset_class='STOCK' and a.is_active and {universe}
     and not exists (select 1 from public.asset_tracking_exclusions x where x.asset_id=a.id)
     {symbol_filter}
), recent as materialized (
  select u.id asset_id, max(o.high) pivot, avg(o.close*o.volume) traded_value20,
         (array_agg(o.close order by o.date desc))[1] last_close
    from universe u
    cross join lateral (
      select d.date,d.high,d.close,d.volume from public.daily_ohlcv d
       where d.asset_id=u.id order by d.date desc limit 20
    ) o
   group by u.id
), tiers as (
  select u.*,
    case
      when exists (select 1 from public.swing_trade_ledger l where l.asset_id=u.id and l.status='OPEN')
        or exists (select 1 from public.swing_pending_orders p where p.asset_id=u.id and p.status='PENDING') then 0
      when exists (select 1 from public.armed_swing_plans ap where ap.asset_id=u.id and ap.captured_at > now() - interval '3 days') then 1
      when r.pivot > 0 and coalesce(q.price,r.last_close) >= %(price_floor)s
       and r.traded_value20 >= %(liquidity_floor)s
       and coalesce(q.price,r.last_close) between r.pivot*0.90 and r.pivot*1.05 then 2
      else 3
    end tier,
    s.last_success_at
    from universe u
    left join recent r on r.asset_id=u.id
    left join public.latest_quotes q on q.asset_id=u.id
    left join public.corporate_event_sync_state s on s.asset_id=u.id
)
select id::text, ticker, exchange, country, tier
  from tiers
 where last_success_at is null or last_success_at < now() - make_interval(secs => %(recheck_seconds)s)
 order by tier, last_success_at nulls first, ticker
 limit %(limit)s
"""

MARKET_CONFIG = {
    "IN": {"universe": "a.country='IN' and a.exchange='NSE'", "price_floor": 20, "liquidity_floor": 10_000_000},
    "US": {"universe": "a.country='US' and a.exchange in ('NASDAQ','NYSE','AMEX','NYSEARCA','NYSEAMERICAN')",
           "price_floor": 5, "liquidity_floor": 1_000_000},
}


def select_assets(conn, market: str, symbols: list[str] | None, limit: int, recheck_hours: float):
    config = MARKET_CONFIG[market]
    params: dict[str, object] = {
        "price_floor": config["price_floor"], "liquidity_floor": config["liquidity_floor"],
        "recheck_seconds": max(0.0, recheck_hours) * 3600, "limit": max(1, limit),
    }
    symbol_filter = ""
    if symbols:
        symbol_filter = "and a.ticker = any(%(symbols)s)"
        params["symbols"] = symbols
    with conn.cursor() as cur:
        cur.execute(SELECTION_SQL.format(universe=config["universe"], symbol_filter=symbol_filter), params)
        return cur.fetchall()


# Must match resultsCalendarCoverage() in lib/analytics/armedSwing.ts: a successful check within
# 7 days of the market's date AND either an upcoming results date or one within the last 70 days.
# A successful request that returned no usable date is NOT coverage.
VERIFIED_MAX_CHECK_AGE_DAYS = 7
VERIFIED_RECENT_RESULTS_DAYS = 70
MARKET_TIMEZONE = {"IN": "Asia/Kolkata", "US": "America/New_York"}

COVERAGE_SQL = """
with today as (select (now() at time zone %(tz)s)::date d)
select
  count(*) filter (where s.last_success_at >= ((select d from today)::timestamp at time zone 'UTC')
                                              - make_interval(days => %(check_days)s)) checked,
  count(*) filter (where s.last_success_at >= ((select d from today)::timestamp at time zone 'UTC')
                                              - make_interval(days => %(check_days)s)
                     and ((s.authoritative_source='NSE_CALENDAR'
                           and s.authoritative_as_of=(select d from today)
                           and s.authoritative_coverage_from <= (select d from today) + 1
                           and s.authoritative_coverage_through >= (select d from today) + 7)
                          or exists (select 1 from public.corporate_events e
                                   where e.asset_id=a.id and e.event_type='RESULTS'
                                     and e.event_date >= (select d from today))
                          or exists (select 1 from public.corporate_events e
                                      where e.asset_id=a.id and e.event_type='RESULTS'
                                        and e.event_date < (select d from today)
                                        and e.event_date >= (select d from today) - %(recent_days)s))) verified,
  count(*) total
  from public.assets a
  left join public.corporate_event_sync_state s on s.asset_id=a.id
 where a.asset_class='STOCK' and a.is_active and {universe}
"""


def coverage(conn, market: str) -> tuple[int, int, int]:
    """(checked within 7 days, verified by the app's rule, active universe) for monitoring."""
    with conn.cursor() as cur:
        cur.execute(COVERAGE_SQL.format(universe=MARKET_CONFIG[market]["universe"]), {
            "tz": MARKET_TIMEZONE[market],
            "check_days": VERIFIED_MAX_CHECK_AGE_DAYS,
            "recent_days": VERIFIED_RECENT_RESULTS_DAYS,
        })
        checked, verified, total = cur.fetchone()
    return int(checked), int(verified), int(total)


def store(conn, asset_id: str, dates: list[date]) -> None:
    today = datetime.now(timezone.utc).date()
    with conn.cursor() as cur:
        # Scheduled dates move; replace the future window with what the provider says now.
        # Yahoo dates move, but a Yahoo refresh must never erase an authoritative NSE import.
        cur.execute("""delete from public.corporate_events
                        where asset_id=%s and event_type='RESULTS' and source='YAHOO'
                          and event_date >= %s""", (asset_id, today))
        for event_date in dates:
            cur.execute("""
                insert into public.corporate_events (asset_id,event_type,event_date,source)
                values (%s,'RESULTS',%s,'YAHOO')
                on conflict (asset_id,event_type,event_date) do update set fetched_at=now()
            """, (asset_id, event_date))
        cur.execute("""
            insert into public.corporate_event_sync_state (asset_id,last_attempt_at,last_success_at,error)
            values (%s,now(),now(),null)
            on conflict (asset_id) do update set last_attempt_at=now(),last_success_at=now(),error=null
        """, (asset_id,))
    conn.commit()


def record_failure(conn, asset_id: str, error: str) -> None:
    conn.rollback()
    with conn.cursor() as cur:
        cur.execute("""
            insert into public.corporate_event_sync_state (asset_id,last_attempt_at,error)
            values (%s,now(),%s)
            on conflict (asset_id) do update set last_attempt_at=now(),error=excluded.error
        """, (asset_id, error[:500]))
    conn.commit()


def main() -> int:
    args = parse_args()
    symbols = [s.strip().upper() for s in args.symbols.split(",")] if args.symbols else None
    today = datetime.now(timezone.utc).date()
    with psycopg2.connect(args.database_url) as conn:
        if args.nse_calendar_csv:
            imported, matched, unmatched = import_nse_calendar(conn, args.nse_calendar_csv, today)
            checked, verified, total = coverage(conn, "IN")
            print(
                f"[corporate-results] NSE calendar: imported {imported} dates for {matched} symbols; "
                f"unmatched {len(unmatched)}; verified {verified}/{total}",
                flush=True,
            )
            if unmatched:
                print(f"[corporate-results] unmatched NSE symbols: {','.join(unmatched)}", flush=True)
            return 0
        assets = select_assets(conn, args.market, symbols, args.limit, args.recheck_hours)
        failures = 0
        for asset_id, ticker, exchange, country, _tier in assets:
            try:
                store(conn, asset_id, usable_dates(fetch_results_dates(yahoo_symbol(ticker, exchange, country)), today))
            except Exception as exc:  # provider gaps are expected; the asset stays unverified
                failures += 1
                record_failure(conn, asset_id, str(exc))
            time.sleep(args.sleep)
        tiers = [row[4] for row in assets]
        checked, verified, total = coverage(conn, args.market)
        pct = lambda part: (100 * part / total) if total else 0
        print(
            f"[corporate-results] {args.market}: checked {len(assets) - failures}/{len(assets)} "
            f"(open/pending {tiers.count(0)}, armed plans {tiers.count(1)}, shortlist {tiers.count(2)}, rotation {tiers.count(3)}); "
            f"verified {verified}/{total} ({pct(verified):.0f}%) — requested within 7 days {checked}/{total} ({pct(checked):.0f}%), "
            f"of which {checked - verified} returned no usable results date",
            flush=True,
        )
        # Verified coverage is what unblocks entries; request success alone is not coverage.
        if total and verified / total < 0.9:
            print("[corporate-results] WARNING: verified results coverage below 90%; those stocks stay blocked", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
