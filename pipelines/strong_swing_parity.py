#!/usr/bin/env python3
"""Recompute Strong Swing levels in Python and compare them with what the app recorded.

The app calculates Strong Swing in TypeScript. This is a separate, read-only
implementation of the same arithmetic over completed daily bars, used to check
that a recorded snapshot's ATR, breakout flag, entry, stop, target and trail
follow from the bars up to its own latest bar date, and that a snapshot taken
while the market was open does not rest on that day's unfinished candle.

Run it against any capture: an old one to measure how far the earlier
calculation drifted (backward), or the newest one after a release (forward).
It writes nothing.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
from dataclasses import dataclass
from datetime import date
from statistics import mean, stdev

import psycopg2

ATR_PERIOD = 14
CONFIRMATION_ATR_BUFFER = 0.25
TIME_ZONES = {"IN": "Asia/Kolkata", "US": "America/New_York"}
SESSION_CLOSE = {"IN": "15:30", "US": "16:00"}


@dataclass(frozen=True)
class Bar:
    date: date
    high: float
    low: float
    close: float


def round2(value: float) -> float:
    """JavaScript's Math.round(value * 100) / 100."""
    scaled = value * 100
    whole = math.floor(scaled)
    return (whole + (1 if scaled - whole >= 0.5 else 0)) / 100


def average_true_range(bars: list[Bar], period: int = ATR_PERIOD) -> float:
    ranges = [
        max(bar.high - bar.low, abs(bar.high - previous.close), abs(bar.low - previous.close))
        for previous, bar in zip(bars, bars[1:])
    ][-period:]
    return sum(ranges) / len(ranges) if ranges else 0.0


def structural_breakout(bars: list[Bar], period: int = 20, deviations: float = 2.0) -> bool:
    if len(bars) < period + 1:
        return False
    closes = [bar.close for bar in bars[-period:]]
    upper = mean(closes) + deviations * stdev(closes)
    prior_high = max(bar.high for bar in bars[-period - 1:-1])
    return bars[-1].close > prior_high or bars[-1].close > upper


def confirmation_breakout(bars: list[Bar]) -> bool:
    """A structural breakout on either of the two confirmation bars."""
    return structural_breakout(bars) or structural_breakout(bars[:-1])


def protective_stop(entry: float, atr: float, stop_mult: float) -> float:
    return round2(max(0.0, round2(entry) - stop_mult * atr))


def breakout_level(bars: list[Bar]) -> float:
    window = bars[-22:-2]
    return max(bar.high for bar in window) if window else bars[-1].close


def plan(bars: list[Bar], stop_mult: float = 1.5, target_rr: float = 2.0) -> dict:
    """Every Strong Swing level, from completed bars alone."""
    atr = average_true_range(bars)
    level = breakout_level(bars)
    confirmation = level + CONFIRMATION_ATR_BUFFER * atr
    entry = round2(confirmation)
    stop = protective_stop(confirmation, atr, stop_mult)
    prior_atr = average_true_range(bars[:-1])
    return {
        "atr": atr,
        "atr_pct": atr / bars[-1].close * 100 if bars[-1].close > 0 else math.inf,
        "breakout": confirmation_breakout(bars),
        "entry": confirmation,
        "stop": stop,
        "target": round2(entry + target_rr * (entry - stop)),
        # A position's trail starts at its protective stop; only highs after entry advance it.
        "trail": stop,
        # The stop as it stood before the latest bar: that bar's range is not allowed to move it.
        "invalidation_trail": protective_stop(level + CONFIRMATION_ATR_BUFFER * prior_atr, prior_atr, stop_mult),
    }


