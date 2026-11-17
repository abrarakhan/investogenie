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
import bisect
import json
import math
import os
from pathlib import Path
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from typing import Iterable

import psycopg2
from psycopg2.extras import execute_values

FEATURE_VERSION = "trend_continuation_v8_midway"
IST = timezone(timedelta(hours=5, minutes=30))
SESSION_MINUTES = 375  # 09:15-15:30 IST
CONFIRMATION_MINUTES = 60  # day-two confirmation opens at 10:15 IST
# Gates measured on NSE daily bars from 2025-01 to 2026-11 (entry at the signal
# close, stop below the first session's low, 2R target, 10-session hold). A
# two-session staircase alone averaged about 0% a trade. With these gates a
# day-by-day replay of this code gave +0.31% a trade before costs over 1,027
# trades (45% winners; -0.13% in 2025, +0.81% in 2026): about break-even after
# costs, so treat it as a tracked hypothesis, not a proven edge. Market regime
# was the largest single factor.
MIN_STRENGTH_RANK = 0.70
MIN_AVG_TRADED_VALUE = 5e7  # rupees per session, 20-session average
REGIME_SESSIONS = 50
STRENGTH_SESSIONS = 120
STAIRCASE_MAX_RISK = 0.10
STAIRCASE_HOLDING_DAYS = 10
# Cumulative share of an NSE cash session's volume traded N minutes after the
# open. Intraday volume is U-shaped, so a partial bar is compared with the
# volume a normal session has done by the same time, not with a full day.
VOLUME_CURVE = ((0, 0.0), (15, 0.09), (30, 0.15), (60, 0.25), (120, 0.40), (180, 0.52),
                (240, 0.64), (300, 0.77), (345, 0.88), (375, 1.0))


def _load_india_special_sessions() -> dict[str, tuple[int, int]]:
    try:
        with (Path(__file__).resolve().parents[1] / "config" / "market-special-sessions.json").open(encoding="utf-8") as source:
            rows = json.load(source).get("IN", {})
        return {
            date_value: (int(values["openMinutes"]), int(values["closeMinutes"]))
            for date_value, values in rows.items()
        }
    except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError):
        return {}


INDIA_SPECIAL_SESSIONS = _load_india_special_sessions()


def india_session_bounds(date_value: str) -> tuple[int, int]:
    return INDIA_SPECIAL_SESSIONS.get(date_value, (9 * 60 + 15, 15 * 60 + 30))


@dataclass(frozen=True)
class Bar:
    date: str
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass(frozen=True)
class MarketContext:
    """Cross-sectional facts one stock's bars cannot supply. None means unknown."""
    regime_positive: bool | None = None  # liquid NSE stocks, equal-weighted, above their 50-session average
    strength_rank: float | None = None  # percentile of 120-session return among liquid NSE stocks
    avg_traded_value: float | None = None  # 20-session average, excluding the latest bar


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


# --- Mid-way momentum and institutional accumulation (v2) ---------------------
#
# The engine above finds continuation after a move is established. These rules aim
# at days 2 to 4 of a 3-5 session move: late enough that the move has proved itself
# with volume and delivery, early enough that it has not yet exhausted.
#
# Every threshold here is a stated rule of the strategy, not a fitted parameter. None
# of them has been measured against outcomes by a replay the way the Strong Swing
# entry band was; until that exists they should be read as a specification being
# tested, not as a measured edge.

# Turnover required on the ignition bar itself. The quiet base days before a breakout
# are deliberately not held to this: a stock trading Rs 3 crore while it coils and
# Rs 40 crore when it breaks out is the normal shape of the setup, and applying the
# ignition floor to the base would reject exactly the stocks worth finding.
IGNITION_MIN_TURNOVER = 1e8  # Rs 10 crore

# Deliverable quantity is what separates positional accumulation from intraday churn.
# Either a high share of the day's volume was actually delivered, or far more stock was
# delivered than on a normal day for this stock.
ACCUMULATION_MIN_DELIV_PCT = 55.0
ACCUMULATION_MIN_REL_DELIV = 2.5
# A rebound against the trend has to clear a higher delivery bar, because the trend
# itself is not supporting the case.
EP_MIN_DELIV_PCT = 65.0
EP_MAX_DAYS_SINCE_RESULTS = 7

# Path A takes one decisive bar; Path B takes three ordinary ones. The stair-step
# average is lower because three consecutive strong closes are themselves the evidence.
PATH_A_MIN_RVOL = 2.5
PATH_B_MIN_AVG_RVOL = 1.6
PATH_B_SESSIONS = 3

# Internal bar strength: where the close sat in the bar's range. A move that closes at
# its low on heavy volume is distribution wearing a breakout's clothes.
MIN_IBS = 0.75

# Anti-chasing. Past these the move is not mid-way, whatever else it looks like.
EXHAUSTION_5D_GAIN_PCT = 22.0
EXHAUSTION_RSI = 80.0

# Strength shown on a day the index fell is worth more than the same strength on a day
# everything rose. These bounds define "the index was red and this stock was not".
RED_INDEX_RETURN_PCT = -0.3
RED_INDEX_STOCK_RETURN_PCT = 3.0
RED_INDEX_SCORE_BOOST = 5

SETUP_STAGE2 = "STAGE2_IMPULSE"
SETUP_EP_REBOUND = "EP_REBOUND"
SETUP_STAIR_STEP = "STAIR_STEP"
CATALYST_EP = "EP"
CATALYST_TECH = "TECH"


@dataclass(frozen=True)
class DeliveryDay:
    """One session's deliverable-quantity evidence, as the exchange reported it."""
    deliv_pct: float | None = None
    deliv_qty: float | None = None
    turnover: float | None = None


@dataclass(frozen=True)
class DeliveryHistory:
    """Delivery by session date, with the 20-session baseline the ratio is taken against."""
    by_date: dict[str, DeliveryDay]
    avg_deliv_qty_20d: float | None = None

    def day(self, date_value: str) -> DeliveryDay:
        return self.by_date.get(date_value, DeliveryDay())


