from __future__ import annotations

import math
from typing import Any

from .common import Bar, js_round, mean, pct_change, sma


def _gate(key: str, label: str, passed: bool, detail: str) -> dict[str, Any]:
    return {"key": key, "label": label, "passed": passed, "detail": detail}


def _true_ranges(bars: list[Bar]) -> list[float]:
    values: list[float] = []
    for index, bar in enumerate(bars):
        if index == 0:
            values.append(bar.high - bar.low)
        else:
            previous = bars[index - 1].close
            values.append(max(bar.high - bar.low, abs(bar.high - previous), abs(bar.low - previous)))
    return values


def _circuit_like(previous: Bar, current: Bar) -> bool:
    change = pct_change(previous.close, current.close)
    if change is None or not any(abs(abs(change) - band) <= .25 for band in (5, 10, 20)):
        return False
    spread = current.high - current.low
    if spread <= 0:
        return True
    location = (current.close - current.low) / spread
    return location >= .98 if change > 0 else location <= .02


def _benchmark_return(bars: list[Bar], start: str, end: str) -> float | None:
    first = last = None
    for bar in bars:
        if bar.date <= start:
            first = bar
        if bar.date <= end:
            last = bar
    return pct_change(first.close, last.close) if first and last and first is not last else None


def _session_distance(left: str, right: str, stock: list[Bar], benchmark: list[Bar]) -> float:
    left, right = left[:10], right[:10]
    if left == right:
        return 0
    first, last = sorted((left, right))
    sessions = {bar.date for bar in stock + benchmark if first <= bar.date <= last}
    if left not in sessions or right not in sessions:
        return math.inf
    return max(0, len(sessions) - 1)


def _config(raw: dict[str, Any]) -> tuple[str, float, str, float]:
    return (
        str(raw.get("benchmarkLabel") or "Nifty"),
        float(raw.get("liquidityFloor") or 50_000_000),
        str(raw.get("liquidityRequirementLabel") or "INR 5 crore"),
        float(raw.get("priceFloor") or 20),
    )


