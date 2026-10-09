"""Deterministic normalized feature construction for Strong Swing snapshots."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Mapping, Sequence


D = Decimal
ZERO = D("0")
HUNDRED = D("100")


@dataclass(frozen=True)
class FeatureBar:
    close: Decimal
    open: Decimal
    high: Decimal
    low: Decimal
    volume: Decimal


def _mean(values: Sequence[Decimal]) -> Decimal | None:
    return sum(values, ZERO) / D(len(values)) if values else None


def _ema(values: Sequence[Decimal], period: int) -> Decimal | None:
    if len(values) < period:
        return None
    alpha = D("2") / D(period + 1)
    value = _mean(values[:period])
    assert value is not None
    for current in values[period:]:
        value = current * alpha + value * (D("1") - alpha)
    return value


def _pct_distance(price: Decimal, average: Decimal | None) -> Decimal | None:
    return (price / average - D("1")) * HUNDRED if average and average > ZERO else None


def _metric_decimal(metrics: Mapping[str, object], key: str) -> Decimal | None:
    value = metrics.get(key)
    if value is None or isinstance(value, bool):
        return None
    return D(str(value))


def liquidity_bucket(average_traded_value: Decimal | None) -> str:
    if average_traded_value is None:
        return "UNKNOWN"
    if average_traded_value >= D("250000000"):
        return "HIGH"
    if average_traded_value >= D("50000000"):
        return "MEDIUM"
    return "LOW"


def build_feature_vector(
    bars: Sequence[FeatureBar],
    metrics: Mapping[str, object],
) -> dict[str, str | int | None]:
    if len(bars) < 26:
        raise ValueError("at least 26 point-in-time bars are required")
    closes = [bar.close for bar in bars]
    latest = bars[-1]
    atr_pct = _metric_decimal(metrics, "atrPct")
    if atr_pct is None or atr_pct <= ZERO or latest.close <= ZERO:
        raise ValueError("positive frozen ATR percentage is required")
    atr = latest.close * atr_pct / HUNDRED
    ema12 = _ema(closes, 12)
    ema26 = _ema(closes, 26)
    if ema12 is None or ema26 is None:
        raise ValueError("MACD history is incomplete")
    macd = ema12 - ema26
    macd_series: list[Decimal] = []
    for end in range(26, len(closes) + 1):
        short = _ema(closes[:end], 12)
        long = _ema(closes[:end], 26)
        assert short is not None and long is not None
        macd_series.append(short - long)
    macd_signal = _ema(macd_series, 9)
    sma20 = _mean(closes[-20:])
    sma50 = _mean(closes[-50:]) if len(closes) >= 50 else None
    sma200 = _mean(closes[-200:]) if len(closes) >= 200 else None
    prior_high = max(bar.high for bar in bars[-21:-1])
    previous_close = bars[-2].close

    def text(value: Decimal | None) -> str | None:
        return format(value, "f") if value is not None else None

    return {
        "atr_pct": text(atr_pct),
        "macd_atr": text(macd / atr),
        "macd_signal_atr": text(macd_signal / atr if macd_signal is not None else None),
        "distance_sma20_pct": text(_pct_distance(latest.close, sma20)),
        "distance_sma50_pct": text(_pct_distance(latest.close, sma50)),
        "distance_sma200_pct": text(_pct_distance(latest.close, sma200)),
        "relative_strength20_pct": text(_metric_decimal(metrics, "relativeStrength20Pct")),
        "volume_ratio": text(_metric_decimal(metrics, "volumeRatio")),
        "breakout_clearance_atr": text((latest.close - prior_high) / atr),
        "gap_atr": text((latest.open - previous_close) / atr),
        "close_location": text(_metric_decimal(metrics, "closeLocation")),
        "five_day_return_pct": text(_metric_decimal(metrics, "fiveDayReturnPct")),
        "ten_day_return_pct": text(_metric_decimal(metrics, "tenDayReturnPct")),
        "stop_risk_pct": text(_metric_decimal(metrics, "stopRiskPct")),
        "entry_extension_atr": text(_metric_decimal(metrics, "entryExtensionAtr")),
        "circuit_like_sessions20": int(_metric_decimal(metrics, "circuitLikeSessions20") or ZERO),
        "market_regime_positive": 1 if metrics.get("marketRegimePositive") is True else 0,
    }