def _rsi(closes: list[float], period: int = 14) -> float | None:
    """Wilder's RSI. None when there is not enough history to compute it honestly."""
    if len(closes) <= period:
        return None
    gains = 0.0
    losses = 0.0
    for index in range(1, period + 1):
        change = closes[index] - closes[index - 1]
        gains += max(change, 0.0)
        losses += max(-change, 0.0)
    avg_gain = gains / period
    avg_loss = losses / period
    for index in range(period + 1, len(closes)):
        change = closes[index] - closes[index - 1]
        avg_gain = (avg_gain * (period - 1) + max(change, 0.0)) / period
        avg_loss = (avg_loss * (period - 1) + max(-change, 0.0)) / period
    if avg_loss <= 0:
        return 100.0 if avg_gain > 0 else None
    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1.0 + rs))


def internal_bar_strength(bar: Bar) -> float | None:
    """Where the close sat within the bar's range, 0 at the low and 1 at the high."""
    span = bar.high - bar.low
    if not math.isfinite(span) or span <= 0:
        return None
    return max(0.0, min(1.0, (bar.close - bar.low) / span))


def relative_delivery(deliv_qty: float | None, baseline: float | None) -> float | None:
    """How many times the normal day's deliverable quantity changed hands."""
    if deliv_qty is None or baseline is None or baseline <= 0:
        return None
    return deliv_qty / baseline


def accumulation_confirmed(deliv_pct: float | None, rel_deliv: float | None) -> bool:
    """Either a high delivery share, or far more delivered stock than usual."""
    return ((deliv_pct is not None and deliv_pct >= ACCUMULATION_MIN_DELIV_PCT)
            or (rel_deliv is not None and rel_deliv >= ACCUMULATION_MIN_REL_DELIV))


def trend_regime_ok(close: float, ema20: float | None, sma50: float | None,
                    sma200: float | None) -> bool:
    """The default regime: above the short and medium averages, in a rising structure.

    This is what blocks counter-trend rebounds from being treated as continuation.
    """
    if ema20 is None or sma50 is None or sma200 is None:
        return False
    return close > ema20 and close > sma50 and sma50 > sma200


def ep_rebound_ok(close: float, ema20: float | None, ema20_previous: float | None,
                  deliv_pct: float | None, days_since_results: int | None) -> bool:
    """The one way a stock below its longer averages may still qualify.

    A company that has just reported can begin a move from below its 50- or 200-day
    average, and refusing those on regime alone misses the strongest single catalyst
    there is. The exception is narrow on purpose: a verified recent event, delivery
    above the ordinary accumulation bar, and a reclaimed 20-day EMA that is itself
    rising. Any one of those alone is a falling stock having a good day.
    """
    if days_since_results is None or not (0 <= days_since_results <= EP_MAX_DAYS_SINCE_RESULTS):
        return False
    if deliv_pct is None or deliv_pct < EP_MIN_DELIV_PCT:
        return False
    if ema20 is None or ema20_previous is None:
        return False
    return close > ema20 and ema20 > ema20_previous


def red_index_alpha(stock_return_1d: float | None, benchmark_return_1d: float | None) -> float | None:
    """One session of relative performance, in percentage points."""
    if stock_return_1d is None or benchmark_return_1d is None:
        return None
    return stock_return_1d - benchmark_return_1d


def red_index_boost(stock_return_1d: float | None, benchmark_return_1d: float | None) -> int:
    """A deterministic ranking boost for rising while the index fell."""
    if stock_return_1d is None or benchmark_return_1d is None:
        return 0
    if benchmark_return_1d < RED_INDEX_RETURN_PCT and stock_return_1d > RED_INDEX_STOCK_RETURN_PCT:
        return RED_INDEX_SCORE_BOOST
    return 0


def exhaustion(series: list[Bar]) -> tuple[bool, float | None, float | None]:
    """Whether the move has already run too far to be entered mid-way.

    Returns the verdict with the two numbers behind it, so the reason given to a reader
    is the same one the gate used.
    """
    closes = [bar.close for bar in series]
    rsi = _rsi(closes[-60:]) if len(closes) >= 15 else None
    gain_5d = None
    if len(closes) >= 6 and closes[-6] > 0:
        gain_5d = (closes[-1] / closes[-6] - 1.0) * 100.0
    spent = ((gain_5d is not None and gain_5d > EXHAUSTION_5D_GAIN_PCT)
             or (rsi is not None and rsi >= EXHAUSTION_RSI))
    return spent, gain_5d, rsi


def _ignition_turnover_ok(series: list[Bar], delivery: DeliveryHistory) -> bool:
    """Rs 10 crore on the day-1 or day-2 impulse bar, not on the base before it."""
    for bar in series[-2:]:
        turnover = delivery.day(bar.date).turnover
        if turnover is None:
            # Turnover is absent for sessions the exchange did not report or that fell
            # under the base floor; fall back to the bar's own traded value rather than
            # failing a stock because one optional column was missing.
            turnover = bar.close * bar.volume
        if turnover >= IGNITION_MIN_TURNOVER:
            return True
    return False


def _volume_ratio(series: list[Bar], index: int, lookback: int = 20) -> float | None:
    window = [bar.volume for bar in series[max(0, index - lookback):index]]
    if len(window) < 5:
        return None
    base = sum(window) / len(window)
    return None if base <= 0 else series[index].volume / base


def stair_step_qualified(series: list[Bar]) -> bool:
    """Three consecutive strong green closes on sustained above-average volume."""
    if len(series) < PATH_B_SESSIONS + 1:
        return False
    ratios: list[float] = []
    for offset in range(PATH_B_SESSIONS):
        index = len(series) - 1 - offset
        bar = series[index]
        previous = series[index - 1]
        if not (bar.close > bar.open and bar.close > previous.close):
            return False
        ibs = internal_bar_strength(bar)
        if ibs is None or ibs < MIN_IBS:
            return False
        ratio = _volume_ratio(series, index)
        if ratio is None:
            return False
        ratios.append(ratio)
    return sum(ratios) / len(ratios) >= PATH_B_MIN_AVG_RVOL