def assess_legacy(raw: dict[str, Any]) -> dict[str, Any]:
    bars = [Bar.from_json(item) for item in raw["bars"]]
    benchmark = [Bar.from_json(item) for item in raw.get("benchmarkBars", [])]
    if len(bars) < 10:
        raise ValueError("Momentum Ignition requires at least 10 bars")
    current = float(raw["currentPrice"])
    label, liquidity_floor, liquidity_label, price_floor = _config(raw)
    latest = bars[-1]
    closes = [bar.close for bar in bars]
    trs = _true_ranges(bars)
    progress = max(.12, min(1, float(raw.get("sessionProgressFraction") or 1))) if raw.get("currentSessionVolume") else 1
    benchmark_closes = [bar.close for bar in benchmark]
    bench_sma50 = sma(benchmark_closes, 50)
    bench_sma50_prior = sma(benchmark_closes, 50, len(benchmark_closes) - 20)
    bench_latest = benchmark[-1] if benchmark else None
    regime = bool(bench_latest and bench_sma50 is not None and bench_sma50_prior is not None
                  and bench_latest.close > bench_sma50 > bench_sma50_prior)
    fresh = bool(bench_latest and _session_distance(latest.date, bench_latest.date, bars, benchmark) <= 1)

    if len(bars) < 200:
        lookback = min(20, len(bars) - 1)
        prior = bars[-(lookback + 1):-1]
        fast = sma(closes, 5)
        slow_period = min(20, len(bars))
        slow = sma(closes, slow_period)
        atr14 = mean(trs[-min(14, len(trs)):])
        atr5 = mean(trs[-5:])
        atr_base = mean(trs[-min(20, len(trs)):])
        compression = atr5 / atr_base if atr_base > 0 else math.inf
        breakout = max(bar.high for bar in prior)
        trigger = breakout + .1 * atr14
        distance = pct_change(current, trigger)
        distance = distance if distance is not None else math.inf
        extension = (current - trigger) / atr14 if atr14 > 0 else math.inf
        avg_volume = mean([bar.volume for bar in prior])
        projected_volume = latest.volume / (avg_volume * progress) if avg_volume > 0 else 0
        dry_up = mean([bar.volume for bar in bars[-4:-1]]) / avg_volume if avg_volume > 0 else math.inf
        traded_value = mean([bar.close * bar.volume for bar in prior])
        start20, start5 = bars[-(lookback + 1)], bars[-min(6, len(bars))]
        stock20, stock5 = pct_change(start20.close, current), pct_change(start5.close, current)
        bench20 = _benchmark_return(benchmark, start20.date, latest.date)
        bench5 = _benchmark_return(benchmark, start5.date, latest.date)
        rs20 = stock20 - bench20 if stock20 is not None and bench20 is not None else None
        rs5 = stock5 - bench5 if stock5 is not None and bench5 is not None else None
        acceleration = rs5 - rs20 if rs5 is not None and rs20 is not None else None
        trend = bool(fast is not None and slow is not None and current > fast > slow and latest.close > start5.close)
        rs_positive = (rs20 if rs20 is not None else -math.inf) >= 5
        near = current >= trigger or 0 <= distance <= 5
        volume_expanding = projected_volume >= 1.5
        liquid = traded_value >= liquidity_floor
        atr_pct = atr14 / current * 100 if current > 0 else math.inf
        volatility = atr_pct <= 7
        circuit_window = bars[-(lookback + 1):]
        circuits = sum(_circuit_like(a, b) for a, b in zip(circuit_window, circuit_window[1:]))
        circuit_safe = circuits < 2
        spread = latest.high - latest.low
        close_location = max(0, min(1, (current - latest.low) / spread)) if spread > 0 else .5
        accumulation_window = bars[-min(11, len(bars)):]
        accumulation = sum(1 for a, b in zip(accumulation_window, accumulation_window[1:])
                           if b.close > a.close and b.volume >= avg_volume * 1.1)
        compressed, dry = compression <= .9, dry_up <= .85
        score = js_round((25 if trend else 0) + (20 if rs_positive else 0) + (15 if near else 0)
            + (15 if volume_expanding else 0) + (10 if accumulation >= 2 else 0)
            + (10 if compressed or dry else 0) + (5 if regime else 0))
        gates = [
            _gate("freshness", "Fresh price history", fresh, f"Stock {latest.date}; benchmark {bench_latest.date}." if bench_latest else "Benchmark history unavailable."),
            _gate("trend", "New-listing trend", trend, f"Price above rising {slow_period}-session structure and positive five-session direction."),
            _gate("relative_strength", f"{lookback}-session relative strength", rs_positive, "Benchmark comparison unavailable." if rs20 is None else f"{rs20:.1f}% versus {label}."),
            _gate("rs_acceleration", "Relative-strength acceleration", (acceleration or 0) > 0, "Short-window comparison unavailable." if acceleration is None else f"{acceleration:.1f} percentage points."),
            _gate("proximity", "Near lifetime breakout", near, f"{distance:.1f}% below trigger {trigger:.2f}."),
            _gate("compression", "Range compression", compressed, f"{compression:.2f}x short/base volatility."),
            _gate("dry_up", "Volume dry-up", dry, f"{dry_up:.2f}x prior volume."),
            _gate("accumulation", "Accumulation sessions", accumulation >= 2, f"{accumulation} qualifying sessions."),
            _gate("live_volume", "Expansion volume", volume_expanding, f"{projected_volume:.2f}x time-adjusted volume."),
            _gate("market", "Market regime", regime, f"{label} trend is supportive." if regime else f"{label} trend is not supportive."),
            _gate("liquidity", "Execution liquidity", liquid, f"Average traded value {js_round(traded_value):,}; requires {liquidity_label}."),
            _gate("volatility", "New-listing volatility", volatility, f"ATR is {atr_pct:.1f}% of price; maximum 7%."),
            _gate("circuit", "Circuit behaviour", circuit_safe, f"{circuits} circuit-like sessions; maximum 1."),
        ]
        qualifies = fresh and liquid and current >= price_floor and trend and rs_positive and near and score >= 55
        model_type = "NEW_LISTING"
    else:
        ranges = [max(0, bar.high - bar.low) for bar in bars]
        sma20, sma50, sma200 = sma(closes, 20), sma(closes, 50), sma(closes, 200)
        sma50_prior = sma(closes, 50, len(closes) - 20)
        atr14, atr5, atr20 = mean(trs[-14:]), mean(trs[-5:]), mean(trs[-20:])
        range5, range20 = mean(ranges[-5:]), mean(ranges[-20:])
        compression = min(atr5 / atr20 if atr20 > 0 else math.inf, range5 / range20 if range20 > 0 else math.inf)
        prior = bars[-21:-1]
        breakout = max(bar.high for bar in prior)
        trigger = breakout + .1 * atr14
        distance = pct_change(current, trigger)
        distance = distance if distance is not None else math.inf
        extension = (current - trigger) / atr14 if atr14 > 0 else math.inf
        avg_volume = mean([bar.volume for bar in prior])
        dry_up = mean([bar.volume for bar in bars[-4:-1]]) / avg_volume if avg_volume > 0 else math.inf
        projected_volume = latest.volume / (avg_volume * progress) if avg_volume > 0 else 0
        accumulation_window = bars[-11:-1]
        accumulation = sum(1 for a, b in zip(accumulation_window, accumulation_window[1:])
                           if b.close > a.close and b.volume >= avg_volume * 1.1)
        start20, start5 = bars[-21], bars[-6]
        stock20, stock5 = pct_change(start20.close, current), pct_change(start5.close, current)
        bench20, bench5 = _benchmark_return(benchmark, start20.date, latest.date), _benchmark_return(benchmark, start5.date, latest.date)
        rs20 = stock20 - bench20 if stock20 is not None and bench20 is not None else None
        rs5 = stock5 - bench5 if stock5 is not None and bench5 is not None else None
        acceleration = rs5 - rs20 if rs5 is not None and rs20 is not None else None
        trend = bool(sma20 is not None and sma50 is not None and sma200 is not None and sma50_prior is not None
                     and current > sma20 > sma50 > sma200 and sma50 > sma50_prior)
        rs_positive = (rs20 if rs20 is not None else -math.inf) > 0
        rs_accelerating = (acceleration if acceleration is not None else -math.inf) > 0
        near = current >= trigger or 0 <= distance <= 5
        compressed, dry = compression <= .85, dry_up <= .8
        volume_expanding = projected_volume >= 1.5
        traded_value = mean([bar.close * bar.volume for bar in prior])
        liquid = traded_value >= liquidity_floor
        atr_pct = atr14 / current * 100 if current > 0 else math.inf
        volatility = atr_pct <= 5
        circuit_window = bars[-21:]
        circuits = sum(_circuit_like(a, b) for a, b in zip(circuit_window, circuit_window[1:]))
        circuit_safe = circuits < 2
        spread = latest.high - latest.low
        close_location = max(0, min(1, (current - latest.low) / spread)) if spread > 0 else .5
        gates = [
            _gate("freshness", "Fresh price history", fresh, f"Stock {latest.date}; benchmark {bench_latest.date}." if bench_latest else "Benchmark history unavailable."),
            _gate("trend", "Primary trend", trend, "Price > 20 > 50 > 200-day averages, with the 50-day average rising."),
            _gate("relative_strength", "20-day relative strength", rs_positive, "Benchmark comparison unavailable." if rs20 is None else f"{rs20:.1f}% versus {label}."),
            _gate("rs_acceleration", "Relative-strength acceleration", rs_accelerating, "Short-window comparison unavailable." if acceleration is None else f"{acceleration:.1f} percentage-point acceleration."),
            _gate("proximity", "Near breakout", near, f"{distance:.1f}% below trigger {trigger:.2f}."),
            _gate("compression", "Range compression", compressed, f"{compression:.2f} short/base volatility ratio; requires <= 0.85."),
            _gate("dry_up", "Volume dry-up", dry, f"{dry_up:.2f}x prior volume; requires <= 0.80x."),
            _gate("accumulation", "Accumulation sessions", accumulation >= 2, f"{accumulation} qualifying sessions in the prior ten."),
            _gate("live_volume", "Breakout volume", volume_expanding, f"{projected_volume:.2f}x time-adjusted 20-day volume."),
            _gate("market", "Market regime", regime, f"{label} is above a rising 50-day average." if regime else f"{label} regime is not supportive."),
            _gate("liquidity", "Execution liquidity", liquid, f"20-day traded value {js_round(traded_value):,}; requires {liquidity_label}."),
            _gate("volatility", "Volatility ceiling", volatility, f"ATR is {atr_pct:.1f}% of price; maximum 5%."),
            _gate("circuit", "Circuit behaviour", circuit_safe, f"{circuits} circuit-like sessions in 20; maximum 1."),
        ]
        score = js_round((20 if trend else 0) + (15 if rs_positive else 0) + (10 if rs_accelerating else 0)
            + (10 if near else 0) + (10 if compressed else 0) + (10 if dry else 0)
            + (10 if accumulation >= 2 else 0) + (10 if volume_expanding else 0) + (5 if regime else 0))
        qualifies = fresh and liquid and current >= price_floor and circuit_safe and trend and rs_positive and near and score >= 55
        model_type = "ESTABLISHED"

    triggered = current >= trigger
    if qualifies and triggered and (not volatility or not circuit_safe or extension > .5):
        status = "WAIT_FOR_PULLBACK"
    elif qualifies and triggered and volume_expanding and close_location >= .6:
        status = "ENTRY_READY"
    elif qualifies and triggered:
        status = "BREAKOUT_TRIGGERED"
    elif qualifies:
        status = "EARLY_WATCH"
    else:
        status = "NOT_QUALIFIED"
    return {
        "modelType": model_type, "tradingSessions": len(bars), "status": status,
        "qualifies": qualifies, "score": score, "gates": gates,
        "breakoutLevel": breakout, "entryTrigger": trigger, "atr14": atr14,
        "entryExtensionAtr": extension, "distanceToBreakoutPct": distance,
        "relativeStrength20Pct": rs20, "relativeStrength5Pct": rs5,
        "relativeStrengthAcceleration": acceleration, "compressionRatio": compression,
        "volumeDryUpRatio": dry_up, "projectedVolumeRatio": projected_volume,
        "accumulationDays10": accumulation, "averageTradedValue20": traded_value,
        "closeLocation": close_location, "marketRegimePositive": regime,
        "circuitLikeSessions20": circuits,
    }


