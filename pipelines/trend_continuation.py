#!/usr/bin/env python3
"""Persist observation-only trend-continuation signals.

Two entry paths are assessed. The primary one catches a range breakout on the
first session after it ignites: day one must close above its 20-session high on
heavy volume, and day two confirms once an hour of trading shows the gain is
being held. The older multi-session pullback path remains for impulses that
were not caught on day two.

Python is the sole owner of every indicator, status and reference level.  The
web/mobile layers only read the stored result.  This engine deliberately does
not create an execution plan or broker order.
"""
from __future__ import annotations

import argparse
import json
import math
import os
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from typing import Iterable

import psycopg2
from psycopg2.extras import execute_values

FEATURE_VERSION = "trend_continuation_v3"
IST = timezone(timedelta(hours=5, minutes=30))
SESSION_MINUTES = 375  # 09:15-15:30 IST
CONFIRMATION_MINUTES = 60  # day-two confirmation opens at 10:15 IST
# Cumulative share of an NSE cash session's volume traded N minutes after the
# open. Intraday volume is U-shaped, so a partial bar is compared with the
# volume a normal session has done by the same time, not with a full day.
VOLUME_CURVE = ((0, 0.0), (15, 0.09), (30, 0.15), (60, 0.25), (120, 0.40), (180, 0.52),
                (240, 0.64), (300, 0.77), (345, 0.88), (375, 1.0))


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


def session_volume_share(minutes: float) -> float:
    minutes = min(max(minutes, 0.0), float(SESSION_MINUTES))
    for (left_minutes, left_share), (right_minutes, right_share) in zip(VOLUME_CURVE, VOLUME_CURVE[1:]):
        if minutes <= right_minutes:
            return left_share + (right_share - left_share) * (minutes - left_minutes) / (right_minutes - left_minutes)
    return 1.0


def india_session_minutes(last_bar_date: str, now: datetime) -> float | None:
    """Minutes traded in the live session, or None when the last bar is complete."""
    local = now.astimezone(IST)
    if last_bar_date != local.date().isoformat():
        return None
    minutes = (local.hour * 60 + local.minute + local.second / 60.0) - (9 * 60 + 15)
    return minutes if minutes < SESSION_MINUTES else None


def _project_live_volume(series: list[Bar], session_minutes: float | None) -> list[Bar]:
    if session_minutes is None:
        return series
    # The opening auction distorts the first quarter hour, so projection starts there.
    share = session_volume_share(max(session_minutes, 15.0))
    return series[:-1] + [replace(series[-1], volume=series[-1].volume / share)]


def _pct(current: float, previous: float) -> float:
    return (current / previous - 1.0) * 100.0 if previous else math.nan


def execution_data_verified(source: str | None, quote_time: datetime | None, now: datetime) -> bool:
    if source != "BREEZE_LIVE" or quote_time is None:
        return False
    observed = quote_time if quote_time.tzinfo else quote_time.replace(tzinfo=timezone.utc)
    age = (now.astimezone(timezone.utc) - observed.astimezone(timezone.utc)).total_seconds()
    return 0 <= age <= 5 * 60


def _ignition(series: list[Bar], index: int) -> dict | None:
    """Day one of a range breakout: a heavy-volume close above the 20-session high.

    The launch may take one session or two (a firm first push, then the
    breakout close); either way it must cover at least 1.5 ATR from the base.
    """
    bar = series[index]
    for sessions in (1, 2):
        prior = series[:index - sessions + 1]
        if len(prior) < 25:
            return None
        atr14 = _atr(prior)
        if not math.isfinite(atr14) or atr14 <= 0:
            return None
        launch = series[index - sessions + 1:index + 1]
        breakout_level = max(item.high for item in prior[-20:])
        normal_volume = sum(item.volume for item in prior[-20:]) / 20.0
        day_range = bar.high - bar.low
        gain_atr = (bar.close - prior[-1].close) / atr14
        volume_ratio = bar.volume / normal_volume if normal_volume else 0.0
        close_location = (bar.close - bar.low) / day_range if day_range > 0 else 1.0
        ema50 = _ema([item.close for item in series[:index + 1]][-80:], 50)
        launch_return = _pct(bar.close, prior[-1].close)
        rising = all(item.close > previous.close for previous, item in zip([prior[-1], *launch], launch))
        passed = (
            rising and bar.close > breakout_level and gain_atr >= 1.5 and volume_ratio >= 2.0
            and close_location >= 0.6 and bar.close > ema50 and launch_return <= 10.0 * sessions ** 0.5
        )
        result = {
            "passed": passed, "bar": bar, "atr14": atr14, "breakout_level": breakout_level,
            "normal_volume": normal_volume, "gain_atr": gain_atr, "volume_ratio": volume_ratio,
            "close_location": close_location, "day_return": launch_return, "launch_sessions": sessions,
        }
        if passed:
            return result
    return result


