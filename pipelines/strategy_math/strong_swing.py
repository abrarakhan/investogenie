from __future__ import annotations

import math
from typing import Any

from .common import Bar, average_true_range, js_round, mean, pct_change, round2, sma, structural_breakout

MODEL_VERSION = "strong-swing-v3-python"
TRAILING_POLICY_VERSION = "strong-swing-ledger-trailing-v2-post-entry-next-bar"
CONFIRMATION_ATR_BUFFER = 0.25


def _gate(key: str, label: str, passed: bool, detail: str,
          category: str = "technical", blocking: bool = True) -> dict[str, Any]:
    return {"key": key, "label": label, "passed": passed, "detail": detail,
            "category": category, "blocking": blocking}


def _breakout_level(bars: list[Bar]) -> float:
    window = bars[-22:-2]
    return max(bar.high for bar in window) if window else bars[-1].close


def _protective_stop(entry: float, atr: float, stop_mult: float) -> float:
    return round2(max(0.0, round2(entry) - stop_mult * atr))


def _circuit_like(previous: Bar, current: Bar) -> bool:
    change = pct_change(previous.close, current.close)
    if change is None or not any(abs(abs(change) - band) <= 0.25 for band in (5, 10, 20)):
        return False
    spread = current.high - current.low
    if spread <= 0:
        return True
    location = (current.close - current.low) / spread
    return location >= 0.98 if change > 0 else location <= 0.02


def _sessions_between(left: str, right: str, dates: list[str]) -> float:
    left, right = left[:10], right[:10]
    if len(left) != 10 or len(right) != 10:
        return math.inf
    first, last = sorted((left, right))
    return len({value[:10] for value in dates if first < value[:10] <= last})


def _fmt(value: float, digits: int) -> str:
    return f"{value:.{digits}f}"


