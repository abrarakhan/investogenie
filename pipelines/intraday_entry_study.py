#!/usr/bin/env python3
"""What the entry band actually offers when it is read against a live quote.

The replay judges the band once, at the open, and takes only the days whose open fell
inside it. The live screen re-reads it against the quote every minute, so it also offers
every day that walked into the band later — 1,642 of them against 612 taken, which is
too large a difference for the measured record to describe the deployed system.

This settles it with the one-minute paths of those same sessions:

* a *taken* day is re-graded from its intraday path, to check the open fill was real;
* a *near miss* is checked for whether the band was ever reached, and graded from the
  first price inside it if so;
* the two together are the live-equivalent set — what a person watching the screen all
  session could have bought — against which the open-only record can finally be read.

The entry bar is graded minute by minute, not from its daily range: a daily bar's low
may have happened before the fill, and crediting a stop to a price the position did not
yet hold would make the intraday arm look worse than it was for a reason that is purely
bookkeeping.
"""
from __future__ import annotations

import argparse
import os
from dataclasses import dataclass
from statistics import median

import psycopg2

from strategy_math.strong_swing import ENTRY_BAND_MAX_ATR, ENTRY_BAND_MIN_ATR


@dataclass(frozen=True)
class Candle:
    stamp: str
    open: float
    high: float
    low: float
    close: float


# How far a scaled session may fall outside its own daily bar before it is treated as a
# different instrument rather than a rounding difference between two data sources.
SCALE_TOLERANCE = 0.01


def adjustment_factor(daily_close: float, minutes: list[Candle]) -> float | None:
    """Put a raw Breeze session on the same scale as the adjusted daily bars.

    daily_ohlcv is fetched with auto_adjust, so its prices are restated for every split and
    dividend since; Breeze returns the prices that actually traded. For a 2017 signal those
    differ by a third, and a band computed on one scale cannot be matched against candles on
    the other -- the first version of this study silently did exactly that and produced a
    result that disagreed with the daily replay for no real reason.

    The factor is constant within a session, so one ratio taken at the close converts the
    whole day. The last candle is not the official close to the paisa, which is why the
    caller checks the scaled session against its own daily bar before trusting it.
    """
    if not minutes or minutes[-1].close <= 0 or daily_close <= 0:
        return None
    return daily_close / minutes[-1].close


def rescale(minutes: list[Candle], factor: float) -> list[Candle]:
    return [Candle(c.stamp, c.open * factor, c.high * factor, c.low * factor, c.close * factor)
            for c in minutes]


def scale_is_credible(minutes: list[Candle], day: Candle) -> bool:
    """Whether a scaled session actually lies inside the daily bar it claims to be."""
    if not minutes:
        return False
    high = max(candle.high for candle in minutes)
    low = min(candle.low for candle in minutes)
    return high <= day.high * (1 + SCALE_TOLERANCE) and low >= day.low * (1 - SCALE_TOLERANCE)


def band(entry: float, atr: float) -> tuple[float, float]:
    return entry + ENTRY_BAND_MIN_ATR * atr, entry + ENTRY_BAND_MAX_ATR * atr


def first_touch(candles: list[Candle], floor: float, ceiling: float) -> tuple[int, float] | None:
    """Index and fill price of the first candle whose range meets the band.

    A candle opening inside the band fills at its open. One that opens under the floor and
    trades up through it fills at the floor, and one that opens over the ceiling and trades
    down into it fills at the ceiling: those are the first prices inside the band that the
    candle proves were available, and claiming any better price inside it would be
    inventing a fill the data does not support.
    """
    for index, candle in enumerate(candles):
        if candle.high < floor or candle.low > ceiling:
            continue
        if floor <= candle.open <= ceiling:
            return index, candle.open
        return index, floor if candle.open < floor else ceiling
    return None


@dataclass(frozen=True)
class Result:
    exit_price: float
    exit_reason: str
    return_pct: float
    sessions_held: int


def walk(entry_price: float, stop: float, target: float,
         minutes: list[Candle], days: list[Candle], horizon: int) -> Result | None:
    """Carry the position from its fill to a stop, a target or the horizon.

    The entry session is walked minute by minute from the fill onward; every later session
    is a daily bar. A bar spanning both levels is scored as the stop, and a gap through
    either fills at the open, matching strong_swing_replay.grade so the two arms can be
    compared without a methodology difference doing the work.
    """
    if entry_price <= 0:
        return None
    pct = lambda value: (value / entry_price - 1.0) * 100.0

    for candle in minutes:
        if candle.low <= stop:
            return Result(min(stop, candle.open), "STOP", pct(min(stop, candle.open)), 1)
        if candle.high >= target:
            return Result(max(target, candle.open), "TARGET", pct(max(target, candle.open)), 1)

    path = days[:max(0, horizon - 1)]
    for index, candle in enumerate(path):
        if candle.low <= stop:
            price = min(stop, candle.open)
            return Result(price, "STOP", pct(price), index + 2)
        if candle.high >= target:
            price = max(target, candle.open)
            return Result(price, "TARGET", pct(price), index + 2)
    if not path:
        # The fill session is all the history there is; mark it out at its own close.
        return Result(minutes[-1].close, "HORIZON", pct(minutes[-1].close), 1) if minutes else None
    return Result(path[-1].close, "HORIZON", pct(path[-1].close), len(path) + 1)