def breakout_levels(series: list[Bar]) -> dict:
    """The price levels today's entry must clear, frozen with the signal.

    Computed here, during the scheduled scan, rather than in the request path: the host
    has two CPUs and a page render that recomputes levels for every candidate competes
    with the scan that produced them. Freezing them also means the level a buy is judged
    against is the one the signal was published with.

    The last bar is today (live during a session), so the prior completed session is the
    one before it. An inside day is a session whose whole range sat within the previous
    session's, which is why a day-three entry uses day two's high rather than day one's.
    """
    if len(series) < 4:
        return {}
    previous = series[-2]
    before = series[-3]
    inside_day = previous.high <= before.high and previous.low >= before.low
    steps = series[-4:-1]
    return {
        "previousSessionHigh": previous.high,
        "insideDay": inside_day,
        "stairStepHigh": max(bar.high for bar in steps),
    }


def assess_midway(
    series: list[Bar],
    delivery: DeliveryHistory | None = None,
    *,
    ema20: float | None = None,
    ema20_previous: float | None = None,
    sma50: float | None = None,
    sma200: float | None = None,
    benchmark_return_1d: float | None = None,
    days_since_results: int | None = None,
    catalyst_tag: str | None = None,
) -> dict:
    """Which mid-way path, if any, this stock is on, and the evidence for it.

    Returns the features unconditionally so a signal can record them even when no
    variant qualified: an audit of false positives needs the near misses too.
    """
    delivery = delivery or DeliveryHistory({})
    features: dict = {
        "setup_variant": None, "deliv_pct": None, "rel_deliv_20d": None, "ibs_close": None,
        "nifty_alpha_1d": None, "catalyst_tag": catalyst_tag, "days_since_results": days_since_results,
        "exhausted": False, "exhaustion_gain_5d": None, "exhaustion_rsi_14": None,
        "midway_score_boost": 0, "midway_reasons": [], "breakout_levels": {},
    }
    if len(series) < PATH_B_SESSIONS + 2:
        return features

    current = series[-1]
    today = delivery.day(current.date)
    rel_deliv = relative_delivery(today.deliv_qty, delivery.avg_deliv_qty_20d)
    ibs = internal_bar_strength(current)
    previous_close = series[-2].close
    stock_return_1d = ((current.close / previous_close - 1.0) * 100.0) if previous_close > 0 else None
    features.update(
        deliv_pct=today.deliv_pct, rel_deliv_20d=rel_deliv, ibs_close=ibs,
        nifty_alpha_1d=red_index_alpha(stock_return_1d, benchmark_return_1d),
        breakout_levels=breakout_levels(series),
    )

    spent, gain_5d, rsi = exhaustion(series)
    features.update(exhausted=spent, exhaustion_gain_5d=gain_5d, exhaustion_rsi_14=rsi)
    if spent:
        detail = []
        if gain_5d is not None and gain_5d > EXHAUSTION_5D_GAIN_PCT:
            detail.append(f"{gain_5d:.1f}% over five sessions, above the {EXHAUSTION_5D_GAIN_PCT:.0f}% ceiling")
        if rsi is not None and rsi >= EXHAUSTION_RSI:
            detail.append(f"14-day RSI {rsi:.0f}, at or above {EXHAUSTION_RSI:.0f}")
        features["midway_reasons"] = [
            "The move has already run: " + "; ".join(detail) + ". Mid-way entries are closed."
        ]
        return features

    if not accumulation_confirmed(today.deliv_pct, rel_deliv):
        return features
    if not _ignition_turnover_ok(series, delivery):
        return features

    in_trend = trend_regime_ok(current.close, ema20, sma50, sma200)
    rebound = (not in_trend) and ep_rebound_ok(
        current.close, ema20, ema20_previous, today.deliv_pct, days_since_results)
    if not in_trend and not rebound:
        return features

    rvol = _volume_ratio(series, len(series) - 1)
    strong_close = ibs is not None and ibs >= MIN_IBS
    # Path A takes one decisive bar. A rebound may substitute its catalyst candle's
    # delivery for the volume expansion, because the event is the ignition.
    path_a = strong_close and (
        (rvol is not None and rvol >= PATH_A_MIN_RVOL)
        or (rebound and today.deliv_pct is not None and today.deliv_pct >= EP_MIN_DELIV_PCT)
    )
    variant = None
    if path_a:
        variant = SETUP_EP_REBOUND if rebound else SETUP_STAGE2
    elif in_trend and stair_step_qualified(series):
        # The stair-step is a trend-following shape by construction; a rebound that has
        # not reclaimed its averages has no stair to step on.
        variant = SETUP_STAIR_STEP
    if variant is None:
        return features

    boost = red_index_boost(stock_return_1d, benchmark_return_1d)
    reasons = []
    if variant == SETUP_STAIR_STEP:
        reasons.append(
            f"Three consecutive strong closes on {PATH_B_MIN_AVG_RVOL:.1f}x+ average volume.")
    elif variant == SETUP_EP_REBOUND:
        reasons.append(
            f"Event rebound: results {days_since_results} session(s) ago, "
            f"{today.deliv_pct:.0f}% delivery and a reclaimed rising 20-day EMA.")
    else:
        reasons.append(
            f"Stage-2 impulse: {rvol:.1f}x volume closing in the top "
            f"{(1 - MIN_IBS) * 100:.0f}% of the bar." if rvol is not None else
            "Stage-2 impulse with a decisive close.")
    if today.deliv_pct is not None:
        reasons.append(f"{today.deliv_pct:.0f}% deliverable"
                       + (f", {rel_deliv:.1f}x the 20-session average." if rel_deliv else "."))
    if boost:
        reasons.append(
            f"Rose {stock_return_1d:.1f}% while the index fell {abs(benchmark_return_1d):.1f}%.")
    features.update(setup_variant=variant, midway_score_boost=boost, midway_reasons=reasons)
    return features


def session_volume_share(minutes: float, session_duration: float = SESSION_MINUTES) -> float:
    # Preserve the established intraday curve while scaling it to the exact
    # duration of an exceptional session such as Diwali Muhurat trading.
    minutes = min(max(minutes, 0.0), float(session_duration))
    normalized_minutes = minutes * SESSION_MINUTES / session_duration
    for (left_minutes, left_share), (right_minutes, right_share) in zip(VOLUME_CURVE, VOLUME_CURVE[1:]):
        if normalized_minutes <= right_minutes:
            return left_share + (right_share - left_share) * (normalized_minutes - left_minutes) / (right_minutes - left_minutes)
    return 1.0