def assess(raw: dict[str, Any]) -> dict[str, Any]:
    bars = [Bar.from_json(item) for item in raw["bars"]]
    benchmark = [Bar.from_json(item) for item in raw.get("benchmarkBars", [])]
    if len(bars) < 21:
        raise ValueError("Strong Swing requires at least 21 bars.")
    market = raw["market"]
    verdict = str(raw.get("verdict") or "NO_SETUP")
    latest, previous = bars[-1], bars[-2]
    closes = [bar.close for bar in bars]
    sma20, sma50, sma200 = sma(closes, 20), sma(closes, 50), sma(closes, 200)
    sma50_prior = sma(closes, 50, len(closes) - 20)
    current_price = float(raw.get("currentPrice") or latest.close)
    stop_mult = float(raw.get("stopAtrMult") or 1.5)
    target_rr = float(raw.get("targetRR") or 2)
    atr = max(0.0, average_true_range(bars))
    prior_atr = average_true_range(bars[:-1])
    latest_breakout = structural_breakout(bars)
    previous_breakout = structural_breakout(bars[:-1])
    breakout_bar = "latest" if latest_breakout else "previous" if previous_breakout else None
    is_breakout = breakout_bar is not None
    level = _breakout_level(bars)
    entry = level + CONFIRMATION_ATR_BUFFER * atr
    trailing_stop = _protective_stop(entry, atr, stop_mult)
    effective_trail = _protective_stop(level + CONFIRMATION_ATR_BUFFER * prior_atr, prior_atr, stop_mult)

    five_ago = bars[-6] if len(bars) >= 6 else None
    ten_ago = bars[-11] if len(bars) >= 11 else None
    ret5 = pct_change(five_ago.close, latest.close) if five_ago else None
    ret10 = pct_change(ten_ago.close, latest.close) if ten_ago else None
    above_sma20 = pct_change(sma20, latest.close) if sma20 is not None else None
    atr_pct = atr / latest.close * 100 if latest.close > 0 else math.inf
    stop_risk = atr * stop_mult / entry * 100 if entry > 0 else math.inf
    extension_atr = (current_price - entry) / atr if atr > 0 else math.inf
    circuit_window = bars[-21:]
    circuit_count = sum(_circuit_like(before, bar) for before, bar in zip(circuit_window, circuit_window[1:]))
    prior20 = bars[-21:-1]
    avg_volume = mean([bar.volume for bar in prior20])
    volume_ratio = latest.volume / avg_volume if avg_volume > 0 else 0
    avg_value = mean([bar.close * bar.volume for bar in prior20])
    spread = latest.high - latest.low
    close_location = (latest.close - latest.low) / spread if spread > 0 else 0.5
    clearance = (latest.close - level) / atr if atr > 0 else 0

    def benchmark_before(day: str) -> Bar | None:
        return next((bar for bar in reversed(benchmark) if bar.date <= day), None)

    stock_start = bars[-21] if len(bars) >= 21 else None
    stock_return = pct_change(stock_start.close, latest.close) if stock_start else None
    bench_start = benchmark_before(stock_start.date) if stock_start else None
    bench_end = benchmark_before(latest.date) or (benchmark[-1] if benchmark else None)
    bench_return = pct_change(bench_start.close, bench_end.close) if bench_start and bench_end and bench_start is not bench_end else None
    relative_strength = stock_return - bench_return if stock_return is not None and bench_return is not None else None
    benchmark_closes = [bar.close for bar in benchmark]
    bench_sma50 = sma(benchmark_closes, 50)
    bench_sma50_prior = sma(benchmark_closes, 50, len(benchmark_closes) - 20)
    bench_latest = benchmark[-1] if benchmark else None
    regime = bool(bench_latest and bench_sma50 is not None and bench_sma50_prior is not None
                  and bench_latest.close > bench_sma50 > bench_sma50_prior)
    bench_two_day = pct_change(benchmark[-3].close, benchmark[-1].close) if len(benchmark) >= 3 else None
    market_shock = (bench_two_day or 0) <= -4
    exposure = 0 if market_shock else 100 if regime else 50
    reference_date = bench_latest.date if bench_latest else latest.date
    fresh = bool(benchmark) and _sessions_between(latest.date, reference_date,
        [bar.date for bar in bars] + [bar.date for bar in benchmark]) <= 1
    price_floor = 20 if market == "IN" else 2
    value_floor = 10_000_000 if market == "IN" else 1_000_000
    trend_history = all(value is not None for value in (sma20, sma50, sma200, sma50_prior))
    trend = bool(trend_history and latest.close > sma50 and latest.close > sma200 and sma20 > sma50 > sma50_prior)
    follow_through = previous.close >= entry and latest.close >= entry
    has_oi = bool(five_ago and five_ago.open_interest is not None and latest.open_interest is not None
                  and five_ago.open_interest > 0)
    oi_change = pct_change(five_ago.open_interest, latest.open_interest) if has_oi and five_ago else None
    price_change5 = pct_change(five_ago.close, latest.close) if five_ago else None
    oi_confirmed = has_oi and (oi_change or 0) >= 5 and (price_change5 or 0) > 0
    volume_trend5 = mean([bar.volume for bar in bars[-5:]]) / avg_volume if avg_volume > 0 else 0
    cash_confirmed = not has_oi and (price_change5 or 0) > 0 and volume_trend5 >= 1.2
    micro = raw.get("microstructure") or {}
    require_live = bool(raw.get("requireLiveExecutionData"))
    bid, ask = micro.get("bestBid"), micro.get("bestAsk")
    lower = micro.get("lowerCircuit")
    quote_fresh = bool(micro.get("quoteFresh"))
    live_not_required = market != "IN" or not require_live
    spread_pct = ((float(ask) - float(bid)) / float(ask)) * 100 if bid and ask else None

    gates = [
        _gate("structure", "Structural setup", is_breakout, "Existing engine detected a breakout." if is_breakout else f"Base verdict: {verdict}."),
        _gate("freshness", "Fresh EOD data", fresh, "Benchmark data unavailable — cannot verify freshness." if not benchmark else f"Latest bar {latest.date}." if fresh else f"Latest bar {latest.date}; benchmark {reference_date}.", "execution"),
        _gate("price", "Price floor", latest.close >= price_floor, f"{latest.close:.2f} vs minimum {price_floor:.2f}.", "execution"),
        _gate("liquidity", "20-day liquidity", avg_value >= value_floor, f"Average traded value {js_round(avg_value):,}.", "execution"),
        _gate("trend", "Primary trend", trend, "Price > 50/200 SMA; 20 > 50 and 50 SMA rising." if trend_history else "Insufficient 200-session trend history."),
        _gate("relative_strength", "Relative strength", (relative_strength if relative_strength is not None else -math.inf) > 0, "Benchmark comparison unavailable." if relative_strength is None else f"{relative_strength:.1f}% vs benchmark over 20 sessions."),
        _gate("clearance", "Decisive breakout", clearance >= .25, f"{clearance:.2f} ATR above the {level:.2f} 20-session high; requires 0.25."),
        _gate("close_quality", "Strong close", close_location >= .7, f"Closed at {js_round(close_location * 100)}% of the daily range; requires top 30%."),
        _gate("volume", "Volume confirmation", volume_ratio >= 1.5, f"{volume_ratio:.2f}x 20-session average; requires 1.50x."),
        _gate("follow_through", "Two-close follow-through", follow_through, f"Both latest closes must hold above {entry:.2f}."),
        _gate("market_regime", "Market regime", regime, "Benchmark data unavailable — regime cannot be assessed." if not benchmark else "Benchmark is above a rising 50 SMA; normal sizing." if regime else "Selective regime: use 50% position size and demand relative strength.", "execution", False),
        _gate("market_shock", "Market shock", not market_shock, "Two-session benchmark move unavailable." if bench_two_day is None else f"{bench_two_day:.1f}% over two sessions; entries stop at -4%.", "execution"),
        _gate("confirmation", "OI build-up" if has_oi else "Cash-equity confirmation", bool(oi_confirmed if has_oi else cash_confirmed), f"{(oi_change or 0):.1f}% OI change over five sessions." if has_oi else f"{volume_trend5:.2f}x five-session volume vs the 20-session base, price {(price_change5 or 0):.1f}% over five sessions; requires 1.20x and a rise."),
        _gate("entry_zone", "Entry discipline", extension_atr <= .5, f"{extension_atr:.2f} ATR above confirmed entry {entry:.2f}; maximum 0.50 ATR.", "execution"),
        _gate("extension_5d", "Five-session extension", (ret5 if ret5 is not None else math.inf) <= 30, "Five-session return unavailable." if ret5 is None else f"{ret5:.1f}%; maximum 30%.", "execution"),
        _gate("extension_10d", "Ten-session extension", (ret10 if ret10 is not None else math.inf) <= 50, "Ten-session return unavailable." if ret10 is None else f"{ret10:.1f}%; maximum 50%.", "execution"),
        _gate("sma20_extension", "20-day extension", (above_sma20 if above_sma20 is not None else math.inf) <= 15, "20-day average unavailable." if above_sma20 is None else f"{above_sma20:.1f}% above SMA20; maximum 15%.", "execution"),
        _gate("atr_risk", "Volatility ceiling", atr_pct <= 5, f"ATR is {atr_pct:.1f}% of price; maximum 5%.", "execution"),
        _gate("stop_width", "Stop-risk ceiling", stop_risk <= 7, f"Technical stop requires {stop_risk:.1f}% risk; maximum 7%.", "execution"),
        _gate("circuit_behaviour", "Circuit behaviour", circuit_count < 2, f"{circuit_count} circuit-like closes in 20 sessions; maximum 1.", "execution"),
        _gate("live_quote", "Live broker quote", live_not_required or quote_fresh, "Live broker verification is required only during the open India session." if live_not_required else "Breeze quote is current." if quote_fresh else "Fresh Breeze execution quote is unavailable.", "execution"),
        _gate("live_spread", "Live bid-ask spread", live_not_required or (spread_pct is not None and spread_pct <= .75), "Live depth is required only during the open India session." if live_not_required else f"{spread_pct:.2f}% spread; maximum 0.75%." if spread_pct is not None else "Not verified: Breeze bid/ask depth is absent.", "execution"),
        _gate("live_circuit", "Circuit exit room", live_not_required or not lower or current_price > float(lower) * 1.03, "Live circuit verification is required only during the open India session." if live_not_required else f"{((current_price/float(lower))-1)*100:.1f}% above lower circuit; requires 3%." if lower else "Live circuit band is unavailable; the 20-session circuit-behaviour gate remains authoritative.", "execution"),
    ]
    structure = next(gate for gate in gates if gate["key"] == "structure")
    structure["detail"] = "Latest completed bar closed above its 20-session high or upper band." if breakout_bar == "latest" else "Previous completed bar broke out; the latest bar is the hold." if breakout_bar == "previous" else f"Neither of the last two completed bars broke out (base scan: {verdict})."
    score = js_round(sum(bool(gate["passed"]) for gate in gates) / len(gates) * 100)
    breakout_failed = is_breakout and atr > 0 and latest.close < level - atr
    hard = {"extension_5d", "extension_10d", "sma20_extension", "atr_risk", "stop_width", "circuit_behaviour", "freshness", "price", "liquidity", "live_quote", "live_spread", "live_circuit", "market_shock"}
    hard_failed = any(gate["key"] in hard and gate["key"] != "sma20_extension" and not gate["passed"] for gate in gates)
    extension_failed = not next(gate["passed"] for gate in gates if gate["key"] == "sma20_extension")
    entry_failed = not next(gate["passed"] for gate in gates if gate["key"] == "entry_zone")
    technical_passed = all(gate["passed"] for gate in gates if gate["category"] == "technical" and gate["blocking"])
    if breakout_failed:
        status = "INVALIDATED"
    elif hard_failed:
        status = "RISK_OFF"
    elif technical_passed and (entry_failed or extension_failed):
        status = "WAIT_FOR_ENTRY"
    elif extension_failed:
        status = "RISK_OFF"
    elif all(gate["passed"] for gate in gates if gate["blocking"]):
        status = "EXECUTION_READY"
    else:
        status = "WATCHLIST"

    rounded_entry = round2(entry)
    strong_stop = _protective_stop(entry, atr, stop_mult)
    strong_target = round2(rounded_entry + target_rr * (rounded_entry - strong_stop))
    recent_closes = [bar.close for bar in bars[-21:]]
    velocity = mean([abs(value - recent_closes[index - 1]) for index, value in enumerate(recent_closes) if index])
    distance = abs(strong_target - rounded_entry)
    expected_days = 0 if velocity <= 0 else min(60, max(1, js_round(distance / velocity)))

    return {
        "status": status, "strengthScore": score, "gates": gates,
        "confirmationEntry": entry, "latestClose": latest.close, "latestDate": latest.date,
        "sma20": sma20, "sma50": sma50, "sma200": sma200,
        "relativeStrength20Pct": relative_strength, "averageTradedValue20": avg_value,
        "volumeRatio": volume_ratio, "closeLocation": close_location,
        "triggerClearanceAtr": clearance, "oiChange5Pct": oi_change,
        "marketRegimePositive": regime, "confirmationMode": "OI" if has_oi else "CASH",
        "fiveDayReturnPct": ret5, "tenDayReturnPct": ret10,
        "distanceAboveSma20Pct": above_sma20, "atrPct": atr_pct,
        "stopRiskPct": stop_risk, "entryExtensionAtr": extension_atr,
        "circuitLikeSessions20": circuit_count, "suggestedExposurePct": exposure,
        "atr": atr, "isBreakout": is_breakout, "breakoutBar": breakout_bar,
        "trailingStop": trailing_stop, "effectiveTrailingStop": effective_trail,
        "strongEntry": entry, "strongStop": strong_stop, "strongTarget": strong_target,
        "strongTrail": strong_stop, "strongExpectedDays": expected_days,
        "modelVersion": MODEL_VERSION,
    }

