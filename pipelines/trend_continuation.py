#!/usr/bin/env python3
"""Persist observation-only multi-session trend-continuation signals.

Python is the sole owner of every indicator, status and reference level.  The
web/mobile layers only read the stored result.  This engine deliberately does
not create an execution plan or broker order.
"""
from __future__ import annotations

import argparse
import json
import math
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable

import psycopg2
from psycopg2.extras import execute_values

FEATURE_VERSION = "trend_continuation_v1"


@dataclass(frozen=True)
class Bar:
    date: str
    open: float
    high: float
    low: float
    close: float
    volume: float


def _ema(values: list[float], period: int) -> float:
    alpha = 2.0 / (period + 1.0)
    value = values[0]
    for item in values[1:]:
        value = alpha * item + (1.0 - alpha) * value
    return value


def _atr(bars: list[Bar], period: int = 14) -> float:
    ranges = []
    for index in range(1, len(bars)):
        bar, previous = bars[index], bars[index - 1]
        ranges.append(max(bar.high - bar.low, abs(bar.high - previous.close), abs(bar.low - previous.close)))
    if len(ranges) < period:
        return math.nan
    # Wilder smoothing, matching the application's established ATR convention.
    value = sum(ranges[:period]) / period
    for item in ranges[period:]:
        value = ((period - 1) * value + item) / period
    return value


def _pct(current: float, previous: float) -> float:
    return (current / previous - 1.0) * 100.0 if previous else math.nan


def execution_data_verified(source: str | None, quote_time: datetime | None, now: datetime) -> bool:
    if source != "BREEZE_LIVE" or quote_time is None:
        return False
    observed = quote_time if quote_time.tzinfo else quote_time.replace(tzinfo=timezone.utc)
    age = (now.astimezone(timezone.utc) - observed.astimezone(timezone.utc)).total_seconds()
    return 0 <= age <= 5 * 60