def india_session_minutes(last_bar_date: str, now: datetime) -> float | None:
    """Minutes traded in the live session, or None when the last bar is complete."""
    local = now.astimezone(IST)
    if last_bar_date != local.date().isoformat():
        return None
    open_minutes, close_minutes = india_session_bounds(last_bar_date)
    minutes = (local.hour * 60 + local.minute + local.second / 60.0) - open_minutes
    return minutes if 0 <= minutes < close_minutes - open_minutes else None


def _project_live_volume(series: list[Bar], session_minutes: float | None) -> list[Bar]:
    if session_minutes is None:
        return series
    # The opening auction distorts the first quarter hour, so projection starts there.
    open_minutes, close_minutes = india_session_bounds(series[-1].date)
    duration = close_minutes - open_minutes
    share = session_volume_share(max(session_minutes, min(15.0, duration)), duration)
    return series[:-1] + [replace(series[-1], volume=series[-1].volume / share)]


def _pct(current: float, previous: float) -> float:
    return (current / previous - 1.0) * 100.0 if previous else math.nan


def execution_data_verified(source: str | None, quote_time: datetime | None, now: datetime) -> bool:
    if source != "BREEZE_LIVE" or quote_time is None:
        return False
    observed = quote_time if quote_time.tzinfo else quote_time.replace(tzinfo=timezone.utc)
    age = (now.astimezone(timezone.utc) - observed.astimezone(timezone.utc)).total_seconds()
    return 0 <= age <= 5 * 60


def _launch(series: list[Bar], index: int) -> dict | None:
    """Raw day-one test: does the bar at index finish a range breakout launch?

    The launch may take one, two or three rising sessions (a single thrust, or a
    staircase out of the base); either way it must cover at least 1.5 ATR from
    the base. The breakout day must close above the 20-session high, or trade
    through it and close within a quarter ATR of it (day two must then clear it).
    One- and two-session launches need 2x volume; a three-session staircase
    needs 1.5x with its heaviest volume on the breakout day.
    """
    bar = series[index]
    result = None
    for sessions in (1, 2, 3):
        prior = series[:index - sessions + 1]
        if len(prior) < 25:
            return result
        atr14 = _atr(prior)
        if not math.isfinite(atr14) or atr14 <= 0:
            return result
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
        closed_above = bar.close > breakout_level
        breaks_level = closed_above or (bar.high > breakout_level and bar.close >= breakout_level - 0.25 * atr14)
        volume_confirms = (
            volume_ratio >= 2.0 if sessions < 3
            else volume_ratio >= 1.5 and bar.volume >= max(item.volume for item in launch)
        )
        passed = (
            rising and breaks_level and gain_atr >= 1.5 and volume_confirms
            and close_location >= 0.6 and bar.close > ema50 and launch_return <= 10.0 * sessions ** 0.5
        )
        result = {
            "passed": passed, "bar": bar, "atr14": atr14, "breakout_level": breakout_level,
            "normal_volume": normal_volume, "gain_atr": gain_atr, "volume_ratio": volume_ratio,
            "close_location": close_location, "day_return": launch_return, "launch_sessions": sessions,
            "closed_above_breakout": closed_above,
        }
        if passed:
            return result
    return result


def _ignition(series: list[Bar], index: int) -> dict | None:
    """The first launch of a leg. A later launch in the same leg is days into the
    move, so it cannot restart the day-two clock."""
    result = _launch(series, index)
    if result and result["passed"] and any(
        (earlier := _launch(series, index - offset)) and earlier["passed"] for offset in (1, 2, 3)
    ):
        result = {**result, "passed": False, "repeat_launch": True}
    return result


