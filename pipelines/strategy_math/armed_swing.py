"""Armed Strong Swing — server-authoritative pre-breakout entries (armed-v4).

Ported from lib/analytics/armedSwing.ts with no change to any formula, threshold, gate or
status rule. TypeScript keeps the types and becomes a loader; this module owns the arithmetic.

Parity notes — JavaScript semantics this port must reproduce exactly:
  * Math.round rounds half toward +Infinity, not to even. common.js_round handles it.
  * Number.prototype.toFixed rounds half away from zero; Python's format() rounds half to even,
    so js_to_fixed is used for every detail string that a differential test compares.
  * Number.toLocaleString("en-US") groups with commas, reproduced with format(n, ",").
"""
from __future__ import annotations

import math
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from strategy_math.common import Bar, js_round, mean, pct_change, round2, sma

MODEL_VERSION = "armed-v4-2026-11-14"

RULES: dict[str, float] = {
    "baseLength": 20,
    "contractionHalf": 10,
    "maxBaseDepthPct": 18,
    "maxContractionRatio": 0.75,
    "squeezePercentile": 0.25,
    "triggerBufferAtr": 0.1,
    "limitBufferAtr": 0.25,
    "maxLimitAbovePivotPct": 3,
    "stopBufferAtr": 0.1,
    "pivotLowSessions": 5,
    "minStopDistanceAtr": 1,
    "maxDistanceAtr": 1.5,
    "maxDistancePct": 6,
    "minRsPercentile": 80,
    "maxDryUp": 0.85,
    "minBreakoutPace": 1.5,
    "maxAtrPct": 5,
    "maxStopRiskPct": 8,
    "minSessionProgress": 0.15,
    "minPivotAgeSessions": 3,
    "maxQuoteAgeMinutes": 5,
    "maxSpreadPct": 0.75,
    "minLowerCircuitRoomPct": 3,
    "resultsBlackoutSessions": 3,
}

STATUS_ORDER = {
    "BUY_ZONE": 0, "TRIGGERED_UNCONFIRMED": 1, "ARMED": 2, "UNVERIFIED": 3,
    "FORMING": 4, "EXTENDED": 5, "RISK_OFF": 6, "INVALIDATED": 7,
}

KNOWN_CIRCUIT_BANDS = (5, 10, 20)


def js_to_fixed(value: float | None, digits: int) -> str:
    """Number.prototype.toFixed: half away from zero, on the float's exact binary value."""
    if value is None or not math.isfinite(value):
        return "NaN" if value is None or math.isnan(value) else ("Infinity" if value > 0 else "-Infinity")
    quantum = Decimal(1).scaleb(-digits)
    return f"{Decimal(value).quantize(quantum, rounding=ROUND_HALF_UP):.{digits}f}"


def _trim(value: float) -> str:
    """Render a rule threshold the way JS prints a number inside a template literal."""
    return str(int(value)) if float(value).is_integer() else str(value)


def tick_size(market: str) -> float:
    return 0.05 if market == "IN" else 0.01


def round_up_tick(value: float, tick: float) -> float:
    return math.ceil(value / tick - 1e-9) * tick


def round_down_tick(value: float, tick: float) -> float:
    return math.floor(value / tick + 1e-9) * tick


def valid_session_volume_curve(curve: dict[str, Any] | None, market: str) -> bool:
    if not curve or curve.get("market") != market:
        return False
    if float(curve.get("sampleSessions") or 0) < 40:
        return False
    points = curve.get("points") or []
    if len(points) < 2:
        return False
    for index, point in enumerate(points):
        x, y = float(point[0]), float(point[1])
        if not math.isfinite(x) or not math.isfinite(y):
            return False
        if not (0 <= x <= 1 and 0 <= y <= 1):
            return False
        if index > 0 and not (x > float(points[index - 1][0]) and y >= float(points[index - 1][1])):
            return False
    return (float(points[0][0]) == 0 and float(points[0][1]) == 0
            and float(points[-1][0]) == 1 and float(points[-1][1]) == 1)