def assess_trend_continuation(bars: Iterable[Bar], benchmark_closes: list[float] | None = None) -> dict:
    series = list(bars)
    if len(series) < 25:
        return {"status": "NOT_QUALIFIED", "score": 0, "reasons": ["At least 25 completed sessions are required."]}
    closes = [bar.close for bar in series]
    volumes = [bar.volume for bar in series]
    atr14 = _atr(series)
    if not math.isfinite(atr14) or atr14 <= 0 or any(
        not all(math.isfinite(value) for value in (bar.open, bar.high, bar.low, bar.close, bar.volume))
        or bar.close <= 0 or bar.high < bar.low or bar.volume < 0 for bar in series[-25:]
    ):
        return {"status": "INVALID_DATA", "score": 0, "reasons": ["OHLCV or ATR input is invalid."]}

    current = series[-1]
    ema10 = _ema(closes[-40:], 10)
    ema10_previous = _ema(closes[-41:-1], 10)
    ema20 = _ema(closes[-50:], 20)
    # Retain an impulse for two subsequent sessions so an orderly first pullback
    # is not forgotten merely because it moved outside the final three bars.
    impulse_windows = []
    for end_offset in (0, 1, 2):
        end = len(series) - end_offset
        start = end - 3
        base = start - 1
        path = sum(abs(closes[index] - closes[index - 1]) for index in range(start, end))
        move = (closes[end - 1] - closes[base]) / atr14
        efficiency = abs(closes[end - 1] - closes[base]) / path if path else 0.0
        prior = volumes[max(0, start - 20):start]
        normal_volume = sum(prior) / len(prior) if prior else 0.0
        ratios = [value / normal_volume if normal_volume else 0.0 for value in volumes[start:end]]
        impulse_windows.append((move, efficiency, ratios, end_offset))
    move3_atr, efficiency3, volume_ratios, impulse_age = max(impulse_windows, key=lambda item: item[0])
    persistent_volume = sum(ratio >= 1.5 for ratio in volume_ratios) >= 2 or sum(volumes[-3:]) / (3 * prior_volume20) >= 1.5
    rising_lows = series[-1].low >= series[-2].low and series[-2].low >= series[-3].low
    trend_structure = current.close > ema10 > ema20 and ema10 > ema10_previous
    impulse_midpoint = (max(bar.high for bar in series[-4:]) + min(bar.low for bar in series[-4:])) / 2.0
    holds_midpoint = current.close >= impulse_midpoint
    return5 = _pct(current.close, series[-6].close)
    rs5 = None
    rs_acceleration = None
    if benchmark_closes and len(benchmark_closes) >= 21:
        benchmark5 = _pct(benchmark_closes[-1], benchmark_closes[-6])
        benchmark20 = _pct(benchmark_closes[-1], benchmark_closes[-21])
        rs5 = return5 - benchmark5
        rs20 = _pct(current.close, series[-21].close) - benchmark20
        rs_acceleration = rs5 - rs20
    rs_pass = rs5 is None or (rs5 > 0 and (rs_acceleration is None or rs_acceleration > -1.0))

    distance_ema10_atr = (current.close - ema10) / atr14
    extended = distance_ema10_atr > 1.0 or return5 > 12.0
    impulse = move3_atr >= 1.5 and efficiency3 >= 0.65 and persistent_volume
    continuation = impulse and trend_structure and holds_midpoint and rs_pass
    breakout = current.close > max(bar.high for bar in series[-4:-1]) and volume_ratios[-1] >= 1.25
    pullback = current.low <= ema10 + 0.75 * atr14 and current.close >= ema10 and impulse_age > 0
    ready = continuation and (breakout or pullback) and not extended

    stop = min(ema10, min(bar.low for bar in series[-3:])) - 0.10 * atr14
    risk = current.close - stop
    target = current.close + 2.0 * risk
    geometry_valid = risk > 0 and risk / current.close <= 0.06 and target > current.close
    if ready and not geometry_valid:
        ready = False

    if extended:
        status = "EXTENDED_RISK"
    elif ready:
        status = "TREND_CONTINUATION_READY"
    elif continuation:
        status = "CONTINUATION_WATCH"
    elif impulse:
        status = "IMPULSE_DETECTED"
    else:
        status = "NOT_QUALIFIED"

    score = round(min(100.0, max(0.0,
        25 * min(move3_atr / 1.5, 1.2)
        + 20 * min(efficiency3 / 0.65, 1.2)
        + 20 * min(sum(volume_ratios) / 4.5, 1.2)
        + (20 if trend_structure else 0)
        + (10 if holds_midpoint else 0)
        + (5 if rs_pass else 0)
        - (20 if extended else 0)
    )))
    reasons = []
    reasons.append(f"Three-session move is {move3_atr:.2f} ATR with {efficiency3:.0%} directional efficiency.")
    reasons.append(f"Last-three-session volume ratios are {', '.join(f'{value:.2f}x' for value in volume_ratios)}.")
    reasons.append("Price holds above rising EMA10 and EMA20." if trend_structure else "Rising EMA10/EMA20 structure is not confirmed.")
    if extended:
        reasons.append("Entry is blocked because price is extended from EMA10 or the five-session move exceeds 12%.")
    elif status == "CONTINUATION_WATCH":
        reasons.append("Wait for a controlled EMA10 pullback or a renewed-volume breakout.")
    elif ready:
        reasons.append("Continuation entry geometry is valid, but this v1 signal remains observation-only.")

    return {
        "status": status, "ready": ready, "score": score,
        "entry": current.close if ready else None, "stop": stop if geometry_valid else None,
        "target": target if geometry_valid else None, "asof_market_date": current.date,
        "metrics": {
            "atr14": atr14, "move3_atr": move3_atr, "efficiency3": efficiency3,
            "volume_ratios": volume_ratios, "ema10": ema10, "ema20": ema20,
            "distance_ema10_atr": distance_ema10_atr, "return5_pct": return5,
            "relative_strength5_pct": rs5, "relative_strength_acceleration_pct": rs_acceleration,
            "rising_lows": rising_lows, "breakout": breakout, "pullback": pullback, "impulse_age_sessions": impulse_age,
        },
        "reasons": reasons,
    }


