"""Authoritative Python logic for Trade Breach History, Recovery Context & Fresh-Setup Validation.

Strictly separates:
1. Original frozen plan + immutable first verified stop-breach audit record (with stop-in-force).
2. Recovery context (REBOUND_DETECTED / STOP_RECLAIMED / UNVERIFIED / NONE)
   without rewriting the original plan or inventing ad-hoc invalidation levels.
3. Fresh setup qualification (QUALIFIED / RECENT_SIGNAL / BLOCKED / NONE) gated on
   current-session recency, engine execution gates, and tight entry/stop validation.
"""
from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any

REBOUND_2D_MIN_PCT = 8.0
LIVE_QUOTE_MAX_AGE_MINUTES = 5.0
LIVE_SIGNAL_MAX_AGE_MINUTES = 15.0
MAX_ENTRY_EXTENSION_PCT = 0.03  # 3% above entry max for fresh executable qualification


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


def _parse_iso_dt(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
    try:
        s = str(value).strip()
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s)
        return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _currency_symbol(currency: str | None, market: str) -> str:
    cur = (currency or "").upper()
    if cur == "INR" or (not cur and market == "IN"):
        return "₹"
    return "$"


def is_window_expired(
    sessions_held: int | None,
    expected_holding_days: int | None,
    price: float | None,
    buy_price: float | None,
) -> bool:
    """Shared ledger trading-session expiry rule: strictly greater than expected holding sessions."""
    if sessions_held is None or expected_holding_days is None or price is None or buy_price is None:
        return False
    return int(sessions_held) > int(expected_holding_days) and float(price) < float(buy_price)


def is_quote_verified_for_breach(
    *,
    market: str,
    mode: str,
    price: float | None,
    quote_as_of: str | None,
    quote_source: str | None,
    quote_updated_at: Any,
    expected_session_date: str,
    now_utc: datetime,
    max_live_age_minutes: float = LIVE_QUOTE_MAX_AGE_MINUTES,
) -> bool:
    """Verify quote freshness & expected exchange session before recording permanent breach history."""
    if price is None or not quote_as_of or not expected_session_date:
        return False
    if str(quote_as_of)[:10] != str(expected_session_date)[:10]:
        return False
    if mode == "LIVE":
        if market == "IN" and quote_source != "BREEZE_LIVE":
            return False
        updated_dt = _parse_iso_dt(quote_updated_at)
        if updated_dt is None:
            return False
        age_minutes = (now_utc - updated_dt).total_seconds() / 60.0
        return 0.0 <= age_minutes <= max_live_age_minutes
    # EOD mode: quote_as_of matches exchange-calendar expected_session_date
    return True


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


def _signal_same_session(signal_date: Any, expected_session_date: str) -> bool:
    if not signal_date or not isinstance(signal_date, str):
        return False
    if not expected_session_date:
        return True
    return signal_date[:10] == expected_session_date[:10]


def _evaluate_engine_readiness(
    *,
    mode: str,
    eod_only_engine: bool,
    signal_date: Any,
    signal_at: Any,
    expected_session_date: str,
    evaluated_dt: datetime | None,
    current_price: float,
    entry: float | None,
    stop: float | None,
    gates_ok: bool,
) -> tuple[str, str | None]:
    """Classify an engine's READY signal as QUALIFIED, RECENT_SIGNAL, or REJECTED."""
    if not _signal_same_session(signal_date, expected_session_date):
        sig_tag = str(signal_date)[:10] if signal_date else "undated"
        return "REJECTED", f"signal stale ({sig_tag})"

    if not gates_ok:
        return "REJECTED", "blocking execution gate failed"

    if stop is not None and stop > 0 and current_price <= stop:
        return "REJECTED", f"current price below setup stop ({stop:.2f})"

    # EOD-only engines (e.g. Swing Breakout) cannot be announced as fresh live intraday setups
    if mode == "LIVE" and eod_only_engine:
        return "RECENT_SIGNAL", "EOD-only scan; awaiting live strategy confirmation"

    # During LIVE mode, require a recent assessment (<= 15 min)
    if mode == "LIVE":
        sig_dt = _parse_iso_dt(signal_at)
        if sig_dt is None or evaluated_dt is None:
            return "RECENT_SIGNAL", "missing live capture timestamp"
        age_min = (evaluated_dt - sig_dt).total_seconds() / 60.0
        if age_min > LIVE_SIGNAL_MAX_AGE_MINUTES or age_min < -2.0:
            return "RECENT_SIGNAL", f"assessment {int(max(0, round(age_min)))}m old (>{int(LIVE_SIGNAL_MAX_AGE_MINUTES)}m live limit)"

    # Tight entry-zone validation (no loose +15% chase)
    if entry is not None and entry > 0:
        if current_price < entry * 0.99:
            return "RECENT_SIGNAL", f"current price below setup entry ({entry:.2f})"
        if current_price > entry * (1.0 + MAX_ENTRY_EXTENSION_PCT):
            return "RECENT_SIGNAL", f"current price >{int(MAX_ENTRY_EXTENSION_PCT * 100)}% above entry ({entry:.2f})"

    return "QUALIFIED", None