def expected_volume_share(curve: dict[str, Any], progress: float) -> float:
    points = curve["points"]
    p = max(0.0, min(1.0, progress))
    for index in range(1, len(points)):
        x0, y0 = float(points[index - 1][0]), float(points[index - 1][1])
        x1, y1 = float(points[index][0]), float(points[index][1])
        if p <= x1:
            return y0 + ((p - x0) / (x1 - x0)) * (y1 - y0)
    return 1.0


def bandwidth_percentile(closes: list[float], period: int = 20, k: float = 2) -> float:
    widths: list[float] = []
    for end in range(period, len(closes) + 1):
        window = closes[end - period:end]
        m = mean(window)
        sd = math.sqrt(sum((value - m) ** 2 for value in window) / max(1, period - 1))
        widths.append((2 * k * sd) / m if m > 0 else 0.0)
    if len(widths) < 2:
        return 1.0
    current = widths[-1]
    history = widths[:-1]
    return len([value for value in history if value <= current]) / len(history)


def _is_circuit_like_session(previous: Bar, current: Bar) -> bool:
    change = pct_change(previous.close, current.close)
    if change is None or not any(abs(abs(change) - band) <= 0.25 for band in KNOWN_CIRCUIT_BANDS):
        return False
    span = current.high - current.low
    if span <= 0:
        return True
    location = (current.close - current.low) / span
    return location >= 0.98 if change > 0 else location <= 0.02


def _sessions_between(start: str, end: str, dates: list[str]) -> int:
    first, last = (start, end) if start <= end else (end, start)
    return len({date for date in dates if first < date <= last})


def _gate(key: str, label: str, passed: bool, detail: str,
          category: str = "technical", blocking: bool = True) -> dict[str, Any]:
    return {"key": key, "label": label, "passed": bool(passed), "detail": detail,
            "category": category, "blocking": bool(blocking)}


def results_calendar_coverage(payload: dict[str, Any]) -> dict[str, Any]:
    """Whether the results calendar can be trusted for one asset. Mirrors the TS helper."""
    from datetime import datetime, timezone

    def _parse(value: str | None) -> float | None:
        if not value:
            return None
        text = str(value)
        try:
            if len(text) == 10:
                return datetime.fromisoformat(f"{text}T00:00:00+00:00").timestamp() * 1000
            return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(timezone.utc).timestamp() * 1000
        except ValueError:
            return None

    day = 86_400_000
    today_ms = _parse(payload.get("today"))
    last_success = _parse(payload.get("lastSuccessAt"))
    if last_success is None or today_ms is None or today_ms - last_success > 7 * day:
        return {"verified": False, "detail": "Results calendar not checked in the last 7 days."}
    next_date = payload.get("nextDate")
    if next_date:
        return {"verified": True, "detail": f"Next results {next_date}."}
    coverage_from = payload.get("authoritativeCoverageFrom")
    coverage_through = payload.get("authoritativeCoverageThrough")
    required_from = payload.get("requiredCoverageFrom")
    required_through = payload.get("requiredCoverageThrough")
    if (payload.get("authoritativeSource") == "NSE_CALENDAR"
            and payload.get("authoritativeAsOf") == payload.get("today")
            and coverage_from and required_from and coverage_from <= required_from
            and coverage_through and required_through and coverage_through >= required_through):
        return {"verified": True,
                "detail": f"NSE calendar checked through {coverage_through}; no result is announced in the blackout window."}
    last_past = payload.get("lastPastDate")
    return {"verified": False, "detail": (
        f"Last results {last_past}; that does not verify the next blackout window." if last_past
        else "No upcoming results date or authoritative blackout-window coverage is on file.")}


