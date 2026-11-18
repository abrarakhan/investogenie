#!/usr/bin/env python3
"""Small read-only operations report for Mid-Way Momentum v2."""
import os

import psycopg2


def main() -> None:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL is required")
    conn = psycopg2.connect(database_url)
    try:
        with conn.cursor() as cur:
            cur.execute("""select min(date)::text,max(date)::text,count(distinct date),count(*)
                from public.daily_delivery_metrics where not is_etf""")
            first_day, last_day, sessions, rows = cur.fetchone()
            cur.execute("""select max(o.date)::text from public.daily_ohlcv o join public.assets a on a.id=o.asset_id
                where a.exchange='NSE' and a.asset_class='STOCK'""")
            latest_ohlcv = cur.fetchone()[0]
            cur.execute("""select asof_market_date::text,feature_version,coalesce(setup_variant,'LEGACY'),status,count(*)
                from public.trend_continuation_signals
                where asof_market_date=(select max(asof_market_date) from public.trend_continuation_signals where market='IN')
                group by asof_market_date,feature_version,coalesce(setup_variant,'LEGACY'),status
                order by 3,4""")
            signals = cur.fetchall()
            cur.execute("""select method,status,count(*) from public.forward_test_positions
                where method like 'ENGINE:MIDWAY_%' group by method,status order by method,status""")
            forward = cur.fetchall()
    finally:
        conn.close()
    print(f"Delivery: {first_day} .. {last_day} | {sessions} sessions | {rows} rows")
    print(f"NSE OHLCV latest: {latest_ohlcv}")
    print("Latest persisted signals:")
    if not signals:
        print("  none")
    for day, version, variant, status, count in signals:
        print(f"  {day} | {version} | {variant} | {status}: {count}")
    print("Forward observations:")
    if not forward:
        print("  none yet")
    for method, status, count in forward:
        print(f"  {method} | {status}: {count}")


if __name__ == "__main__":
    main()