def summarize(results: list[Result]) -> dict:
    if not results:
        return {"graded": 0}
    returns = [item.return_pct for item in results]
    wins = [value for value in returns if value > 0]
    return {
        "graded": len(results),
        "win_rate_pct": len(wins) / len(results) * 100,
        "expectancy_pct": sum(returns) / len(returns),
        "median_pct": median(returns),
        "target_hits": sum(item.exit_reason == "TARGET" for item in results),
        "stop_hits": sum(item.exit_reason == "STOP" for item in results),
        "total_pct": sum(returns),
    }


def load_signals(cur, run_id: str) -> list[dict]:
    cur.execute(
        """select asset_id::text,ticker,signal_date,entry_date,plan_entry,plan_stop,
                  plan_target,atr,near_miss,return_pct
             from public.strong_swing_replay_signals
            where run_id=%s and entry_date is not null and atr > 0
            order by entry_date""",
        (run_id,),
    )
    keys = ("asset_id", "ticker", "signal_date", "entry_date", "entry", "stop",
            "target", "atr", "near_miss", "open_return_pct")
    return [dict(zip(keys, row)) for row in cur.fetchall()]


def load_minutes(cur, asset_id: str, day) -> list[Candle]:
    cur.execute(
        """select to_char(bar_time at time zone 'Asia/Kolkata','HH24:MI'),open,high,low,close
             from public.intraday_bars
            where asset_id=%s and (bar_time at time zone 'Asia/Kolkata')::date=%s
            order by bar_time""",
        (asset_id, day),
    )
    return [Candle(row[0], float(row[1]), float(row[2]), float(row[3]), float(row[4]))
            for row in cur.fetchall()]


def load_day(cur, asset_id: str, day) -> Candle | None:
    cur.execute(
        """select date::text,open,high,low,close from public.daily_ohlcv
            where asset_id=%s and date=%s""",
        (asset_id, day),
    )
    row = cur.fetchone()
    return None if not row else Candle(row[0], float(row[1]), float(row[2]), float(row[3]), float(row[4]))


def load_days(cur, asset_id: str, after, horizon: int) -> list[Candle]:
    cur.execute(
        """select date::text,open,high,low,close from public.daily_ohlcv
            where asset_id=%s and date > %s order by date limit %s""",
        (asset_id, after, horizon),
    )
    return [Candle(row[0], float(row[1]), float(row[2]), float(row[3]), float(row[4]))
            for row in cur.fetchall()]


def report(title: str, stats: dict) -> None:
    if not stats.get("graded"):
        print(f"  {title:<28} no graded trades")
        return
    print(f"  {title:<28} {stats['graded']:>5} trades  "
          f"{stats['win_rate_pct']:>5.1f}% win  {stats['expectancy_pct']:+6.2f}% avg  "
          f"median {stats['median_pct']:+6.2f}%  total {stats['total_pct']:+8.0f}%")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--horizon", type=int, default=20)
    options = parser.parse_args()
    if not os.environ.get("DATABASE_URL"):
        raise SystemExit("DATABASE_URL is required")

    taken: list[Result] = []
    reached: list[Result] = []
    unreached = missing = mismatched = 0
    reach_minutes: list[int] = []

    with psycopg2.connect(os.environ["DATABASE_URL"]) as conn:
        with conn.cursor() as cur:
            signals = load_signals(cur, options.run_id)
            print(f"Studying {len(signals)} signals from run {options.run_id}\n", flush=True)
            for position, signal in enumerate(signals, start=1):
                minutes = load_minutes(cur, signal["asset_id"], signal["entry_date"])
                day = load_day(cur, signal["asset_id"], signal["entry_date"])
                if not minutes or day is None:
                    missing += 1
                    continue
                factor = adjustment_factor(day.close, minutes)
                if factor is None:
                    missing += 1
                    continue
                minutes = rescale(minutes, factor)
                if not scale_is_credible(minutes, day):
                    mismatched += 1
                    continue
                floor, ceiling = band(float(signal["entry"]), float(signal["atr"]))
                touch = first_touch(minutes, floor, ceiling)
                if touch is None:
                    unreached += 1
                    continue
                index, fill = touch
                days = load_days(cur, signal["asset_id"], signal["entry_date"], options.horizon)
                result = walk(fill, float(signal["stop"]), float(signal["target"]),
                              minutes[index + 1:], days, options.horizon)
                if result is None:
                    continue
                reach_minutes.append(index)
                (reached if signal["near_miss"] else taken).append(result)
                if position % 500 == 0:
                    print(f"  {position}/{len(signals)} studied", flush=True)

    print(f"\nIntraday entry study — band {ENTRY_BAND_MIN_ATR}-{ENTRY_BAND_MAX_ATR} ATR above entry")
    print(f"  sessions without intraday data: {missing}")
    print(f"  sessions whose scale disagreed: {mismatched}")
    print(f"  never reached the band:         {unreached}")
    if reach_minutes:
        print(f"  median minutes to first touch:  {int(median(reach_minutes))}\n")
    report("Taken, intraday fill", summarize(taken))
    report("Near misses that reached", summarize(reached))
    report("Live-equivalent (both)", summarize(taken + reached))


if __name__ == "__main__":
    main()
