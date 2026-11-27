"""Authoritative Python logic for Trade Breach History and Recovery Context (Phase 1).

Strictly separates:
1. Original frozen plan + immutable first verified stop-breach audit record.
2. Recovery context (REBOUND_DETECTED / STOP_RECLAIMED / UNVERIFIED / NONE)
   without rewriting the original plan or inventing ad-hoc invalidation levels.
"""
from __future__ import annotations

import math
from typing import Any

REBOUND_2D_MIN_PCT = 8.0


def _round2(value: float) -> float:
    return round(float(value), 2)


def _to_num(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        n = float(value)
        return n if math.isfinite(n) else None
    except (TypeError, ValueError):
        return None


def _currency_symbol(currency: str | None, market: str) -> str:
    cur = (currency or "").upper()
    if cur == "INR" or (not cur and market == "IN"):
        return "₹"
    return "$"


def assess_trade_recovery(item: dict[str, Any]) -> dict[str, Any]:
    """Evaluate verified first-breach stamping and separate recovery context for one open trade."""
    market = str(item.get("market") or "IN")
    currency = item.get("currency")
    sym = _currency_symbol(currency, market)
    direction = str(item.get("direction") or "LONG").upper()
    buy_price = _to_num(item.get("buyPrice"))
    frozen_stop = _to_num(item.get("frozenStop"))
    price = _to_num(item.get("price"))
    quote_verified = bool(item.get("quoteVerified"))
    quote_source = item.get("quoteSource")
    quote_at = item.get("quoteAt")
    evaluated_at = str(item.get("evaluatedAt") or "")

    existing_breach_at = item.get("firstStopBreachedAt")
    window_expired_below_entry = bool(item.get("windowExpiredBelowEntry"))

    two_session_close = _to_num(item.get("twoSessionClose"))
    move_2d_pct = (
        _round2(((price / two_session_close) - 1.0) * 100.0)
        if (quote_verified and price is not None and two_session_close is not None and two_session_close > 0)
        else None
    )
    volume_pace = _to_num(item.get("volumePace"))
    rs_20d = _to_num(item.get("relativeStrength20d"))
    sector_thrust_group = item.get("sectorThrustGroup")
    related_news = item.get("relatedNews") or []
    prior_first_detected_at = item.get("priorFirstDetectedAt")

    # 1. Immutable first verified stop-breach stamping (never from stale/unverified quotes)
    currently_below_stop = False
    if quote_verified and price is not None and frozen_stop is not None and frozen_stop > 0:
        currently_below_stop = (price <= frozen_stop) if direction == "LONG" else (price >= frozen_stop)

    record_breach = None
    if existing_breach_at is None and currently_below_stop:
        record_breach = {
            "breachedAt": quote_at or evaluated_at,
            "price": _round2(price),
            "source": str(quote_source or "VERIFIED"),
        }

    has_breach_history = existing_breach_at is not None or record_breach is not None

    # 2. Recovery context (only relevant for trades that breached their frozen stop or expired below entry)
    if not has_breach_history and not window_expired_below_entry:
        return {
            "recordBreach": None,
            "recoveryStatus": "NONE",
            "headline": None,
            "move2dPct": move_2d_pct,
            "volumePace": _round2(volume_pace) if volume_pace is not None else None,
            "relativeStrength20d": _round2(rs_20d) if rs_20d is not None else None,
            "sectorThrustGroup": sector_thrust_group,
            "relatedNews": related_news,
            "quotePrice": _round2(price) if price is not None else None,
            "quoteSource": quote_source,
            "quoteAt": quote_at,
            "firstDetectedAt": None,
        }

    if not quote_verified or price is None:
        return {
            "recordBreach": None,
            "recoveryStatus": "UNVERIFIED",
            "headline": "Recovery status unverified · Awaiting fresh quote",
            "move2dPct": None,
            "volumePace": None,
            "relativeStrength20d": _round2(rs_20d) if rs_20d is not None else None,
            "sectorThrustGroup": sector_thrust_group,
            "relatedNews": related_news,
            "quotePrice": _round2(price) if price is not None else None,
            "quoteSource": quote_source,
            "quoteAt": quote_at,
            "firstDetectedAt": prior_first_detected_at,
        }

    # Reclaimed frozen stop after a recorded breach
    if has_breach_history and not currently_below_stop and frozen_stop is not None:
        move_part = f" · Up {move_2d_pct:.1f}% over two sessions" if (move_2d_pct is not None and move_2d_pct > 0) else ""
        return {
            "recordBreach": record_breach,
            "recoveryStatus": "STOP_RECLAIMED",
            "headline": f"Stop reclaimed · Back above {sym}{frozen_stop:.2f} frozen stop{move_part}",
            "move2dPct": move_2d_pct,
            "volumePace": _round2(volume_pace) if volume_pace is not None else None,
            "relativeStrength20d": _round2(rs_20d) if rs_20d is not None else None,
            "sectorThrustGroup": sector_thrust_group,
            "relatedNews": related_news,
            "quotePrice": _round2(price),
            "quoteSource": quote_source,
            "quoteAt": quote_at,
            "firstDetectedAt": prior_first_detected_at or evaluated_at,
        }

    # Rebound detected while stop is still not reclaimed (or window expired below entry)
    rebound_ok = move_2d_pct is not None and move_2d_pct >= REBOUND_2D_MIN_PCT
    if rebound_ok:
        stop_note = "Stop not reclaimed" if currently_below_stop else (
            "Still below entry" if (buy_price is not None and price < buy_price) else "Above entry"
        )
        return {
            "recordBreach": record_breach,
            "recoveryStatus": "REBOUND_DETECTED",
            "headline": f"Recovery detected · Up {move_2d_pct:.1f}% over two sessions · {stop_note}",
            "move2dPct": move_2d_pct,
            "volumePace": _round2(volume_pace) if volume_pace is not None else None,
            "relativeStrength20d": _round2(rs_20d) if rs_20d is not None else None,
            "sectorThrustGroup": sector_thrust_group,
            "relatedNews": related_news,
            "quotePrice": _round2(price),
            "quoteSource": quote_source,
            "quoteAt": quote_at,
            "firstDetectedAt": prior_first_detected_at or evaluated_at,
        }

    return {
        "recordBreach": record_breach,
        "recoveryStatus": "NONE",
        "headline": None,
        "move2dPct": move_2d_pct,
        "volumePace": _round2(volume_pace) if volume_pace is not None else None,
        "relativeStrength20d": _round2(rs_20d) if rs_20d is not None else None,
        "sectorThrustGroup": sector_thrust_group,
        "relatedNews": related_news,
        "quotePrice": _round2(price),
        "quoteSource": quote_source,
        "quoteAt": quote_at,
        "firstDetectedAt": None,
    }