def _developing_staircase(
    series: list[Bar], benchmark_closes: list[float] | None, session_minutes: float | None,
    context: MarketContext | None = None,
) -> dict | None:
    """Surface the second rising session before the stricter ignition test passes.

    The staircase alone is watch-only. It becomes a day-two continuation entry
    only above the 20-session high, after the first hour, in a rising broad
    market, for a liquid stock with top-30% 120-session strength.
    """
    if len(series) < 27 or (session_minutes is not None and session_minutes < 30):
        return None
    prior = series[:-2]
    first, current = series[-2:]
    atr14 = _atr(prior)
    if not math.isfinite(atr14) or atr14 <= 0:
        return None
    breakout_level = max(bar.high for bar in prior[-20:])
    normal_volume = sum(bar.volume for bar in prior[-20:]) / 20.0
    volume_ratio = current.volume / normal_volume if normal_volume else 0.0
    first_volume_ratio = first.volume / normal_volume if normal_volume else 0.0
    gain_atr = (current.close - prior[-1].close) / atr14
    day_range = current.high - current.low
    close_location = (current.close - current.low) / day_range if day_range > 0 else 1.0
    closes = [bar.close for bar in series]
    prior_closes = [bar.close for bar in prior]
    ema10 = _ema(closes[-40:], 10)
    ema20 = _ema(closes[-50:], 20)
    pre_impulse_ema20 = _ema(prior_closes[-50:], 20)
    pre_impulse_ema20_previous = _ema(prior_closes[:-5][-50:], 20)
    established_pre_impulse_trend = (
        prior[-1].close >= pre_impulse_ema20
        and pre_impulse_ema20 > pre_impulse_ema20_previous
    )
    distance_ema10_atr = (current.close - ema10) / atr14
    return5 = _pct(current.close, series[-6].close)
    rs5 = None
    if benchmark_closes and len(benchmark_closes) >= 6:
        rs5 = return5 - _pct(benchmark_closes[-1], benchmark_closes[-6])
    passed = (
        first.close > prior[-1].close
        and current.close > first.close
        and current.close > first.high
        and gain_atr >= 0.75
        and close_location >= 0.65
        and current.close >= breakout_level - 0.50 * atr14
        and volume_ratio >= 1.0
        and (first_volume_ratio + volume_ratio) / 2.0 >= 0.9
        and current.close > ema20
        and established_pre_impulse_trend
        and distance_ema10_atr <= 2.0
        and return5 <= 12.0
        and (rs5 is None or rs5 > 0)
    )
    if not passed:
        return None
    stop = first.low - 0.10 * atr14
    risk = current.close - stop
    target = current.close + 2.0 * risk
    geometry_valid = risk > 0 and risk / current.close <= STAIRCASE_MAX_RISK
    blockers = []
    if session_minutes is not None and session_minutes < CONFIRMATION_MINUTES:
        blockers.append("Day-two entry is assessed after the first hour of trading (10:15 IST).")
    if current.close <= breakout_level:
        blockers.append(f"Waiting for a close above the 20-session high {breakout_level:.2f}.")
    if context is None or context.regime_positive is not True:
        blockers.append("Entry is withheld because the broad market is not above its 50-session average.")
    if context is None or context.strength_rank is None or context.strength_rank < MIN_STRENGTH_RANK:
        blockers.append("Entry is withheld because 120-session strength is not in the top 30% of liquid NSE stocks.")
    if context is None or context.avg_traded_value is None or context.avg_traded_value < MIN_AVG_TRADED_VALUE:
        blockers.append("Entry is withheld because average traded value is below Rs 5 crore a session.")
    if not geometry_valid:
        blockers.append("The stop below the first session's low is more than 10% away; entry geometry is not valid.")
    ready = not blockers
    return {
        "status": "TREND_CONTINUATION_READY" if ready else "IMPULSE_DETECTED", "ready": ready,
        "entry": current.close if ready else None,
        "stop": stop if geometry_valid else None, "target": target if geometry_valid else None,
        "metrics": {
            "developing_staircase": True, "early_breakout": False,
            "setup": "DAY_TWO_STAIRCASE", "atr14": atr14,
            "expected_holding_days": STAIRCASE_HOLDING_DAYS,
            "staircase_gain_atr": gain_atr, "staircase_volume_ratio": volume_ratio,
            "staircase_first_volume_ratio": first_volume_ratio,
            "breakout_level": breakout_level, "close_location": close_location,
            "return5_pct": return5, "relative_strength5_pct": rs5,
            "distance_ema10_atr": distance_ema10_atr,
            "established_pre_impulse_trend": established_pre_impulse_trend,
            "session_minutes": session_minutes,
        },
        "reasons": [
            f"Two rising sessions have advanced {gain_atr:.2f} ATR and the latest close is above the first session's high.",
            f"The move is within 0.5 ATR of the 20-session high {breakout_level:.2f}, closes firmly, and volume is tracking at {volume_ratio:.2f}x normal.",
            "The staircase began above a rising pre-impulse EMA20 and is not yet structurally extended.",
            *(["Developing staircase only: watch now; the entry conditions below are not all met.", *blockers] if blockers
              else ["Day-two continuation entry is valid with the stop below the first session's low."]),
        ],
        "score_parts": {
            "gain_atr": gain_atr, "volume_ratio": volume_ratio,
            "close_location": close_location,
        },
    }


def _assess_day_two_breakout(
    series: list[Bar], benchmark_closes: list[float] | None, session_minutes: float | None,
    context: MarketContext | None = None,
) -> dict | None:
    """Catch an ignition on day one, confirm it during the first hour of day two."""
    live = session_minutes is not None
    today = _ignition(series, len(series) - 1)
    yesterday = _ignition(series, len(series) - 2)

    if yesterday and yesterday["passed"]:
        ignition, confirm = yesterday, series[-1]
        atr14, day_one = ignition["atr14"], ignition["bar"]
        confirm_volume_ratio = confirm.volume / ignition["normal_volume"] if ignition["normal_volume"] else 0.0
        confirm_range = confirm.high - confirm.low
        confirm_close_location = (
            (confirm.close - confirm.low) / confirm_range if confirm_range > 0 else 1.0
        )
        return5 = _pct(confirm.close, series[-6].close)
        ema10 = _ema([bar.close for bar in series][-40:], 10)
        distance_ema10_atr = (confirm.close - ema10) / atr14
        rs5 = None
        rs_acceleration = None
        if benchmark_closes and len(benchmark_closes) >= 21:
            benchmark5 = _pct(benchmark_closes[-1], benchmark_closes[-6])
            benchmark20 = _pct(benchmark_closes[-1], benchmark_closes[-21])
            rs5 = return5 - benchmark5
            rs20 = _pct(confirm.close, series[-21].close) - benchmark20
            rs_acceleration = rs5 - rs20
        rs_pass = rs5 is None or (rs5 > 0 and (rs_acceleration is None or rs_acceleration > -1.0))
        metrics = {
            "early_breakout": True, "ignition_gain_atr": ignition["gain_atr"],
            "atr14": atr14, "expected_holding_days": 5,
            "ignition_volume_ratio": ignition["volume_ratio"], "breakout_level": ignition["breakout_level"],
            "launch_sessions": ignition["launch_sessions"], "day_two_volume_ratio": confirm_volume_ratio,
            "day_two_close_location": confirm_close_location, "return5_pct": return5,
            "distance_ema10_atr": distance_ema10_atr,
            "relative_strength5_pct": rs5,
            "relative_strength_acceleration_pct": rs_acceleration,
            "session_minutes": session_minutes,
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
        clears_level = confirm.close > ignition["breakout_level"]
        closes_firm = confirm_close_location >= 0.50
        structurally_extended = distance_ema10_atr > 2.0 or return5 > 12.0
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
            f"Range breakout ignited on {day_one.date}: {ignition['gain_atr']:.2f} ATR in {ignition['launch_sessions']} session(s) on {ignition['volume_ratio']:.2f}x volume, {'closing above' if ignition['closed_above_breakout'] else 'trading through'} the 20-session high {ignition['breakout_level']:.2f}.",
            f"Day two holds the gain and the breakout level on {confirm_volume_ratio:.2f}x {'paced ' if live else ''}volume.",
        ]
        if chasing or structurally_extended:
            status, ready = "EXTENDED_RISK", False
            reasons.append(
                "Entry is blocked because day two is too far beyond the day-one close or more than 2 ATR above EMA10."
            )
        elif not clears_level:
            status, ready = "CONTINUATION_WATCH", False
            reasons.append(f"Waiting for day two to trade above the breakout level {ignition['breakout_level']:.2f}.")
        elif not volume_on_pace:
            status, ready = "CONTINUATION_WATCH", False
            reasons.append("Waiting for day-two volume to reach a normal session's pace.")
        elif not closes_firm:
            status, ready = "CONTINUATION_WATCH", False
            reasons.append("Day two is closing in the lower half of its range; wait for demand to regain control before considering entry.")
        elif not rs_pass:
            status, ready = "CONTINUATION_WATCH", False
            reasons.append("Day-two continuation is withheld because five-session relative strength versus NIFTY is not positive and stable.")
        elif not geometry_valid:
            status, ready = "CONTINUATION_WATCH", False
            reasons.append("The protective stop is more than 6% away; entry geometry is not valid.")
        elif context is not None and context.regime_positive is False:
            status, ready = "CONTINUATION_WATCH", False
            reasons.append("Entry is withheld because the broad market is below its 50-session average.")
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