def differences(recorded: dict, expected: dict, tolerance: float = 0.011, atr_tolerance_pct: float = 0.5) -> list[str]:
    """Names of the recorded values that do not follow from the bars."""
    out = []
    for key in ("entry", "stop", "target", "trail"):
        # The target is built from the rounded entry and stop, so it carries their rounding twice over.
        allowed = tolerance * 3 if key == "target" else tolerance
        if recorded.get(key) is None or abs(recorded[key] - expected[key]) > allowed:
            out.append(key)
    atr_pct = recorded.get("atr_pct")
    if expected["atr_pct"] <= 0:
        if atr_pct:
            out.append("atr")
    elif atr_pct is None or abs(atr_pct / expected["atr_pct"] - 1) * 100 > atr_tolerance_pct:
        out.append("atr")
    if recorded.get("breakout") is not None and recorded["breakout"] != expected["breakout"]:
        out.append("breakout")
    # Recorded only by captures made with the completed-bar calculation.
    recorded_atr = recorded.get("atr")
    if recorded_atr is not None and "atr" not in out and abs(recorded_atr - expected["atr"]) > 1e-6 * max(1.0, expected["atr"]):
        out.append("atr")
    recorded_trail = recorded.get("invalidation_trail")
    if recorded_trail is not None and abs(recorded_trail - expected["invalidation_trail"]) > tolerance:
        out.append("invalidation_trail")
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--market", choices=("IN", "US"), default="IN")
    parser.add_argument("--captured-at", help="Capture timestamp to check; defaults to the newest for the market")
    parser.add_argument("--stop-mult", type=float, default=1.5)
    parser.add_argument("--target-rr", type=float, default=2.0)
    parser.add_argument("--show", type=int, default=10, help="Mismatching stocks to list")
    args = parser.parse_args()
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("DATABASE_URL is required", file=sys.stderr)
        return 1

    with psycopg2.connect(url) as conn:
        conn.set_session(readonly=True)
        with conn.cursor() as cur:
            cur.execute(
                """select captured_at,(captured_at at time zone %s)::date,
                          (captured_at at time zone %s)::time < %s::time
                     from public.strong_swing_snapshots
                    where market=%s and (%s::timestamptz is null or captured_at=%s::timestamptz)
                    order by captured_at desc limit 1""",
                (TIME_ZONES[args.market], TIME_ZONES[args.market], SESSION_CLOSE[args.market],
                 args.market, args.captured_at, args.captured_at),
            )
            found = cur.fetchone()
            if not found:
                print("No snapshot found", file=sys.stderr)
                return 1
            captured_at, capture_date, before_close = found
            cur.execute(
                """select asset_id::text,ticker,status,confirmation_entry,projected_stop,projected_target,
                          projected_trail,latest_bar_date,metrics,gates
                     from public.strong_swing_snapshots where market=%s and captured_at=%s""",
                (args.market, captured_at),
            )
            rows = cur.fetchall()
            cur.execute(
                """select asset_id::text,date,high,low,close from (
                     select o.asset_id,o.date,o.high,o.low,o.close,
                            row_number() over(partition by o.asset_id order by o.date desc) rn
                       from public.daily_ohlcv o
                       join public.strong_swing_snapshots s
                         on s.asset_id=o.asset_id and s.market=%s and s.captured_at=%s
                        and o.date <= s.latest_bar_date
                   ) ranked where rn <= 60 order by asset_id,date""",
                (args.market, captured_at),
            )
            bars: dict[str, list[Bar]] = {}
            for asset_id, day, high, low, close in cur.fetchall():
                bars.setdefault(asset_id, []).append(Bar(day, float(high), float(low), float(close)))

    counts: dict[str, int] = {}
    unfinished = skipped = clean = 0
    worst: list[tuple[float, str]] = []
    for asset_id, ticker, status, entry, stop, target, trail, latest_bar, metrics, gates in rows:
        series = bars.get(asset_id, [])
        if len(series) < 23:
            skipped += 1
            continue
        if before_close and latest_bar >= capture_date:
            unfinished += 1
        metrics = metrics if isinstance(metrics, dict) else json.loads(metrics or "{}")
        gates = gates if isinstance(gates, list) else json.loads(gates or "[]")
        structure = next((gate.get("passed") for gate in gates if gate.get("key") == "structure"), None)
        expected = plan(series, args.stop_mult, args.target_rr)
        recorded = {
            "entry": float(entry), "stop": float(stop), "target": float(target), "trail": float(trail),
            "atr_pct": float(metrics["atrPct"]) if metrics.get("atrPct") is not None else None,
            "breakout": structure,
            "atr": float(metrics["atr"]) if metrics.get("atr") is not None else None,
            "invalidation_trail": float(metrics["invalidationTrail"]) if metrics.get("invalidationTrail") is not None else None,
        }
        wrong = differences(recorded, expected)
        if not wrong:
            clean += 1
        for key in wrong:
            counts[key] = counts.get(key, 0) + 1
        if "atr" in wrong and recorded["atr_pct"]:
            gap = (recorded["atr_pct"] / expected["atr_pct"] - 1) * 100
            worst.append((gap, f"{ticker} {status}: recorded ATR {recorded['atr_pct']:.2f}% of price, bars give {expected['atr_pct']:.2f}% ({gap:+.1f}%)"))

    checked = len(rows) - skipped
    print(f"[strong-swing-parity] {args.market} capture {captured_at}: {checked} candidates checked, "
          f"{clean} match on every value, {skipped} skipped for short history")
    for key in ("atr", "breakout", "entry", "stop", "target", "trail", "invalidation_trail"):
        print(f"  {key}: {counts.get(key, 0)} differ")
    print(f"  taken during the session with a bar from that day: {unfinished}")
    for _gap, line in sorted(worst, key=lambda item: -abs(item[0]))[: args.show]:
        print(f"  {line}")
    return 0 if clean == checked and unfinished == 0 else 3


if __name__ == "__main__":
    raise SystemExit(main())
