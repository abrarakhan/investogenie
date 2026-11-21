#!/usr/bin/env python3
"""Point-in-time EOD replay for the three Mid-Way Momentum v2 variants.

The production detector remains authoritative: this script imports its feature
functions instead of reimplementing them.  It uses only delivery/results/index
facts available on each signal date, enters on a later bar crossing the frozen
trigger, and gives the stop priority when one bar touches stop and target.

Recent material filings are not historically snapshotted with a complete
authoritative taxonomy, so the replay awards EP only to point-in-time RESULTS
events.  That is deliberately conservative and is printed in the report.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import statistics
from collections import defaultdict
from dataclasses import asdict, dataclass
from datetime import date, timedelta

import psycopg2

try:
    from pipelines.trend_continuation import (
        Bar, CATALYST_EP, CATALYST_TECH, DeliveryDay, DeliveryHistory,
        SETUP_STAIR_STEP, _ema, _simple_average, assess_midway,
        midway_breakout_levels, midway_geometry,
    )
except ModuleNotFoundError:  # direct execution: python pipelines/midway_replay.py
    from trend_continuation import (
        Bar, CATALYST_EP, CATALYST_TECH, DeliveryDay, DeliveryHistory,
        SETUP_STAIR_STEP, _ema, _simple_average, assess_midway,
        midway_breakout_levels, midway_geometry,
    )


@dataclass(frozen=True)
class Outcome:
    ticker: str
    variant: str
    signal_date: str
    fill_date: str | None
    status: str
    entry: float
    stop: float
    target: float
    exit_date: str | None
    net_return_pct: float | None


def session_distance(sessions: list[str], earlier: str, later: str) -> int | None:
    try:
        return sessions.index(later) - sessions.index(earlier)
    except ValueError:
        return None


def grade(ticker: str, variant: str, signal_date: str, entry: float, stop: float,
          target: float, future: list[Bar], fill_window: int, horizon: int,
          cost_bps: float) -> Outcome:
    fill_index = next((i for i, bar in enumerate(future[:fill_window]) if bar.high >= entry), None)
    if fill_index is None:
        return Outcome(ticker, variant, signal_date, None, "UNFILLED", entry, stop, target, None, None)
    fill_date = future[fill_index].date
    exit_price, exit_date, status = None, None, "OPEN"
    held = future[fill_index:fill_index + horizon]
    for bar in held:
        if bar.low <= stop:  # conservative when the same daily bar touches both
            exit_price, exit_date, status = stop, bar.date, "STOP_HIT"
            break
        if bar.high >= target:
            exit_price, exit_date, status = target, bar.date, "TARGET_HIT"
            break
    if exit_price is None and len(held) >= horizon:
        exit_price, exit_date, status = held[-1].close, held[-1].date, "EXPIRED"
    net = None if exit_price is None else ((exit_price / entry - 1.0) * 100.0 - cost_bps / 100.0)
    return Outcome(ticker, variant, signal_date, fill_date, status, entry, stop, target, exit_date, net)


def summarize(rows: list[Outcome]) -> dict:
    filled = [row for row in rows if row.fill_date]
    closed = [row for row in filled if row.net_return_pct is not None]
    returns = [row.net_return_pct for row in closed if row.net_return_pct is not None]
    return {
        "signals": len(rows), "filled": len(filled), "closed": len(closed),
        "unfilled": sum(row.status == "UNFILLED" for row in rows),
        "targets": sum(row.status == "TARGET_HIT" for row in rows),
        "stops": sum(row.status == "STOP_HIT" for row in rows),
        "expired": sum(row.status == "EXPIRED" for row in rows),
        "win_rate_pct": round(100 * sum(value > 0 for value in returns) / len(returns), 2) if returns else None,
        "avg_net_return_pct": round(statistics.fmean(returns), 3) if returns else None,
        "median_net_return_pct": round(statistics.median(returns), 3) if returns else None,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", required=True)
    parser.add_argument("--end", required=True)
    parser.add_argument("--cost-bps", type=float, default=35.0)
    parser.add_argument("--fill-window", type=int, default=3)
    parser.add_argument("--json", action="store_true")
    options = parser.parse_args()
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL is required")
    start, end = date.fromisoformat(options.start), date.fromisoformat(options.end)
    load_from, load_through = start - timedelta(days=420), end + timedelta(days=30)

    conn = psycopg2.connect(database_url)
    try:
        with conn.cursor() as cur:
            cur.execute("""select distinct d.asset_id::text,a.ticker
                from public.daily_delivery_metrics d join public.assets a on a.id=d.asset_id
                where not d.is_etf and a.exchange='NSE' and a.asset_class='STOCK'""")
            assets = dict(cur.fetchall())
            ids = list(assets)
            cur.execute("""select o.asset_id::text,o.date::text,o.open,o.high,o.low,o.close,o.volume
                from public.daily_ohlcv o where o.asset_id=any(%s::uuid[])
                  and o.date between %s and %s order by o.asset_id,o.date""", (ids, load_from, load_through))
            bars_by_asset: dict[str, list[Bar]] = defaultdict(list)
            sessions: set[str] = set()
            for asset_id, day, open_, high, low, close, volume in cur:
                bars_by_asset[asset_id].append(Bar(day, float(open_), float(high), float(low), float(close), float(volume)))
                sessions.add(day)
            cur.execute("""select asset_id::text,date::text,deliv_pct,deliv_qty,turnover
                from public.daily_delivery_metrics where asset_id=any(%s::uuid[]) and date <= %s
                order by asset_id,date""", (ids, end))
            delivery_by_asset: dict[str, dict[str, DeliveryDay]] = defaultdict(dict)
            delivery_dates: set[str] = set()
            for asset_id, day, pct, qty, turnover in cur:
                delivery_by_asset[asset_id][day] = DeliveryDay(
                    None if pct is None else float(pct), None if qty is None else float(qty),
                    None if turnover is None else float(turnover))
                delivery_dates.add(day)
            cur.execute("""select e.asset_id::text,e.event_date::text from public.corporate_events e
                where e.asset_id=any(%s::uuid[]) and e.event_type='RESULTS' and e.event_date <= %s
                order by e.asset_id,e.event_date""", (ids, end))
            results_by_asset: dict[str, list[str]] = defaultdict(list)
            for asset_id, day in cur:
                results_by_asset[asset_id].append(day)
            cur.execute("""select o.date::text,o.close from public.daily_ohlcv o join public.assets a on a.id=o.asset_id
                where a.country='IN' and a.ticker in ('NIFTY','NIFTY 50','NIFTYBEES')
                  and o.date between %s and %s order by
                  case a.ticker when 'NIFTY' then 0 when 'NIFTY 50' then 1 else 2 end,o.date""", (load_from, end))
            benchmark: dict[str, float] = {}
            for day, close in cur:
                benchmark.setdefault(day, float(close))
    finally:
        conn.close()

    ordered_sessions = sorted(sessions)
    benchmark_returns = {}
    prior = None
    for day in sorted(benchmark):
        if prior and prior > 0:
            benchmark_returns[day] = (benchmark[day] / prior - 1.0) * 100.0
        prior = benchmark[day]

    outcomes: list[Outcome] = []
    variant_counts: dict[str, int] = defaultdict(int)
    for asset_id, bars in bars_by_asset.items():
        delivery = DeliveryHistory(delivery_by_asset.get(asset_id, {}))
        result_dates = results_by_asset.get(asset_id, [])
        for index, current in enumerate(bars):
            current_date = date.fromisoformat(current.date)
            if current_date < start or current_date > end or index < 200:
                continue
            window = bars[max(0, index - 219):index + 1]
            closes = [bar.close for bar in window]
            previous_results = [day for day in result_dates if day <= current.date]
            days_since = None
            if previous_results:
                days_since = session_distance(ordered_sessions, previous_results[-1], current.date)
            catalyst = CATALYST_EP if days_since is not None and 0 <= days_since <= 7 else CATALYST_TECH
            verdict = assess_midway(
                window, delivery, ema20=_ema(closes[-50:], 20),
                ema20_previous=_ema(closes[-51:-1], 20),
                sma50=_simple_average(closes, 50), sma200=_simple_average(closes, 200),
                benchmark_return_1d=benchmark_returns.get(current.date),
                days_since_results=days_since, catalyst_tag=catalyst,
            )
            variant = verdict.get("setup_variant")
            if not variant or verdict.get("exhausted"):
                continue
            levels = midway_breakout_levels(window, variant, 0)
            entry, stop, target, _atr14 = midway_geometry(window, variant, 0, levels)
            if not all(value is not None and math.isfinite(value) and value > 0 for value in (entry, stop, target)):
                continue
            if not stop < entry < target:
                continue
            horizon = 10 if variant == SETUP_STAIR_STEP else 5
            outcome = grade(assets[asset_id], variant, current.date, entry, stop, target,
                            bars[index + 1:], options.fill_window, horizon, options.cost_bps)
            outcomes.append(outcome)
            variant_counts[variant] += 1

    report = {
        "methodology": "midway_replay_next_trigger_v1",
        "period": {"start": options.start, "end": options.end},
        "delivery_coverage": {"first": min(delivery_dates) if delivery_dates else None,
                              "last": max(delivery_dates) if delivery_dates else None,
                              "sessions": len(delivery_dates)},
        "cost_bps": options.cost_bps, "fill_window_sessions": options.fill_window,
        "catalyst_limit": "EP is awarded only to point-in-time RESULTS events; historical filing taxonomy is incomplete.",
        "overall": summarize(outcomes),
        "by_variant": {variant: summarize([row for row in outcomes if row.variant == variant])
                       for variant in sorted(variant_counts)},
    }
    if options.json:
        print(json.dumps({**report, "outcomes": [asdict(row) for row in outcomes]}, indent=2))
    else:
        print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