def _reversed_today(series: list[Bar]) -> bool:
    """A down session that closes in the lower half of its range is undoing the move."""
    current, previous = series[-1], series[-2]
    day_range = current.high - current.low
    close_location = (current.close - current.low) / day_range if day_range > 0 else 1.0
    return current.close < previous.close and close_location < 0.5


def _simple_average(values: list[float], period: int) -> float | None:
    window = values[-period:]
    return sum(window) / len(window) if len(window) >= period else None


def assess_trend_continuation(
    bars: Iterable[Bar], benchmark_closes: list[float] | None = None, session_minutes: float | None = None,
    context: MarketContext | None = None, delivery: DeliveryHistory | None = None,
    days_since_results: int | None = None, catalyst_tag: str | None = None,
) -> dict:
    """The established continuation paths, then the mid-way rules applied over them.

    The two are kept apart deliberately. The continuation engine below is unchanged and
    still decides every case it already decided; the mid-way layer can only add a watch
    candidate the engine did not find, or close entries on a move that has already run.
    A new rule set that could silently remove the existing one's candidates would be
    impossible to attribute when the signal list changed.
    """
    series = list(bars)
    result = _assess_trend_continuation_core(series, benchmark_closes, session_minutes, context)
    projected = _project_live_volume(series, session_minutes)
    closes = [bar.close for bar in projected]
    benchmark_return_1d = None
    if benchmark_closes and len(benchmark_closes) >= 2 and benchmark_closes[-2] > 0:
        benchmark_return_1d = (benchmark_closes[-1] / benchmark_closes[-2] - 1.0) * 100.0
    midway = assess_midway(
        projected, delivery,
        ema20=_ema(closes[-50:], 20) if len(closes) >= 20 else None,
        ema20_previous=_ema(closes[-51:-1], 20) if len(closes) >= 21 else None,
        sma50=_simple_average(closes, 50), sma200=_simple_average(closes, 200),
        benchmark_return_1d=benchmark_return_1d, days_since_results=days_since_results,
        catalyst_tag=catalyst_tag,
    )
    return _apply_midway(result, midway, projected)


def _apply_midway(result: dict, midway: dict, series: list[Bar]) -> dict:
    """Fold the mid-way verdict into a continuation result.

    Three effects, in order of precedence:

    1. An exhausted move cannot be entered. This overrides a ready state the
       continuation engine granted, which is the whole point of an anti-chasing rule.
    2. A qualifying variant can raise a stock the engine did not qualify to a watch
       candidate. It never grants ready on its own: that still requires the live
       execution gates in trend_execution.py.
    3. The evidence is recorded either way, including on stocks that qualified for
       nothing, so false positives can be audited per variant rather than in aggregate.
    """
    features = {key: midway[key] for key in
                ("setup_variant", "deliv_pct", "rel_deliv_20d", "ibs_close",
                 "nifty_alpha_1d", "catalyst_tag", "days_since_results")}
    metrics = {**result.get("metrics", {}), **features,
               "breakout_levels": midway.get("breakout_levels"),
               "midway_exhausted": midway["exhausted"],
               "midway_gain_5d": midway["exhaustion_gain_5d"],
               "midway_rsi_14": midway["exhaustion_rsi_14"]}

    # Exhaustion can only take a candidate away, never create one. A stock the engine
    # did not qualify and the mid-way rules did not either is simply not a candidate:
    # promoting it to EXTENDED_RISK would persist a row for every quiet stock whose RSI
    # happened to drift over the ceiling.
    already_a_candidate = result.get("status") not in ("NOT_QUALIFIED", "INVALID_DATA", None)
    if midway["exhausted"] and (already_a_candidate or midway["setup_variant"] is not None):
        return {**result, "status": "EXTENDED_RISK", "ready": False, "entry": None,
                "metrics": metrics,
                "reasons": [*result.get("reasons", []), *midway["midway_reasons"]],
                "asof_market_date": result.get("asof_market_date") or (series[-1].date if series else None),
                "score": max(0, result.get("score", 0) - 20)}

    if midway["setup_variant"] is None:
        return {**result, "metrics": metrics}

    boosted = min(100, result.get("score", 0) + midway["midway_score_boost"])
    if result.get("status") in ("NOT_QUALIFIED", None):
        # The engine found nothing; the mid-way rules did. Scored from its own evidence
        # rather than inheriting a zero, and watch-only until execution gates pass.
        return {
            "status": "CONTINUATION_WATCH", "ready": False,
            "score": min(100, 55 + midway["midway_score_boost"]),
            "entry": None, "stop": None, "target": None,
            "asof_market_date": series[-1].date if series else None,
            "metrics": metrics, "reasons": list(midway["midway_reasons"]),
        }
    return {**result, "score": boosted, "metrics": metrics,
            "reasons": [*result.get("reasons", []), *midway["midway_reasons"]]}