def _ema(values: list[float], period: int) -> float:
    multiplier = 2 / (period + 1)
    result = values[0] if values else 0
    for value in values[1:]:
        result = value * multiplier + result * (1 - multiplier)
    return result


def assess_v2(raw: dict[str, Any], legacy: dict[str, Any] | None = None) -> dict[str, Any]:
    legacy = legacy or assess_legacy(raw)
    bars = [Bar.from_json(item) for item in raw["bars"]]
    current, latest, previous = float(raw["currentPrice"]), bars[-1], bars[-2]
    atr = legacy["atr14"]
    events: list[tuple[int, float]] = []
    for index in range(max(20, len(bars) - 10), len(bars)):
        prior = bars[max(0, index - 20):index]
        if not prior:
            continue
        level = max(bar.high for bar in prior) + atr * .1
        if bars[index].high >= level and bars[index - 1].close < level:
            events.append((index, level))
    episode = events[0] if events else None
    for event in events[1:]:
        if episode is None or any(bar.close < episode[1] - atr * .25 for bar in bars[episode[0] + 1:event[0]]):
            episode = event
    age = len(bars) - 1 - episode[0] if episode else None
    gain_atr = (current - episode[1]) / atr if episode and atr > 0 else None
    distance_ema = (current - _ema([bar.close for bar in bars], 10)) / atr if atr > 0 else math.inf
    clusters, in_cluster = 0, False
    for bar in bars[-11:-1]:
        testing = bar.high >= legacy["breakoutLevel"] - atr * .25
        if testing and not in_cluster:
            clusters += 1
        in_cluster = testing
    start5 = bars[-min(6, len(bars))]
    ret5 = pct_change(start5.close, current) or 0
    retreat = max(0, -(pct_change(latest.high, current) or 0)) if latest.high > 0 else 0
    history = bars[max(0, len(bars) - 121):-1]
    highs = [history[index].high for index in range(1, len(history) - 1)
             if history[index].high > current * 1.003 and history[index].high >= history[index - 1].high and history[index].high >= history[index + 1].high]
    resistance = min(highs) if highs else None
    headroom = pct_change(current, resistance) if resistance is not None else None
    rs5, rs20 = legacy["relativeStrength5Pct"], legacy["relativeStrength20Pct"]
    acceleration_pct = rs5 - rs20 * .25 if rs5 is not None and rs20 is not None else None
    passed = {gate["key"]: gate["passed"] for gate in legacy["gates"]}
    triggered = current >= legacy["entryTrigger"]
    fresh_thrust = bool(episode and age == 0 and previous.close < episode[1] and current >= episode[1])
    recent = bool(episode and (age if age is not None else 99) <= 3)
    retest_level = episode[1] if episode else legacy["breakoutLevel"]
    retest = recent and latest.low <= retest_level + atr * .25 and current >= retest_level
    day_two = bool(episode and age in (1, 2) and previous.close >= episode[1]
                   and latest.low >= episode[1] - atr * .25 and current >= previous.close)
    enough_headroom = headroom is None or headroom >= 5
    early = ret5 <= 12
    acceleration = (acceleration_pct if acceleration_pct is not None else -math.inf) > 0
    strong_close = legacy["closeLocation"] >= .8 and retreat <= 1.25
    volume = legacy["projectedVolumeRatio"] >= 1.5
    extension_safe = legacy["entryExtensionAtr"] <= .3
    episode_extension = gain_atr is not None and gain_atr <= 2
    trend_extension = distance_ema <= 1.75
    timing_safe = (age if age is not None else 99) <= 2
    no_chase = extension_safe and episode_extension and trend_extension and timing_safe
    repeat_safe = clusters <= 1
    price_floor = float(raw.get("priceFloor") or 20)
    safety = all(passed.get(key, False) for key in ("freshness", "liquidity", "circuit", "volatility")) and current >= price_floor
    structure = passed.get("trend", False) and passed.get("relative_strength", False)
    pre = not triggered and 0 <= legacy["distanceToBreakoutPct"] <= 3 and structure and safety
    failed = recent and current < retest_level - atr * .25
    late = bool(episode and current >= episode[1] and (not early or not enough_headroom or not acceleration or not strong_close or not repeat_safe or not no_chase))
    raw_score = ((25 if fresh_thrust or retest or day_two else 15 if pre else 0) + (20 if enough_headroom else 0)
        + (15 if volume else 0) + (15 if strong_close else 0) + (10 if acceleration else 0)
        + (10 if passed.get("compression") or passed.get("dry_up") else 0) + (5 if legacy["marketRegimePositive"] else 0)
        - (25 if clusters >= 2 else 0) - (20 if retreat > 1.5 else 0) - (20 if not acceleration else 0)
        - (20 if not early else 0) - (15 if not enough_headroom else 0))
    score = max(0, min(100, js_round(raw_score)))
    if safety and structure and failed:
        status = "FAILED_BREAKOUT"
    elif safety and structure and late:
        status = "LATE_PROFIT_BOOKING"
    elif safety and structure and (retest or day_two) and acceleration and enough_headroom and early:
        status = "MOMENTUM_READY" if volume and strong_close and no_chase else "RETEST_SETUP"
    elif safety and structure and fresh_thrust and acceleration and enough_headroom and early and repeat_safe:
        status = "MOMENTUM_READY" if volume and strong_close and no_chase else "FIRST_THRUST"
    elif pre:
        status = "PRE_IGNITION"
    else:
        status = "NOT_QUALIFIED"
    reasons: list[str] = []
    if not acceleration: reasons.append("Relative strength is decelerating.")
    if not enough_headroom and resistance is not None: reasons.append(f"Only {headroom:.1f}% headroom to resistance {resistance:.2f}.")
    if not early: reasons.append(f"The stock has already risen {ret5:.1f}% over five sessions.")
    if not strong_close: reasons.append(f"Price is {retreat:.1f}% below the session high or outside the top 20% of its range.")
    if not repeat_safe: reasons.append(f"{clusters} recent tests near the breakout increase profit-booking risk.")
    if not timing_safe and age is not None: reasons.append(f"The original breakout is already {age} sessions old.")
    if not episode_extension and gain_atr is not None: reasons.append(f"Price is {gain_atr:.2f} ATR above the original breakout level.")
    if not trend_extension: reasons.append(f"Price is {distance_ema:.2f} ATR above EMA10.")
    if not extension_safe: reasons.append(f"Price is {legacy['entryExtensionAtr']:.2f} ATR beyond the current trigger.")
    if not reasons:
        reasons.append("The first retest is holding; renewed volume and a strong close are still required." if status == "RETEST_SETUP"
                       else "The stock is approaching its first breakout trigger." if status == "PRE_IGNITION"
                       else "Early continuation timing checks pass.")
    atr_pct = atr / current * 100 if current > 0 else 0
    unconstrained = max(3, min(5, atr_pct * 1.25))
    headroom_cap = 5 if headroom is None else max(0, headroom - .5)
    target_pct = max(0, min(unconstrained, headroom_cap))
    result = dict(legacy)
    result.update({
        "legacyStatus": legacy["status"], "status": status, "qualifies": status != "NOT_QUALIFIED", "score": score,
        "breakoutAgeSessions": age, "episodeGainAtr": gain_atr, "distanceEma10Atr": distance_ema,
        "breakoutTests10": clusters, "return5Pct": ret5, "retreatFromHighPct": retreat,
        "resistancePrice": resistance, "resistanceHeadroomPct": headroom,
        "ignitionAccelerationPct": acceleration_pct, "shortHorizonTargetPct": target_pct,
        "shortHorizonDays": 2 if status == "RETEST_SETUP" else 1, "timingReasons": reasons,
    })
    return result


