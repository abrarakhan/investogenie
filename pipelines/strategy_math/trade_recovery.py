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
            "stopLevel": _round2(frozen_stop),
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


def _signal_is_fresh(signal_date: Any, expected_session_date: str) -> bool:
    """Require stored strategy signals to come from the current expected trading session."""
    if not signal_date or not isinstance(signal_date, str):
        return False
    sig_day = signal_date[:10]
    if not expected_session_date:
        return True
    return sig_day >= expected_session_date[:10]


def _quote_validates_setup(
    current_price: float | None,
    entry: float | None,
    stop: float | None,
) -> tuple[bool, str | None]:
    """Validate a candidate fresh setup against the current verified quote."""
    if current_price is None or current_price <= 0:
        return False, "missing verified current quote"
    if stop is not None and stop > 0 and current_price <= stop:
        return False, f"current price below setup stop ({stop:.2f})"
    if entry is not None and entry > 0:
        if current_price < entry * 0.985:
            return False, f"current price below setup entry ({entry:.2f})"
        if current_price > entry * 1.15:
            return False, f"current price extended >15% above entry ({entry:.2f})"
    return True, None


def evaluate_fresh_setup(item: dict[str, Any]) -> dict[str, Any]:
    """Evaluate whether a recovering open trade qualifies as a fresh setup in any existing engine.

    Strictly separate from the original frozen plan:
    - Requires a verified current quote and a current-session engine assessment.
    - Validates setup entry/stop levels against the current quote before qualifying.
    - Returns the fresh engine's own entry/stop/target when qualified, or the concise main blocker.
    """
    recovery_status = str(item.get("recoveryStatus") or "NONE")
    if recovery_status not in ("REBOUND_DETECTED", "STOP_RECLAIMED"):
        return {
            "freshSetupStatus": "NONE",
            "freshSetupEngine": None,
            "freshSetupLabel": None,
            "freshSetupEntry": None,
            "freshSetupStop": None,
            "freshSetupTarget": None,
            "freshSetupRoute": None,
            "freshSetupBlocker": None,
            "freshSetupFirstQualifiedAt": None,
        }

    market = str(item.get("market") or "IN").lower()
    evaluated_at = str(item.get("evaluatedAt") or "")
    expected_session_date = str(item.get("expectedSessionDate") or "")
    quote_verified = bool(item.get("quoteVerified"))
    current_price = _to_num(item.get("currentPrice"))
    prior_qualified_at = item.get("priorFreshSetupFirstQualifiedAt")

    if not quote_verified or current_price is None:
        return {
            "freshSetupStatus": "BLOCKED",
            "freshSetupEngine": None,
            "freshSetupLabel": None,
            "freshSetupEntry": None,
            "freshSetupStop": None,
            "freshSetupTarget": None,
            "freshSetupRoute": None,
            "freshSetupBlocker": "Awaiting verified current quote before qualifying fresh setup",
            "freshSetupFirstQualifiedAt": prior_qualified_at,
        }

    strong = item.get("strongSwing") or None
    trend = item.get("trendContinuation") or None
    momentum = item.get("momentumV2") or None
    swing = item.get("swingBreakout") or None
    rejection_notes: list[str] = []

    def _try_qualify(
        engine_code: str,
        engine_name: str,
        label: str,
        route: str,
        signal_date: Any,
        entry: float | None,
        stop: float | None,
        target: float | None,
    ) -> dict[str, Any] | None:
        if not _signal_is_fresh(signal_date, expected_session_date):
            sig_tag = str(signal_date)[:10] if signal_date else "undated"
            rejection_notes.append(f"{engine_name} signal stale ({sig_tag})")
            return None
        ok, reason = _quote_validates_setup(current_price, entry, stop)
        if not ok:
            rejection_notes.append(f"{engine_name}: {reason}")
            return None
        return {
            "freshSetupStatus": "QUALIFIED",
            "freshSetupEngine": engine_code,
            "freshSetupLabel": label,
            "freshSetupEntry": entry,
            "freshSetupStop": stop,
            "freshSetupTarget": target,
            "freshSetupRoute": route,
            "freshSetupBlocker": None,
            "freshSetupFirstQualifiedAt": prior_qualified_at or evaluated_at,
        }

    # 1. Strong Swing (strictest)
    if strong and strong.get("status") == "EXECUTION_READY":
        q = _try_qualify(
            "STRONG_SWING",
            "Strong Swing",
            f"Strong Swing · Execution Ready (score {round(_to_num(strong.get('strengthScore')) or 0)})",
            f"/terminal/{market}/strong-swing",
            strong.get("signalDate"),
            _to_num(strong.get("entry")),
            _to_num(strong.get("stop")),
            _to_num(strong.get("target")),
        )
        if q:
            return q

    # 2. Trend Continuation / Mid-Way
    if trend and trend.get("status") == "TREND_CONTINUATION_READY":
        variant = trend.get("setupVariant")
        lbl = f"Mid-Way ({str(variant).replace('_', ' ')})" if variant else "Trend Continuation Ready"
        q = _try_qualify(
            "TREND_CONTINUATION",
            "Trend Continuation",
            f"{lbl} (score {round(_to_num(trend.get('score')) or 0)})",
            f"/terminal/{market}/strong-swing?model=TREND_CONTINUATION",
            trend.get("signalDate"),
            _to_num(trend.get("entry")),
            _to_num(trend.get("stop")),
            _to_num(trend.get("target")),
        )
        if q:
            return q

    # 3. Momentum Ignition V2
    if momentum and (momentum.get("status") == "MOMENTUM_READY" or momentum.get("ready") is True):
        q = _try_qualify(
            "MOMENTUM_IGNITION_V2",
            "Momentum V2",
            "Momentum Ignition V2 · Ready",
            f"/terminal/{market}/strong-swing?model=MOMENTUM_IGNITION_V2",
            momentum.get("signalDate"),
            _to_num(momentum.get("entry")),
            _to_num(momentum.get("stop")),
            _to_num(momentum.get("target")),
        )
        if q:
            return q

    # 4. Swing Breakout (high-score breakout)
    if swing and swing.get("verdict") == "LONG_BREAKOUT" and (_to_num(swing.get("score")) or 0.0) >= 0.65:
        sc = round((_to_num(swing.get("score")) or 0.0) * 100)
        q = _try_qualify(
            "SWING_BREAKOUT",
            "Swing Breakout",
            f"Swing Breakout (score {sc}/100)",
            f"/terminal/{market}/screener",
            swing.get("signalDate"),
            _to_num(swing.get("entry")),
            _to_num(swing.get("stop")),
            _to_num(swing.get("target")),
        )
        if q:
            return q

    # None qualified: synthesize concise main blocker from rejection reasons and available engine states
    blockers: list[str] = list(rejection_notes)
    if strong and strong.get("status") != "EXECUTION_READY":
        failed_gates = [
            str(g.get("key")).replace("_", " ")
            for g in (strong.get("gates") or [])
            if isinstance(g, dict) and g.get("passed") is False and g.get("blocking", True)
        ]
        if failed_gates:
            blockers.append(f"Strong Swing ({strong.get('status')}): {', '.join(failed_gates[:3])}")
        else:
            blockers.append(f"Strong Swing: {strong.get('status')}")
    if trend and trend.get("status") != "TREND_CONTINUATION_READY":
        blockers.append(f"Trend Continuation: {str(trend.get('status') or '').replace('_', ' ')}")
    if momentum and not (momentum.get("status") == "MOMENTUM_READY" or momentum.get("ready") is True):
        blockers.append(f"Momentum V2: {str(momentum.get('status') or '').replace('_', ' ')}")
    if swing and swing.get("verdict") and swing.get("verdict") != "LONG_BREAKOUT":
        blockers.append(f"Swing: {str(swing.get('verdict')).replace('_', ' ')}")

    main_blocker = " · ".join(blockers[:2]) if blockers else "Not yet in any active breakout/continuation scan"
    return {
        "freshSetupStatus": "BLOCKED",
        "freshSetupEngine": None,
        "freshSetupLabel": None,
        "freshSetupEntry": None,
        "freshSetupStop": None,
        "freshSetupTarget": None,
        "freshSetupRoute": None,
        "freshSetupBlocker": main_blocker,
        "freshSetupFirstQualifiedAt": prior_qualified_at,
    }
