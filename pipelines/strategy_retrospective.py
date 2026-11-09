#!/usr/bin/env python3
"""Grade recorded production-ready strategy signals without lookahead.

This is deliberately not a reconstructed multi-year backtest. It uses only
signals that the production app actually recorded at the time, enters at the
next observed session open, and calculates every outcome in Python.
"""
from __future__ import annotations

import argparse
import os
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from statistics import median

import psycopg2
from psycopg2.extras import execute_values

METHODOLOGY_VERSION = "recorded_ready_next_open_v1"
HORIZONS = (5, 10, 20)
TIME_ZONES = {"IN": "Asia/Kolkata", "US": "America/New_York"}


@dataclass(frozen=True)
class Bar:
    date: date
    open: float
    high: float
    low: float
    close: float


def calculate_outcome(bars: list[Bar], horizon: int) -> dict | None:
    if len(bars) < horizon:
        return None
    path = bars[:horizon]
    entry = path[0].open
    if entry <= 0:
        return None
    exit_price = path[-1].close
    pct = lambda value: (value / entry - 1.0) * 100.0
    return {
        "entry_date": path[0].date,
        "entry_price": entry,
        "exit_date": path[-1].date,
        "exit_price": exit_price,
        "realized_return_pct": pct(exit_price),
        "max_favorable_pct": pct(max(bar.high for bar in path)),
        "max_adverse_pct": pct(min(bar.low for bar in path)),
    }


def summarize(values: list[dict]) -> dict:
    returns = [row["realized_return_pct"] for row in values]
    positives = sum(value > 0 for value in returns)
    count = len(values)
    return {
        "observations": count,
        "positive_outcomes": positives,
        "win_rate_pct": positives / count * 100.0,
        "average_return_pct": sum(returns) / count,
        "median_return_pct": median(returns),
        "average_max_favorable_pct": sum(row["max_favorable_pct"] for row in values) / count,
        "average_max_adverse_pct": sum(row["max_adverse_pct"] for row in values) / count,
    }


def run(market: str) -> tuple[int, int]:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL is required")
    zone = TIME_ZONES[market]
    with psycopg2.connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select distinct on (o.engine,o.asset_id,
                       (o.observed_at at time zone %s)::date)
                       o.engine,o.asset_id::text,
                       (o.observed_at at time zone %s)::date signal_date,
                       o.observed_at first_ready_at
                  from public.candidate_signal_observations o
                  join public.assets a on a.id=o.asset_id
                 where o.market=%s and o.ready and a.is_active
                 order by o.engine,o.asset_id,
                          (o.observed_at at time zone %s)::date,o.observed_at
                """,
                (zone, zone, market, zone),
            )
            signals = cur.fetchall()
        if not signals:
            return 0, 0

        asset_ids = sorted({row[1] for row in signals})
        earliest = min(row[2] for row in signals)
        with conn.cursor() as cur:
            cur.execute(
                """select asset_id::text,date,open,high,low,close
                     from public.daily_ohlcv
                    where asset_id=any(%s::uuid[]) and date>%s
                    order by asset_id,date""",
                (asset_ids, earliest),
            )
            bar_rows = cur.fetchall()
        by_asset: dict[str, list[Bar]] = defaultdict(list)
        for asset_id, bar_date, open_price, high, low, close in bar_rows:
            by_asset[asset_id].append(Bar(bar_date, float(open_price), float(high), float(low), float(close)))

        results = []
        grouped: dict[tuple[str, int], list[dict]] = defaultdict(list)
        for engine, asset_id, signal_date, first_ready_at in signals:
            future = [bar for bar in by_asset.get(asset_id, []) if bar.date > signal_date]
            for horizon in HORIZONS:
                outcome = calculate_outcome(future, horizon)
                if outcome is None:
                    continue
                results.append((
                    market, engine, asset_id, signal_date, first_ready_at,
                    outcome["entry_date"], outcome["entry_price"], horizon,
                    outcome["exit_date"], outcome["exit_price"], outcome["realized_return_pct"],
                    outcome["max_favorable_pct"], outcome["max_adverse_pct"], METHODOLOGY_VERSION,
                ))
                grouped[(engine, horizon)].append(outcome)

        scorecards = []
        for (engine, horizon), values in grouped.items():
            summary = summarize(values)
            scorecards.append((
                market, engine, horizon, summary["observations"], summary["positive_outcomes"],
                summary["win_rate_pct"], summary["average_return_pct"], summary["median_return_pct"],
                summary["average_max_favorable_pct"], summary["average_max_adverse_pct"],
                METHODOLOGY_VERSION,
            ))

        with conn.cursor() as cur:
            cur.execute("delete from public.strategy_retrospective_results where market=%s", (market,))
            cur.execute("delete from public.strategy_retrospective_scorecards where market=%s", (market,))
            if results:
                execute_values(cur, """
                    insert into public.strategy_retrospective_results
                      (market,engine,asset_id,signal_date,first_ready_at,entry_date,entry_price,
                       horizon_sessions,exit_date,exit_price,realized_return_pct,max_favorable_pct,
                       max_adverse_pct,methodology_version) values %s
                """, results, page_size=1000)
            if scorecards:
                execute_values(cur, """
                    insert into public.strategy_retrospective_scorecards
                      (market,engine,horizon_sessions,observations,positive_outcomes,win_rate_pct,
                       average_return_pct,median_return_pct,average_max_favorable_pct,
                       average_max_adverse_pct,methodology_version) values %s
                """, scorecards, page_size=100)
        conn.commit()
        return len(results), len(scorecards)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--market", choices=("IN", "US", "ALL"), default="ALL")
    args = parser.parse_args()
    for market in (("IN", "US") if args.market == "ALL" else (args.market,)):
        results, scorecards = run(market)
        print(f"[strategy-retrospective] {market}: results={results} scorecards={scorecards}")


if __name__ == "__main__":
    main()