def _assess_trend_continuation_core(
    bars: Iterable[Bar], benchmark_closes: list[float] | None = None, session_minutes: float | None = None,
    context: MarketContext | None = None,
) -> dict:
    """Assess both entry paths. session_minutes is set while the last bar is a live session."""
    series = _project_live_volume(list(bars), session_minutes)
    result = _assess_pullback_continuation(series, benchmark_closes)
    if result.get("ready"):
        # Pullback entries lost money on average in the 2025-26 study (222 trades,
        # 31% winners), in rising markets too, so the path is watch-only.
        result.update(status="CONTINUATION_WATCH", ready=False, entry=None)
        result["metrics"]["pullback_setup"] = True
        result["reasons"][-1] = "Orderly pullback found. Pullback entries are watch-only: they lost money on average in historical testing."
    if result["status"] == "INVALID_DATA" or len(series) < 30:
        return result
    # A staircase that passes every entry gate is decided first: the breakout path
    # would otherwise file a breakout-day staircase under "assess tomorrow".
    staircase = _developing_staircase(series, benchmark_closes, session_minutes, context)
    early = staircase if staircase and staircase["ready"] else (
        _assess_day_two_breakout(series, benchmark_closes, session_minutes, context) or staircase
    )
    result.setdefault("metrics", {})["early_breakout"] = False
    if early is None and _reversed_today(series):
        # The list is for moves that are still going; a reversal day is not one.
        # (The day-two breakout path has its own hold-the-gain test.)
        return {"status": "NOT_QUALIFIED", "ready": False, "score": 0,
                "metrics": {"reversed": True, "early_breakout": False},
                "reasons": ["Today is a down session closing in the lower half of its range; the move has reversed."]}
    if early is None:
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
    day_range = current.high - current.low
    close_location = (current.close - current.low) / day_range if day_range > 0 else 1.0
    # An orderly pullback finds support into the close; a bar sold into its lower
    # half (a reversal after a run) is distribution, not an entry.
    pullback = (
        current.low <= ema10 + 0.75 * atr14 and current.close >= ema10 and impulse_age > 0
        and close_location >= 0.5
    )
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
        if current.low <= ema10 + 0.75 * atr14 and current.close >= ema10 and impulse_age > 0 and close_location < 0.5:
            reasons.append("The pullback closed in the lower half of its range; wait for a session that holds support.")
        else:
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
            "rising_lows": rising_lows, "breakout": breakout, "pullback": pullback, "close_location": close_location, "impulse_age_sessions": impulse_age,
            "pre_impulse_ema20": pre_impulse_ema20,
            "established_pre_impulse_trend": established_pre_impulse_trend,
        },
        "reasons": reasons,
    }


def build_market_contexts(
    history: dict[str, list[Bar]], live_date: str | None = None,
) -> tuple[bool | None, dict[str, MarketContext]]:
    """Broad-market regime and per-stock strength rank from the loaded bars.

    The regime is an equal-weighted index of liquid stocks' completed daily
    returns compared with its own 50-session average. live_date is the session
    still trading, which is left out of the regime.
    """
    traded_value: dict[str, float] = {}
    strength: dict[str, float] = {}
    returns_by_date: dict[str, list[float]] = {}
    for asset_id, bars in history.items():
        if len(bars) < 21:
            continue
        value = sum(bar.close * bar.volume for bar in bars[-21:-1]) / 20.0
        if not math.isfinite(value):
            continue
        traded_value[asset_id] = value
        # A stock counts towards a session's market return only if it was liquid
        # going into that session. Judging liquidity as of today instead would
        # favour stocks that have since risen and overstate the market.
        turnover = [bar.close * bar.volume for bar in bars]
        rolling = sum(turnover[:20])
        for index in range(20, len(bars)):
            bar, previous = bars[index], bars[index - 1]
            if (rolling / 20.0 >= MIN_AVG_TRADED_VALUE and bar.date != live_date
                    and previous.close > 0 and math.isfinite(bar.close)):
                returns_by_date.setdefault(bar.date, []).append(bar.close / previous.close - 1.0)
            rolling += turnover[index] - turnover[index - 20]
        if value < MIN_AVG_TRADED_VALUE:
            continue
        if len(bars) > STRENGTH_SESSIONS and bars[-STRENGTH_SESSIONS - 1].close > 0:
            strength[asset_id] = bars[-1].close / bars[-STRENGTH_SESSIONS - 1].close - 1.0
    # A date only a few stocks traded (a stale or partial session) is not the market.
    broadest = max((len(values) for values in returns_by_date.values()), default=0)
    level, index = 1.0, []
    for date_value in sorted(returns_by_date):
        values = returns_by_date[date_value]
        if len(values) >= 0.5 * broadest:
            level *= 1.0 + sum(values) / len(values)
            index.append(level)
    regime = index[-1] > sum(index[-REGIME_SESSIONS:]) / REGIME_SESSIONS if len(index) >= REGIME_SESSIONS else None
    ordered = sorted(strength.values())
    contexts = {}
    for asset_id, value in traded_value.items():
        rank = None
        if asset_id in strength and ordered:
            rank = bisect.bisect_right(ordered, strength[asset_id]) / len(ordered)
        contexts[asset_id] = MarketContext(regime, rank, value)
    return regime, contexts


def _rows_to_bars(rows) -> list[Bar]:
    return [Bar(str(row[1]), *[float(value) if value is not None else math.nan for value in row[2:]]) for row in rows]



def load_delivery(cur, asset_ids: list[str], sessions: int = 40) -> dict[str, DeliveryHistory]:
    """Recent deliverable-quantity rows per asset, with their 20-session baseline.

    ETF, REIT and InvIT rows are excluded here as well as at ingestion. They settle at
    or near 100% delivery by construction, so including them would mark every one of
    them as maximum institutional conviction on every single session.
    """
    cur.execute(
        """select asset_id::text,date::text,deliv_pct,deliv_qty,turnover from (
             select d.*,row_number() over(partition by asset_id order by date desc) rn
               from public.daily_delivery_metrics d
              where asset_id = any(%s::uuid[]) and not is_etf
           ) ranked where rn <= %s order by asset_id,date""",
        (asset_ids, sessions),
    )
    by_asset: dict[str, list[tuple]] = {}
    for row in cur.fetchall():
        by_asset.setdefault(row[0], []).append(row)
    out: dict[str, DeliveryHistory] = {}
    for asset_id, rows in by_asset.items():
        days = {
            row[1]: DeliveryDay(
                deliv_pct=None if row[2] is None else float(row[2]),
                deliv_qty=None if row[3] is None else float(row[3]),
                turnover=None if row[4] is None else float(row[4]),
            )
            for row in rows
        }
        # The baseline is the twenty sessions *before* the most recent one. Including
        # the ignition day in its own baseline would damp the ratio it is measured by,
        # which is the one number meant to show the day was abnormal.
        prior = [row[3] for row in rows[:-1] if row[3] is not None][-20:]
        baseline = sum(float(value) for value in prior) / len(prior) if prior else None
        out[asset_id] = DeliveryHistory(days, baseline)
    return out