def _rows_to_bars(rows) -> list[Bar]:
    return [Bar(str(row[1]), *[float(value) if value is not None else math.nan for value in row[2:]]) for row in rows]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--market", choices=("IN",), default="IN")
    parser.add_argument("--limit", type=int, default=3000)
    args = parser.parse_args()
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL is required")
    conn = psycopg2.connect(database_url)
    try:
        with conn.cursor() as cur:
            cur.execute("""select a.id::text,a.ticker,a.name from public.assets a
                where a.country='IN' and a.asset_class='STOCK' and a.is_active
                  and exists(select 1 from public.daily_ohlcv o where o.asset_id=a.id)
                order by a.ticker limit %s""", (args.limit,))
            assets = cur.fetchall()
            asset_ids = [row[0] for row in assets]
            cur.execute("""select asset_id::text,date,open,high,low,close,volume from (
                  select o.*,row_number() over(partition by asset_id order by date desc) rn
                  from public.daily_ohlcv o where asset_id = any(%s::uuid[])
                ) ranked where rn <= 80 order by asset_id,date""", (asset_ids,))
            history_rows = cur.fetchall()
            cur.execute("""select asset_id::text,source,updated_at from public.latest_quotes
                where asset_id = any(%s::uuid[])""", (asset_ids,))
            quote_rows = cur.fetchall()
            cur.execute("""select o.asset_id::text,o.date,o.open,o.high,o.low,o.close,o.volume
                from public.daily_ohlcv o where o.asset_id in (
                  select id from public.assets where country='IN' and ticker in ('NIFTY','NIFTY 50')
                ) order by o.date desc limit 80""")
            benchmark_rows = list(reversed(cur.fetchall()))
        benchmark = [float(row[5]) for row in benchmark_rows]
        history_by_asset = {}
        for row in history_rows:
            history_by_asset.setdefault(row[0], []).append(row)
        quotes = {row[0]: (row[1], row[2]) for row in quote_rows}
        now = datetime.now(timezone.utc)
        payload = []
        for asset_id, ticker, name in assets:
            result = assess_trend_continuation(_rows_to_bars(history_by_asset.get(asset_id, [])), benchmark)
            source, quote_time = quotes.get(asset_id, (None, None))
            execution_verified = execution_data_verified(source, quote_time, now)
            result.setdefault("metrics", {})["execution_data_verified"] = execution_verified
            if result.get("ready") and not execution_verified:
                result["ready"] = False
                result["status"] = "CONTINUATION_WATCH"
                result["entry"] = None
                result["reasons"].append("Ready state withheld until a fresh Breeze quote verifies the live session.")
            if result["status"] in ("NOT_QUALIFIED", "INVALID_DATA"):
                continue
            payload.append((asset_id, ticker, name, result["asof_market_date"], result["status"], result.get("ready", False),
                            result["score"], result.get("entry"), result.get("stop"), result.get("target"),
                            json.dumps(result["metrics"]), json.dumps(result["reasons"]), FEATURE_VERSION))
        with conn.cursor() as cur:
            if payload:
                execute_values(cur, """insert into public.trend_continuation_signals
                    (asset_id,ticker,name,asof_market_date,status,ready,score,entry,stop,target,metrics,reasons,feature_version)
                    values %s on conflict(asset_id,asof_market_date,feature_version) do update set
                    ticker=excluded.ticker,name=excluded.name,status=excluded.status,ready=excluded.ready,
                    score=excluded.score,entry=excluded.entry,stop=excluded.stop,target=excluded.target,
                    metrics=excluded.metrics,reasons=excluded.reasons,computed_at=now()""", payload, page_size=500)
        conn.commit()
        print(f"[trend-continuation] assessed={len(assets)} stored={len(payload)} version={FEATURE_VERSION}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