def _assess_day_two_breakout(series: list[Bar], session_minutes: float | None) -> dict | None:
    """Catch an ignition on day one, confirm it during the first hour of day two."""
    live = session_minutes is not None
    today = _ignition(series, len(series) - 1)
    yesterday = _ignition(series, len(series) - 2)

    if yesterday and yesterday["passed"]:
        ignition, confirm = yesterday, series[-1]
        atr14, day_one = ignition["atr14"], ignition["bar"]
        confirm_volume_ratio = confirm.volume / ignition["normal_volume"] if ignition["normal_volume"] else 0.0
        metrics = {
            "early_breakout": True, "ignition_gain_atr": ignition["gain_atr"],
            "ignition_volume_ratio": ignition["volume_ratio"], "breakout_level": ignition["breakout_level"],
            "launch_sessions": ignition["launch_sessions"], "day_two_volume_ratio": confirm_volume_ratio, "session_minutes": session_minutes,
        }
        if live and session_minutes < CONFIRMATION_MINUTES:
            return {"status": "IMPULSE_DETECTED", "ready": False, "metrics": metrics, "reasons": [
                f"Range breakout ignited on {day_one.date}: {ignition['gain_atr']:.2f} ATR on {ignition['volume_ratio']:.2f}x volume.",
                "Day-two confirmation opens after the first hour of trading (10:15 IST).",
            ], "score_parts": ignition}
        holds_gain = confirm.close >= day_one.close - 0.5 * atr14
        holds_range = confirm.low >= ignition["breakout_level"] - 0.25 * atr14
        chasing = confirm.close > day_one.close + 1.0 * atr14
        volume_on_pace = confirm_volume_ratio >= 1.0
        metrics.update({"day_two_holds_gain": holds_gain, "day_two_holds_range": holds_range})
        if not (holds_gain and holds_range):
            return None  # failed follow-through; the pullback path decides
        # A breakout that sinks half an ATR back into its old range has failed, so
        # the stop is the tighter of that level and the day-one low.
        stop = max(day_one.low, ignition["breakout_level"] - 0.5 * atr14) - 0.10 * atr14
        risk = confirm.close - stop
        target = confirm.close + 2.0 * risk
        geometry_valid = risk > 0 and risk / confirm.close <= 0.06
        reasons = [
            f"Range breakout ignited on {day_one.date}: {ignition['gain_atr']:.2f} ATR in {ignition['launch_sessions']} session(s) on {ignition['volume_ratio']:.2f}x volume, closing above the 20-session high {ignition['breakout_level']:.2f}.",
            f"Day two holds the gain and the breakout level on {confirm_volume_ratio:.2f}x {'paced ' if live else ''}volume.",
        ]
        if chasing:
            status, ready = "EXTENDED_RISK", False
            reasons.append("Entry is blocked because day two has run more than 1 ATR beyond the day-one close.")
        elif not volume_on_pace:
            status, ready = "CONTINUATION_WATCH", False
            reasons.append("Waiting for day-two volume to reach a normal session's pace.")
        elif not geometry_valid:
            status, ready = "CONTINUATION_WATCH", False
            reasons.append("The protective stop is more than 6% away; entry geometry is not valid.")
        else:
            status, ready = "TREND_CONTINUATION_READY", True
            reasons.append("Day-two breakout entry is valid with the stop below the breakout; this signal remains observation-only.")
        return {"status": status, "ready": ready, "entry": confirm.close if ready else None,
                "stop": stop if geometry_valid else None, "target": target if geometry_valid else None,
                "metrics": metrics, "reasons": reasons, "score_parts": ignition,
                "hold_quality": min(1.0, max(0.0, (confirm.close - (day_one.close - 0.5 * atr14)) / atr14))}

    if today and today["passed"] and (not live or session_minutes >= CONFIRMATION_MINUTES):
        return {"status": "IMPULSE_DETECTED", "ready": False, "metrics": {
            "early_breakout": True, "ignition_gain_atr": today["gain_atr"],
            "ignition_volume_ratio": today["volume_ratio"], "breakout_level": today["breakout_level"],
            "launch_sessions": today["launch_sessions"], "session_minutes": session_minutes,
        }, "reasons": [
            f"Range breakout {'in progress' if live else 'ignited'}: {today['gain_atr']:.2f} ATR above the prior close on {today['volume_ratio']:.2f}x {'paced ' if live else ''}volume, above the 20-session high {today['breakout_level']:.2f}.",
            "Entry is assessed on day two, after its first hour of trading.",
        ], "score_parts": today}
    return None