def assess(payload: dict[str, Any]) -> dict[str, Any]:
    R = RULES
    market = payload["market"]
    bars = [Bar.from_json(item) for item in payload["bars"]]
    benchmark_bars = [Bar.from_json(item) for item in (payload.get("benchmarkBars") or [])]
    if len(bars) < 60:
        raise ValueError("Armed Swing requires at least 60 completed sessions.")

    tick = tick_size(market)
    latest = bars[-1]
    closes = [bar.close for bar in bars]
    supplied_price = float(payload.get("currentPrice") or 0)
    current_price = supplied_price if supplied_price > 0 else latest.close
    from strategy_math.common import average_true_range
    atr = max(average_true_range(bars, 14), tick)
    atr_pct = (atr / latest.close) * 100 if latest.close > 0 else math.inf

    # --- Base structure ---------------------------------------------------------------------
    base_length = int(R["baseLength"])
    contraction_half = int(R["contractionHalf"])
    base = bars[-base_length:]
    pivot = max(bar.high for bar in base)
    base_low = min(bar.low for bar in base)
    base_depth_pct = ((pivot - base_low) / pivot) * 100 if pivot > 0 else 100.0
    first_half = base[:contraction_half]
    second_half = base[-contraction_half:]

    def range_of(slice_: list[Bar]) -> float:
        return max(bar.high for bar in slice_) - min(bar.low for bar in slice_)

    contraction_ratio = (range_of(second_half) / range_of(first_half)) if range_of(first_half) > 0 else 1.0
    bw_percentile = bandwidth_percentile(closes)
    contracting = contraction_ratio <= R["maxContractionRatio"] or bw_percentile <= R["squeezePercentile"]
    last_contraction_low = min(bar.low for bar in base[-int(R["pivotLowSessions"]):])
    pivot_index = 0
    for index, bar in enumerate(base):
        if bar.high > base[pivot_index].high:
            pivot_index = index
    pivot_age_sessions = len(base) - 1 - pivot_index

    # --- Buy-stop plan ----------------------------------------------------------------------
    trigger = round_up_tick(pivot + R["triggerBufferAtr"] * atr, tick)
    limit = round_up_tick(min(trigger + R["limitBufferAtr"] * atr,
                              pivot * (1 + R["maxLimitAbovePivotPct"] / 100)), tick)
    stop = round_down_tick(max(0.0, min(last_contraction_low - R["stopBufferAtr"] * atr,
                                        trigger - R["minStopDistanceAtr"] * atr)), tick)
    risk = max(tick, trigger - stop)
    target_rr = float(payload["risk"]["targetRR"])
    trail_atr_mult = float(payload["risk"]["trailAtrMult"])
    target = round_up_tick(trigger + target_rr * risk, tick)
    trail = round_down_tick(max(stop, trigger - trail_atr_mult * atr), tick)
    recent = closes[-(base_length + 1):]
    velocity = mean([abs(recent[index + 1] - recent[index]) for index in range(len(recent) - 1)])
    expected_days = min(60, max(1, js_round((target - trigger) / velocity))) if velocity > 0 else 20
    risk_per_share_pct = (risk / trigger) * 100
    plan = {
        "pivot": round2(pivot), "trigger": round2(trigger), "limit": round2(limit),
        "stop": round2(stop), "target": round2(target), "trail": round2(trail),
        "expectedDays": expected_days,
        "riskPerSharePct": risk_per_share_pct,
        "rewardRiskRatio": (target - trigger) / risk,
    }
    distance_to_trigger_pct = ((trigger - current_price) / trigger) * 100
    distance_to_trigger_atr = (trigger - current_price) / atr

    # --- Trend template (stage 2) -----------------------------------------------------------
    sma50 = sma(closes, 50)
    sma150 = sma(closes, 150)
    sma200 = sma(closes, 200)
    sma200_prior = sma(closes, 200, len(closes) - 20)
    year = bars[-252:]
    high52 = max(bar.high for bar in year)
    low52 = min(bar.low for bar in year)
    has_trend_history = None not in (sma150, sma200, sma200_prior, sma50)
    trend_aligned = bool(has_trend_history
                         and latest.close > sma50 and latest.close > sma150 and latest.close > sma200
                         and sma50 > sma150 and sma150 > sma200 and sma200 > sma200_prior
                         and latest.close >= high52 * 0.75 and latest.close >= low52 * 1.3)

    # --- Leadership -------------------------------------------------------------------------
    benchmark_by_date = {bar.date[:10]: bar.close for bar in benchmark_bars}
    ratio: list[float] = []
    for bar in bars[-126:]:
        reference = benchmark_by_date.get(bar.date[:10])
        if reference and reference > 0:
            ratio.append(bar.close / reference)
    rs_line_near_high = len(ratio) >= 20 and ratio[-1] >= 0.98 * max(ratio)

    # --- Volume -----------------------------------------------------------------------------
    average50 = mean([bar.volume for bar in bars[-50:]])
    average20 = mean([bar.volume for bar in bars[-20:]])
    volume_dry_up = (mean([bar.volume for bar in bars[-5:]]) / average50) if average50 > 0 else 1.0
    average_traded_value20 = mean([bar.close * bar.volume for bar in bars[-20:]])
    live = payload.get("liveSession")
    raw_curve = payload.get("volumeCurve")
    curve = raw_curve if valid_session_volume_curve(raw_curve, market) else None
    volume_pace: float | None = None
    if live and average20 > 0 and curve:
        progress = max(R["minSessionProgress"], min(1.0, float(live.get("progress") or 0)))
        volume_pace = float(live.get("volume") or 0) / (average20 * expected_volume_share(curve, progress))

    # --- Market and execution context -------------------------------------------------------
    benchmark_closes = [bar.close for bar in benchmark_bars]
    benchmark_sma50 = sma(benchmark_closes, 50)
    benchmark_sma50_prior = sma(benchmark_closes, 50, len(benchmark_closes) - 20)
    benchmark_latest = benchmark_bars[-1] if benchmark_bars else None
    market_regime_positive = bool(benchmark_latest and benchmark_sma50 is not None
                                  and benchmark_sma50_prior is not None
                                  and benchmark_latest.close > benchmark_sma50
                                  and benchmark_sma50 > benchmark_sma50_prior)
    benchmark_two_day = pct_change(benchmark_bars[-3].close, benchmark_bars[-1].close) if len(benchmark_bars) >= 3 else None
    market_shock = (benchmark_two_day if benchmark_two_day is not None else 0) <= -4
    suggested_exposure_pct = 0 if market_shock else (100 if market_regime_positive else 50)
    expected_session_lag = payload.get("expectedSessionLag")
    # Two distinct failures hide behind one gate, and they deserve different verdicts: a stale
    # *benchmark* is a reference-data outage, while the stock's *own* bars lagging the exchange
    # calendar means this instrument is genuinely untradeable right now.
    benchmark_lag_ok = bool(
        benchmark_bars
        and _sessions_between(latest.date[:10],
                              (benchmark_latest.date if benchmark_latest else latest.date)[:10],
                              [bar.date[:10] for bar in [*bars, *benchmark_bars]]) <= 1
    )
    own_data_fresh = expected_session_lag is None or float(expected_session_lag) <= 1
    data_fresh = benchmark_lag_ok and own_data_fresh
    circuit_like_sessions20 = 0
    circuit_window = bars[-21:]
    for index in range(1, len(circuit_window)):
        if _is_circuit_like_session(circuit_window[index - 1], circuit_window[index]):
            circuit_like_sessions20 += 1
    price_floor = 20 if market == "IN" else 2
    traded_value_floor = 10_000_000 if market == "IN" else 1_000_000
    triggered = current_price >= trigger
    exec_data = payload.get("execution") or None
    quote_verified = bool(exec_data and exec_data.get("quoteFresh"))
    best_bid = exec_data.get("bestBid") if exec_data else None
    best_ask = exec_data.get("bestAsk") if exec_data else None
    lower_circuit = exec_data.get("lowerCircuit") if exec_data else None
    upper_circuit = exec_data.get("upperCircuit") if exec_data else None
    depth_present = bool(exec_data and best_bid is not None and best_ask is not None
                         and float(best_bid) > 0 and float(best_ask) > 0)
    bands_present = bool(exec_data and lower_circuit is not None and upper_circuit is not None
                         and float(lower_circuit) > 0 and float(upper_circuit) > 0)
    spread_pct = ((float(best_ask) - float(best_bid)) / float(best_ask)) * 100 if depth_present else None
    lower_room_pct = ((current_price / float(lower_circuit)) - 1) * 100 if bands_present else None
    limit_inside_band = bool(bands_present and limit <= float(upper_circuit))
    results = payload.get("results") or None
    evidence = payload.get("resultsEvidence") or None
    if evidence:
        coverage = results_calendar_coverage(evidence)
        next_date = evidence.get("nextDate")
        blackout_dates = [str(value)[:10] for value in (evidence.get("blackoutSessionDates") or [])]
        sessions_to_next = None
        if next_date:
            next_iso = str(next_date)[:10]
            sessions_to_next = (blackout_dates.index(next_iso) + 1) if next_iso in blackout_dates else (
                len(blackout_dates) + 1 if blackout_dates and next_iso > blackout_dates[-1] else 0
            )
        results = {
            "verified": bool(coverage["verified"]), "detail": coverage["detail"],
            "nextDate": next_date, "sessionsToNext": sessions_to_next,
        }
    results_verified = bool(results and results.get("verified"))
    sessions_to_next = results.get("sessionsToNext") if results else None
    in_blackout = sessions_to_next is not None and float(sessions_to_next) <= R["resultsBlackoutSessions"]
    quote_age = exec_data.get("quoteAgeMinutes") if exec_data else None

    def _plural(count: float) -> str:
        return "" if count == 1 else "s"

    gates: list[dict[str, Any]] = [
        _gate("trend", "Stage-2 trend", trend_aligned,
              (f"Close above 50/150/200 SMA, 50 > 150 > 200 SMA, 200 SMA rising, within 25% of the "
               f"52-week high ({js_to_fixed(high52, 2)}) and 30% above the low ({js_to_fixed(low52, 2)})."
               ) if has_trend_history else "Insufficient 220-session history for the trend template."),
        _gate("relative_strength", "Relative-strength rank",
              (payload.get("rsPercentile") if payload.get("rsPercentile") is not None else -1) >= R["minRsPercentile"],
              "Not enough history to rank 3/6/9/12-month performance." if payload.get("rsPercentile") is None
              else f"{js_to_fixed(float(payload['rsPercentile']), 0)}th percentile of the market on weighted "
                   f"3/6/9/12-month return; requires {_trim(R['minRsPercentile'])}."),
        _gate("base_depth", "Tight base", base_depth_pct <= R["maxBaseDepthPct"],
              f"{_trim(R['baseLength'])}-session base is {js_to_fixed(base_depth_pct, 1)}% deep; "
              f"maximum {_trim(R['maxBaseDepthPct'])}%."),
        _gate("contraction", "Volatility contraction", contracting,
              f"Second-half range {js_to_fixed(contraction_ratio * 100, 0)}% of the first half "
              f"(≤ {_trim(R['maxContractionRatio'] * 100)}%) or bandwidth in the lowest "
              f"{js_to_fixed(R['squeezePercentile'] * 100, 0)}% (now {js_to_fixed(bw_percentile * 100, 0)}%)."),
        _gate("pivot_rest", "Rested under the pivot", pivot_age_sessions >= R["minPivotAgeSessions"],
              f"The {js_to_fixed(plan['pivot'], 2)} pivot high was set {pivot_age_sessions} "
              f"session{_plural(pivot_age_sessions)} ago; a base needs at least "
              f"{_trim(R['minPivotAgeSessions'])} sessions under it."),
        _gate("proximity", "Near the pivot",
              triggered or (distance_to_trigger_atr <= R["maxDistanceAtr"] and distance_to_trigger_pct <= R["maxDistancePct"]),
              "Price is at or through the trigger." if triggered
              else f"{js_to_fixed(distance_to_trigger_pct, 1)}% / {js_to_fixed(distance_to_trigger_atr, 2)} ATR below "
                   f"the {js_to_fixed(plan['trigger'], 2)} trigger; maximum {_trim(R['maxDistanceAtr'])} ATR "
                   f"and {_trim(R['maxDistancePct'])}%."),
        _gate("volume_dryup", "Volume dry-up", volume_dry_up <= R["maxDryUp"],
              f"Five-session volume {js_to_fixed(volume_dry_up * 100, 0)}% of the 50-session average; "
              f"supply is drying up below {_trim(R['maxDryUp'] * 100)}%."),
        _gate("rs_line", "RS line near high", rs_line_near_high,
              "Stock/benchmark ratio is within 2% of its six-month high — leadership often leads price."
              if rs_line_near_high else "Stock/benchmark ratio is not yet near its six-month high."),
        _gate("breakout_volume", "Breakout volume pace",
              (not triggered) or ((volume_pace if volume_pace is not None else 0) >= R["minBreakoutPace"]),
              f"Applies once price crosses the trigger: needs ≥ {_trim(R['minBreakoutPace'])}x time-adjusted volume pace."
              if not triggered else
              ("Triggered outside a live session; volume pace cannot be measured." if volume_pace is None
               else f"Volume so far is {js_to_fixed(volume_pace, 2)}x what the 20-session average normally trades "
                    f"by this time; requires {_trim(R['minBreakoutPace'])}x."),
              "technical", triggered),
        _gate("freshness", "Fresh EOD data", data_fresh,
              "Benchmark data unavailable — cannot verify freshness." if not benchmark_bars
              else f"Latest completed session {latest.date}.", "execution"),
        _gate("price", "Price floor", latest.close >= price_floor,
              f"{js_to_fixed(latest.close, 2)} vs minimum {js_to_fixed(price_floor, 2)}.", "execution"),
        _gate("liquidity", "20-day liquidity", average_traded_value20 >= traded_value_floor,
              f"Average traded value {format(js_round(average_traded_value20), ',')}.", "execution"),
        _gate("atr_risk", "Volatility ceiling", atr_pct <= R["maxAtrPct"],
              f"ATR is {js_to_fixed(atr_pct, 1)}% of price; maximum {_trim(R['maxAtrPct'])}%.", "execution"),
        _gate("stop_width", "Structure-stop risk", risk_per_share_pct <= R["maxStopRiskPct"],
              f"Stop {js_to_fixed(plan['stop'], 2)} below the last contraction low risks "
              f"{js_to_fixed(risk_per_share_pct, 1)}% from the trigger; maximum {_trim(R['maxStopRiskPct'])}%.",
              "execution"),
        _gate("circuit_behaviour", "Circuit behaviour", circuit_like_sessions20 < 2,
              f"{circuit_like_sessions20} circuit-like closes in 20 sessions; maximum 1.", "execution"),
        _gate("market_shock", "Market shock", not market_shock,
              "Two-session benchmark move unavailable." if benchmark_two_day is None
              else f"{js_to_fixed(benchmark_two_day, 1)}% over two sessions; entries stop at -4%.", "execution"),
        _gate("market_regime", "Market regime", market_regime_positive,
              "Benchmark is above a rising 50 SMA; entries are permitted." if market_regime_positive
              else "Benchmark is not above a rising 50 SMA; new Armed entries are blocked.", "execution"),
        _gate("results_blackout", "Results blackout", results_verified and not in_blackout,
              ("Results calendar unavailable; entry is not verified against company results." if not results
               else f"{results.get('detail')} Entry is not verified against company results." if not results_verified
               else (f"Results due in {sessions_to_next} session{_plural(float(sessions_to_next))} "
                     f"({results.get('nextDate')}); no new entries within {_trim(R['resultsBlackoutSessions'])}."
                     ) if in_blackout else str(results.get("detail"))), "execution"),
        _gate("live_quote", "Fresh live quote", quote_verified,
              (f"No live execution quote{' from Breeze' if market == 'IN' else ''}; actionable states require one."
               if not exec_data else
               f"Quote is {js_to_fixed(float(quote_age), 0) if quote_age is not None else '0'} min old." if quote_verified
               else "Market closed: re-verify with a live quote in the session." if quote_age is None
               else f"Quote is {js_to_fixed(float(quote_age), 0)} min old; maximum "
                    f"{_trim(R['maxQuoteAgeMinutes'])} during the session."), "execution"),
        _gate("live_spread", "Live bid-ask spread", spread_pct is not None and spread_pct <= R["maxSpreadPct"],
              "Bid/ask depth unavailable; the spread cannot be verified." if spread_pct is None
              else f"{js_to_fixed(spread_pct, 2)}% spread; maximum {_trim(R['maxSpreadPct'])}%.", "execution"),
        _gate("live_circuit", "Circuit bands",
              lower_room_pct is not None and lower_room_pct > R["minLowerCircuitRoomPct"] and limit_inside_band,
              ("Circuit bands unavailable; exit room and limit fill cannot be verified." if lower_room_pct is None
               else f"Limit {js_to_fixed(plan['limit'], 2)} is above the upper circuit "
                    f"{js_to_fixed(float(upper_circuit), 2)}." if not limit_inside_band
               else f"{js_to_fixed(lower_room_pct, 1)}% above lower circuit (requires "
                    f"{_trim(R['minLowerCircuitRoomPct'])}%); limit inside the upper band."), "execution"),
    ]

    blocking = [item for item in gates if item["blocking"]]
    strength_score = js_round((len([item for item in blocking if item["passed"]]) / len(blocking)) * 100)
    by_key = {item["key"]: item for item in gates}

    def failed(key: str) -> bool:
        item = by_key.get(key)
        return bool(item and not item["passed"])

    # A benchmark that is missing or behind the market is a data problem, not a market call.
    # Without this, a stale benchmark failed `freshness` and `market_regime` — both blocking
    # execution gates — so every candidate became RISK_OFF, reporting an ingestion outage as a
    # risk decision. These gates still block entry; they resolve to UNVERIFIED instead.
    # Usable means fresh AND long enough to answer the regime question. A benchmark with too
    # few bars returns a null 50-SMA, which read as "regime negative" and hard-stopped every
    # candidate — an absent measurement reported as a bearish market call.
    benchmark_usable = benchmark_lag_ok and benchmark_sma50 is not None and benchmark_sma50_prior is not None
    unverified = (not quote_verified or not depth_present or not bands_present
                  or not results_verified or not benchmark_usable)
    data_gate_keys = {"live_quote", "live_spread", "live_circuit", "results_blackout"}
    if not benchmark_usable:
        # Only while the benchmark is unusable: a fresh benchmark below a rising 50 SMA is a
        # genuine risk-off signal and must keep hard-stopping entries.
        data_gate_keys |= {"freshness", "market_regime", "market_shock"}
    hard_risk = (
        any(item["category"] == "execution" and item["blocking"] and not item["passed"]
            and item["key"] not in data_gate_keys for item in gates)
        or (depth_present and spread_pct is not None and spread_pct > R["maxSpreadPct"])
        or (bands_present and not by_key["live_circuit"]["passed"])
        or (results_verified and in_blackout)
    )
    technical_passed = all(
        item["passed"] for item in gates
        if item["category"] == "technical" and item["blocking"] and item["key"] != "breakout_volume"
    )

    if current_price < stop:
        status = "INVALIDATED"
    elif hard_risk:
        status = "RISK_OFF"
    elif triggered and current_price > limit:
        status = "EXTENDED"
    elif not technical_passed:
        status = "FORMING"
    elif unverified:
        status = "UNVERIFIED"
    elif triggered:
        status = "TRIGGERED_UNCONFIRMED" if failed("breakout_volume") else "BUY_ZONE"
    else:
        status = "ARMED"

    return {
        "policyVersion": MODEL_VERSION,
        "status": status,
        "strengthScore": strength_score,
        "gates": gates,
        "plan": plan,
        "latestClose": latest.close,
        "latestDate": latest.date,
        "atr": atr,
        "atrPct": atr_pct,
        "distanceToTriggerPct": distance_to_trigger_pct,
        "distanceToTriggerAtr": distance_to_trigger_atr,
        "baseDepthPct": base_depth_pct,
        "contractionRatio": contraction_ratio,
        "pivotAgeSessions": pivot_age_sessions,
        "bandwidthPercentile": bw_percentile,
        "volumeDryUp": volume_dry_up,
        "volumePace": volume_pace,
        "rsPercentile": payload.get("rsPercentile"),
        "rsLineNearHigh": rs_line_near_high,
        "averageTradedValue20": average_traded_value20,
        "sma50": sma50,
        "sma150": sma150,
        "sma200": sma200,
        "high52": high52,
        "low52": low52,
        "marketRegimePositive": market_regime_positive,
        "suggestedExposurePct": suggested_exposure_pct,
        "circuitLikeSessions20": circuit_like_sessions20,
        "resultsCalendarVerified": results_verified,
    }
