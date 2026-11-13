from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Bar:
    date: str
    open: float
    high: float
    low: float
    close: float
    volume: float
    open_interest: float | None = None

    @classmethod
    def from_json(cls, value: dict[str, Any]) -> "Bar":
        oi = value.get("openInterest")
        return cls(
            date=str(value["date"])[:10],
            open=float(value["open"]),
            high=float(value["high"]),
            low=float(value["low"]),
            close=float(value["close"]),
            volume=float(value.get("volume") or 0),
            open_interest=None if oi is None else float(oi),
        )


def mean(values: list[float]) -> float:
    total = 0.0
    for value in values:
        total += value
    return total / len(values) if values else 0.0


def sma(values: list[float], period: int, end: int | None = None) -> float | None:
    end = len(values) if end is None else end
    return None if end < period else mean(values[end - period:end])


def pct_change(start: float, end: float) -> float | None:
    if start <= 0 or not math.isfinite(start) or not math.isfinite(end):
        return None
    return ((end - start) / start) * 100


def js_round(value: float) -> int:
    return math.floor(value + 0.5)


def round2(value: float) -> float:
    return js_round(value * 100) / 100


def average_true_range(bars: list[Bar], period: int = 14) -> float:
    ranges = [
        max(bar.high - bar.low, abs(bar.high - previous.close), abs(bar.low - previous.close))
        for previous, bar in zip(bars, bars[1:])
    ][-period:]
    return mean(ranges)


def structural_breakout(bars: list[Bar], period: int = 20, deviations: float = 2.0) -> bool:
    if len(bars) < period + 1:
        return False
    closes = [bar.close for bar in bars[-period:]]
    avg = mean(closes)
    variance = sum((value - avg) ** 2 for value in closes) / (len(closes) - 1)
    upper = avg + deviations * math.sqrt(variance)
    prior_high = max(bar.high for bar in bars[-period - 1:-1])
    return bars[-1].close > prior_high or bars[-1].close > upper


def finite_or_none(value: float | None) -> float | None:
    return value if value is not None and math.isfinite(value) else None