def load_recent_results(cur, asset_ids: list[str], session_dates: list[str],
                        today: str) -> dict[str, int]:
    """Trading sessions since the most recent declared result, per asset.

    Counted in sessions actually present in the price history rather than calendar
    days, so exchange holidays do not make a result look older than it is.
    """
    cur.execute(
        """select asset_id::text,max(event_date)::text from public.corporate_events
            where asset_id = any(%s::uuid[]) and event_date <= %s::date
              and event_date >= %s::date - interval '40 days'
            group by asset_id""",
        (asset_ids, today, today),
    )
    sessions_by_date = {value: index for index, value in enumerate(session_dates)}
    latest_index = len(session_dates) - 1
    out: dict[str, int] = {}
    for asset_id, event_date in cur.fetchall():
        if event_date is None:
            continue
        index = sessions_by_date.get(event_date)
        if index is None:
            # The result fell on a non-trading day; count from the next session that did trade.
            later = [value for value in session_dates if value >= event_date]
            if not later:
                continue
            index = sessions_by_date[later[0]]
        out[asset_id] = max(0, latest_index - index)
    return out


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
                ) ranked where rn <= %s order by asset_id,date""", (asset_ids, STRENGTH_SESSIONS + 5))
            history_rows = cur.fetchall()
            cur.execute("""select asset_id::text,source,updated_at from public.latest_quotes
                where asset_id = any(%s::uuid[])""", (asset_ids,))
            quote_rows = cur.fetchall()
            cur.execute("""select o.asset_id::text,o.date,o.open,o.high,o.low,o.close,o.volume
                from public.daily_ohlcv o where o.asset_id in (
                  select id from public.assets where country='IN' and ticker in ('NIFTY','NIFTY 50')
                ) order by o.date desc limit 80""")
            benchmark_rows = list(reversed(cur.fetchall()))
            delivery_by_asset = load_delivery(cur, asset_ids)
        benchmark = [float(row[5]) for row in benchmark_rows]
        history_by_asset = {}
        for row in history_rows:
            history_by_asset.setdefault(row[0], []).append(row)
        quotes = {row[0]: (row[1], row[2]) for row in quote_rows}
        now = datetime.now(timezone.utc)
        bars_by_asset = {asset_id: _rows_to_bars(rows) for asset_id, rows in history_by_asset.items()}
        today = now.astimezone(IST).date().isoformat()
        live_date = today if india_session_minutes(today, now) is not None else None
        session_dates = sorted({str(row[1]) for row in history_rows})
        with conn.cursor() as cur:
            results_by_asset = load_recent_results(cur, asset_ids, session_dates, today)
        regime, contexts = build_market_contexts(bars_by_asset, live_date)
        payload = []
        assessed_dates = set()
        for asset_id, ticker, name in assets:
            asset_history = history_by_asset.get(asset_id, [])
            if asset_history:
                assessed_dates.add(asset_history[-1][1])
            # The signal maths keeps its 80-session window; the extra history is only for strength.
            asset_bars = bars_by_asset.get(asset_id, [])[-80:]
            session_minutes = india_session_minutes(asset_bars[-1].date, now) if asset_bars else None
            context = contexts.get(asset_id, MarketContext(regime, None, None))
            days_since_results = results_by_asset.get(asset_id)
            catalyst_tag = (CATALYST_EP
                            if days_since_results is not None
                            and days_since_results <= EP_MAX_DAYS_SINCE_RESULTS
                            else CATALYST_TECH)
            result = assess_trend_continuation(
                asset_bars, benchmark, session_minutes, context,
                delivery=delivery_by_asset.get(asset_id),
                days_since_results=days_since_results, catalyst_tag=catalyst_tag)
            result.setdefault("metrics", {}).update(
                market_regime_positive=context.regime_positive, strength_rank_120=context.strength_rank,
                avg_traded_value_20=context.avg_traded_value,
            )
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
            metrics = result["metrics"]
            payload.append((asset_id, ticker, name, result["asof_market_date"], result["status"], result.get("ready", False),
                            result["score"], result.get("entry"), result.get("stop"), result.get("target"),
                            json.dumps(metrics), json.dumps(result["reasons"]), FEATURE_VERSION,
                            metrics.get("setup_variant"), metrics.get("deliv_pct"),
                            metrics.get("rel_deliv_20d"), metrics.get("ibs_close"),
                            metrics.get("nifty_alpha_1d"), metrics.get("catalyst_tag"),
                            metrics.get("days_since_results")))
        with conn.cursor() as cur:
            cur.execute("""delete from public.trend_continuation_signals s using public.assets a
                where s.asset_id=a.id and (a.exchange <> 'NSE' or s.asof_market_date=any(%s::date[]))""",
                (sorted(assessed_dates),))
            if payload:
                execute_values(cur, """insert into public.trend_continuation_signals
                    (asset_id,ticker,name,asof_market_date,status,ready,score,entry,stop,target,metrics,reasons,feature_version,
                     setup_variant,deliv_pct,rel_deliv_20d,ibs_close,nifty_alpha_1d,catalyst_tag,days_since_results)
                    values %s on conflict(asset_id,asof_market_date,feature_version) do update set
                    ticker=excluded.ticker,name=excluded.name,status=excluded.status,ready=excluded.ready,
                    score=excluded.score,entry=excluded.entry,stop=excluded.stop,target=excluded.target,
                    metrics=excluded.metrics,reasons=excluded.reasons,computed_at=now(),
                    setup_variant=excluded.setup_variant,deliv_pct=excluded.deliv_pct,
                    rel_deliv_20d=excluded.rel_deliv_20d,ibs_close=excluded.ibs_close,
                    nifty_alpha_1d=excluded.nifty_alpha_1d,catalyst_tag=excluded.catalyst_tag,
                    days_since_results=excluded.days_since_results""", payload, page_size=500)
        conn.commit()
        print(f"[trend-continuation] assessed={len(assets)} stored={len(payload)} regime_positive={regime} version={FEATURE_VERSION}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