def assess_trend_continuation(
    bars: Iterable[Bar], benchmark_closes: list[float] | None = None, session_minutes: float | None = None,
) -> dict:
    """Assess both entry paths. session_minutes is set while the last bar is a live session."""
    series = _project_live_volume(list(bars), session_minutes)
    result = _assess_pullback_continuation(series, benchmark_closes)
    if result["status"] == "INVALID_DATA" or len(series) < 30:
        return result
    early = _assess_day_two_breakout(series, session_minutes)
    result.setdefault("metrics", {})["early_breakout"] = False
    if early is None or (result.get("ready") and not early["ready"]):
        return result
    parts = early.pop("score_parts")
    hold_quality = early.pop("hold_quality", 0.5)
    score = round(min(100.0, max(0.0,
        25 * min(parts["gain_atr"] / 1.5, 1.2)
        + 25 * min(parts["volume_ratio"] / 2.0, 1.2)
        + 15 * parts["close_location"]
        + 15 * hold_quality
        + (20 if early["ready"] else 10)
        - (20 if early["status"] == "EXTENDED_RISK" else 0)
    )))
    metrics = {**result["metrics"], **early["metrics"]}
    return {
        "status": early["status"], "ready": early["ready"], "score": score,
        "entry": early.get("entry"), "stop": early.get("stop"), "target": early.get("target"),
        "asof_market_date": series[-1].date, "metrics": metrics, "reasons": early["reasons"],
    }


def _assess_pullback_continuation(series: list[Bar], benchmark_closes: list[float] | None = None) -> dict:
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
    # A continuation must extend an already-established trend, not merely stage
    # a violent rebound from below its own medium-term structure. Evaluate the
    # trend as it existed immediately before the selected impulse window.
    impulse_base_index = len(series) - impulse_age - 4
    pre_impulse_closes = closes[:impulse_base_index + 1]
    pre_impulse_ema20 = _ema(pre_impulse_closes[-50:], 20)
    pre_impulse_ema20_previous = _ema(pre_impulse_closes[:-5][-50:], 20)
    established_pre_impulse_trend = (
        closes[impulse_base_index] >= pre_impulse_ema20
        and pre_impulse_ema20 > pre_impulse_ema20_previous
    )
    persistent_volume = sum(ratio >= 1.5 for ratio in volume_ratios) >= 2 or sum(volume_ratios) / 3.0 >= 1.5
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
    continuation = impulse and established_pre_impulse_trend and trend_structure and holds_midpoint and rs_pass
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
        - (25 if not established_pre_impulse_trend else 0)
        - (20 if extended else 0)
    )))
    reasons = []
    reasons.append(f"Three-session move is {move3_atr:.2f} ATR with {efficiency3:.0%} directional efficiency.")
    reasons.append(f"Last-three-session volume ratios are {', '.join(f'{value:.2f}x' for value in volume_ratios)}.")
    reasons.append(
        "The impulse began above a rising pre-impulse EMA20 trend."
        if established_pre_impulse_trend else
        "Continuation is withheld because the impulse began below or against the pre-impulse EMA20 trend."
    )
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
            "pre_impulse_ema20": pre_impulse_ema20,
            "established_pre_impulse_trend": established_pre_impulse_trend,
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
                where a.country='IN' and a.exchange='NSE' and a.asset_class='STOCK' and a.is_active
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
        assessed_dates = set()
        for asset_id, ticker, name in assets:
            asset_history = history_by_asset.get(asset_id, [])
            if asset_history:
                assessed_dates.add(asset_history[-1][1])
            asset_bars = _rows_to_bars(asset_history)
            session_minutes = india_session_minutes(asset_bars[-1].date, now) if asset_bars else None
            result = assess_trend_continuation(asset_bars, benchmark, session_minutes)
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
            cur.execute("""delete from public.trend_continuation_signals s using public.assets a
                where s.asset_id=a.id and (a.exchange <> 'NSE' or s.asof_market_date=any(%s::date[]))""",
                (sorted(assessed_dates),))
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