def evaluate_fresh_setup(item: dict[str, Any]) -> dict[str, Any]:
    """Evaluate whether a recovering open trade qualifies as a fresh executable setup.

    Returns:
    - QUALIFIED: current-session, recent (<=15m in LIVE), engine gates pass, within 3% entry band & above stop.
    - RECENT_SIGNAL: same-session READY signal that is older than 15m in LIVE, EOD-only in LIVE, or outside
      the tight entry band (still above stop). Rendered as "Recent strategy signal" and suppresses alerts.
    - BLOCKED: no qualifying or recent ready signal (with concise main blocker).
    - NONE: trade is not in REBOUND_DETECTED / STOP_RECLAIMED.
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
    mode = str(item.get("mode") or "LIVE").upper()
    evaluated_at = str(item.get("evaluatedAt") or "")
    evaluated_dt = _parse_iso_dt(evaluated_at)
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
    recent_fallback: dict[str, Any] | None = None

    def _check_engine(
        engine_code: str,
        engine_name: str,
        label: str,
        route: str,
        signal_date: Any,
        signal_at: Any,
        entry: float | None,
        stop: float | None,
        target: float | None,
        *,
        eod_only: bool = False,
        gates_ok: bool = True,
    ) -> dict[str, Any] | None:
        nonlocal recent_fallback
        verdict, reason = _evaluate_engine_readiness(
            mode=mode,
            eod_only_engine=eod_only,
            signal_date=signal_date,
            signal_at=signal_at,
            expected_session_date=expected_session_date,
            evaluated_dt=evaluated_dt,
            current_price=current_price,
            entry=entry,
            stop=stop,
            gates_ok=gates_ok,
        )
        if verdict == "QUALIFIED":
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
        if verdict == "RECENT_SIGNAL":
            if recent_fallback is None:
                recent_fallback = {
                    "freshSetupStatus": "RECENT_SIGNAL",
                    "freshSetupEngine": engine_code,
                    "freshSetupLabel": f"Recent strategy signal · {label}",
                    "freshSetupEntry": entry,
                    "freshSetupStop": stop,
                    "freshSetupTarget": target,
                    "freshSetupRoute": route,
                    "freshSetupBlocker": reason,
                    "freshSetupFirstQualifiedAt": prior_qualified_at,
                }
            return None
        rejection_notes.append(f"{engine_name}: {reason}")
        return None

    # 1. Strong Swing (strictest)
    if strong and strong.get("status") == "EXECUTION_READY":
        gates = strong.get("gates") or []
        gates_ok = all(
            g.get("passed") is True
            for g in gates
            if isinstance(g, dict) and g.get("blocking", True)
        )
        q = _check_engine(
            "STRONG_SWING",
            "Strong Swing",
            f"Strong Swing · Execution Ready (score {round(_to_num(strong.get('strengthScore')) or 0)})",
            f"/terminal/{market}/strong-swing",
            strong.get("signalDate"),
            strong.get("signalAt"),
            _to_num(strong.get("entry")),
            _to_num(strong.get("stop")),
            _to_num(strong.get("target")),
            gates_ok=gates_ok,
        )
        if q:
            return q

    # 2. Trend Continuation / Mid-Way
    if trend and trend.get("status") == "TREND_CONTINUATION_READY":
        variant = trend.get("setupVariant")
        lbl = f"Mid-Way ({str(variant).replace('_', ' ')})" if variant else "Trend Continuation Ready"
        q = _check_engine(
            "TREND_CONTINUATION",
            "Trend Continuation",
            f"{lbl} (score {round(_to_num(trend.get('score')) or 0)})",
            f"/terminal/{market}/strong-swing?model=TREND_CONTINUATION",
            trend.get("signalDate"),
            trend.get("signalAt"),
            _to_num(trend.get("entry")),
            _to_num(trend.get("stop")),
            _to_num(trend.get("target")),
        )
        if q:
            return q

    # 3. Momentum Ignition V2
    if momentum and (momentum.get("status") == "MOMENTUM_READY" or momentum.get("ready") is True):
        q = _check_engine(
            "MOMENTUM_IGNITION_V2",
            "Momentum V2",
            "Momentum Ignition V2 · Ready",
            f"/terminal/{market}/strong-swing?model=MOMENTUM_IGNITION_V2",
            momentum.get("signalDate"),
            momentum.get("signalAt"),
            _to_num(momentum.get("entry")),
            _to_num(momentum.get("stop")),
            _to_num(momentum.get("target")),
            gates_ok=bool(momentum.get("ready", True)),
        )
        if q:
            return q

    # 4. Swing Breakout (EOD-only scan)
    if swing and swing.get("verdict") == "LONG_BREAKOUT" and (_to_num(swing.get("score")) or 0.0) >= 0.65:
        sc = round((_to_num(swing.get("score")) or 0.0) * 100)
        q = _check_engine(
            "SWING_BREAKOUT",
            "Swing Breakout",
            f"Swing Breakout (score {sc}/100)",
            f"/terminal/{market}/screener",
            swing.get("signalDate"),
            swing.get("signalAt"),
            _to_num(swing.get("entry")),
            _to_num(swing.get("stop")),
            _to_num(swing.get("target")),
            eod_only=True,
        )
        if q:
            return q

    if recent_fallback is not None:
        return recent_fallback

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
