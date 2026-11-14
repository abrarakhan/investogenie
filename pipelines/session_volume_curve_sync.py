#!/usr/bin/env python3
"""Build a versioned market-specific intraday cumulative-volume curve.

Only completed regular sessions are used. Each asset-session is normalized by its own full-day
volume; the stored point is the median normalized share across all eligible asset-sessions.
Armed Swing refuses to use a curve backed by fewer than 40 distinct sessions.
"""
from __future__ import annotations

import argparse
import json
import os
from collections import defaultdict
from datetime import datetime, time
from statistics import median
from zoneinfo import ZoneInfo

import psycopg2

POINTS = (0.0, 0.04, 0.12, 0.16, 0.28, 0.44, 0.60, 0.76, 0.92, 1.0)
CONFIG = {
    "IN": (ZoneInfo("Asia/Kolkata"), time(9, 15), time(15, 30)),
    "US": (ZoneInfo("America/New_York"), time(9, 30), time(16, 0)),
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--market", choices=("IN", "US"), required=True)
    parser.add_argument("--sessions", type=int, default=60)
    parser.add_argument("--activate", action="store_true")
    args = parser.parse_args()
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL is required")
    zone, opened, closed = CONFIG[args.market]
    open_seconds = opened.hour * 3600 + opened.minute * 60
    close_seconds = closed.hour * 3600 + closed.minute * 60
    duration = close_seconds - open_seconds

    with psycopg2.connect(database_url) as conn, conn.cursor() as cur:
        cur.execute(
            """select b.asset_id::text,b.bar_time,b.volume
                 from public.intraday_bars b join public.assets a on a.id=b.asset_id
                where a.country=%s and b.volume is not null and b.volume >= 0
                  and (b.bar_time at time zone %s)::date in (
                    select distinct (x.bar_time at time zone %s)::date
                      from public.intraday_bars x join public.assets ax on ax.id=x.asset_id
                     where ax.country=%s and (x.bar_time at time zone %s)::date < (now() at time zone %s)::date
                     order by 1 desc limit %s)
                order by b.asset_id,b.bar_time""",
            (args.market, zone.key, zone.key, args.market, zone.key, zone.key, args.sessions),
        )
        grouped: dict[tuple[str, str], list[tuple[float, float]]] = defaultdict(list)
        dates: set[str] = set()
        for asset_id, stamp, volume in cur.fetchall():
            local = stamp.astimezone(zone)
            if not (opened <= local.time() <= closed):
                continue
            local_seconds = local.hour * 3600 + local.minute * 60 + local.second
            progress = (local_seconds - open_seconds) / duration
            grouped[(asset_id, local.date().isoformat())].append((max(0.0, min(1.0, progress)), float(volume)))
            dates.add(local.date().isoformat())
        if len(dates) < 40:
            raise SystemExit(f"{args.market}: only {len(dates)} completed sessions; need at least 40")

        samples: list[list[float]] = []
        eligible_dates: set[str] = set()
        for (_, session_day), bars in grouped.items():
            # Do not let partial feeds shape the curve. A usable asset-session must cover the
            # opening and closing portions and contain at least half the expected one-minute bars.
            if len(bars) < 180 or min(progress for progress, _ in bars) > 0.08 or max(progress for progress, _ in bars) < 0.95:
                continue
            total = sum(volume for _, volume in bars)
            if total <= 0:
                continue
            samples.append([sum(volume for progress, volume in bars if progress <= point) / total for point in POINTS])
            eligible_dates.add(session_day)
        if len(eligible_dates) < 40 or len(samples) < len(eligible_dates) * 20:
            raise SystemExit(f"{args.market}: only {len(samples)} complete asset-sessions across {len(eligible_dates)} eligible dates")
        curve = [[point, median(sample[index] for sample in samples)] for index, point in enumerate(POINTS)]
        curve[0][1], curve[-1][1] = 0.0, 1.0
        version = f"{args.market.lower()}-median-{min(eligible_dates)}-{max(eligible_dates)}-{len(eligible_dates)}s"
        if args.activate:
            cur.execute("update public.market_volume_curves set active=false where market=%s", (args.market,))
        cur.execute(
            """insert into public.market_volume_curves
                 (market,version,sample_from,sample_through,sample_sessions,points,active)
               values (%s,%s,%s,%s,%s,%s::jsonb,%s)
               on conflict(version) do update set points=excluded.points,active=excluded.active,generated_at=now()""",
            (args.market, version, min(eligible_dates), max(eligible_dates), len(eligible_dates), json.dumps(curve), args.activate),
        )
        conn.commit()
        print(f"[volume-curve] {version}: {len(samples)} asset-sessions, active={args.activate}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