def assess_both(raw: dict[str, Any]) -> dict[str, Any]:
    legacy = assess_legacy(raw)
    v2 = assess_v2(raw, legacy)
    bars = [Bar.from_json(item) for item in raw["bars"]]
    current = float(raw["currentPrice"])
    market_open = bool(raw.get("marketOpen"))
    live_verified = bool(raw.get("liveDataVerified"))
    stop_mult = float(raw.get("stopAtrMult") or 1.5)
    target_rr = float(raw.get("targetRR") or 2)
    trail_mult = float(raw.get("trailAtrMult") or 3)

    legacy_status = legacy["status"]
    if market_open and legacy_status == "ENTRY_READY" and not live_verified:
        legacy_status = "BREAKOUT_TRIGGERED"
    veto = None
    if legacy_status == "ENTRY_READY" and v2["status"] != "MOMENTUM_READY":
        if v2["status"] == "LATE_PROFIT_BOOKING":
            legacy_status = "WAIT_FOR_PULLBACK"
            veto = "Momentum V2 classifies this move as late or profit-booking risk. Do not chase the current price."
        elif v2["status"] == "FAILED_BREAKOUT":
            legacy_status = "WAIT_FOR_PULLBACK"
            veto = "Momentum V2 detects a failed breakout. A new setup must form before entry."
        else:
            legacy_status = "BREAKOUT_TRIGGERED"
            veto = "The broad Momentum setup triggered, but Momentum V2 has not confirmed safe entry timing."
    legacy_entry = current if legacy_status == "ENTRY_READY" else legacy["entryTrigger"]
    risk = legacy["atr14"] * stop_mult
    recent = [bar.close for bar in bars[-min(11, len(bars)):]]
    if legacy_status == "ENTRY_READY" and recent and abs(recent[-1] - legacy_entry) > .0001:
        recent.append(legacy_entry)
        recent = recent[-11:]
    velocity = mean([abs(value - recent[index - 1]) for index, value in enumerate(recent) if index])
    target_distance = risk * target_rr
    legacy_plan = {
        "status": legacy_status, "executionVetoReason": veto,
        "projectedEntry": legacy_entry, "projectedStop": legacy_entry - risk,
        "projectedTarget": legacy_entry + target_distance,
        "projectedTrail": legacy_entry - legacy["atr14"] * trail_mult,
        "projectedDays": min(20, max(1, js_round(target_distance / max(velocity, .01)))),
    }

    v2_entry = current if v2["status"] == "MOMENTUM_READY" else v2["entryTrigger"]
    invalidation = min(bars[-1].low, v2["breakoutLevel"]) if v2["status"] == "RETEST_SETUP" else v2["breakoutLevel"] - v2["atr14"] * .25
    v2_stop = max(v2_entry * .97, invalidation)
    v2_target = v2_entry * (1 + v2["shortHorizonTargetPct"] / 100)
    block = None
    if market_open and not live_verified and current >= v2["entryTrigger"]:
        block = "Fresh authoritative intraday OHLCV and cumulative volume are unavailable."
    elif v2["status"] == "MOMENTUM_READY":
        if not all(math.isfinite(value) for value in (v2_entry, v2_target, v2_stop)) or v2_entry <= 0:
            block = "Execution levels are incomplete or invalid."
        elif v2_stop >= v2_entry:
            block = f"Model stop {v2_stop:.2f} is not below live entry {v2_entry:.2f}."
        elif v2_target <= v2_entry:
            block = f"Model target {v2_target:.2f} is not above live entry {v2_entry:.2f}."
    v2_plan = {
        "status": "EXECUTION_BLOCKED" if block else v2["status"], "modelStatus": v2["status"],
        "executionBlockReason": block, "projectedEntry": v2_entry,
        "projectedStop": v2_stop, "projectedTarget": v2_target,
        "projectedTrail": v2_stop, "projectedDays": v2["shortHorizonDays"],
    }
    return {"legacy": legacy, "v2": v2, "legacyPlan": legacy_plan, "v2Plan": v2_plan}

