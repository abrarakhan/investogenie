"""Authoritative Python calculation engine for Tactical Radar.

Owns market regime classification, Strong Swing near-trigger gate evaluation,
multi-engine confluence scoring/ranking, and ATR reference/invalidation/target levels.
TypeScript is strictly limited to loading persisted inputs, calling this module via
strategy_math_worker.py, and mapping results to web/mobile contracts.
"""
from __future__ import annotations

import math
from typing import Any

HARD_DISQUALIFYING_STRONG_GATES = frozenset({
    "price",
    "liquidity",
    "results_blackout",
    "market_shock",
    "circuit_behaviour",
    "extension_5d",
    "extension_10d",
    "freshness",
})

TIMING_ONLY_STRONG_GATES = frozenset({
    "follow_through",
    "entry_zone",
    "session_hold",
    "session_reversal",
    "live_spread",
    "live_quote",
    "live_circuit",
})


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


def _exchange_rank(exchange: str | None) -> int:
    if exchange in ("NSE", "NASDAQ", "NYSE"):
        return 2
    if exchange == "BSE":
        return 1
    return 0


def _is_etf_like(ticker: str | None, name: str | None) -> bool:
    tk = (ticker or "").strip().upper()
    nm = (name or "").strip().upper()
    if not tk:
        return False
    if tk.endswith(("BEES", "ETF", "IETF")) or "NIFTY" in tk or "BANKNIF" in tk or "SENSEX" in tk:
        return True
    if " ETF" in nm or nm.endswith("ETF") or "EXCHANGE TRADED" in nm or "INDEX FUND" in nm:
        return True
    return False


def classify_market_regime(
    benchmark_above_sma50: bool | None,
    benchmark_change_pct: float | None,
    advancers: int,
    decliners: int,
) -> dict[str, Any]:
    """Fail-closed regime classification from session-aligned breadth and 50DMA benchmark."""
    total = int(advancers or 0) + int(decliners or 0)
    breadth_pct = _round2((advancers / total) * 100.0) if total > 0 else None

    # Fail closed: never claim a bullish/trend regime when benchmark 50DMA or session breadth is missing.
    if benchmark_above_sma50 is None or breadth_pct is None:
        missing = []
        if benchmark_above_sma50 is None:
            missing.append("50-session benchmark history")
        if breadth_pct is None:
            missing.append("session-aligned breadth")
        return {
            "regime": "UNVERIFIED",
            "regimeLabel": "Unverified Tape",
            "summary": f"Market regime is unverified ({' and '.join(missing)} unavailable) — treat tactical setups cautiously.",
            "favoredBucket": "NEAR_TRIGGER",
            "breadthPct": breadth_pct,
        }

    chg = float(benchmark_change_pct) if benchmark_change_pct is not None else 0.0

    if benchmark_above_sma50 and breadth_pct >= 55.0:
        return {
            "regime": "TREND_BREAKOUT",
            "regimeLabel": "Trend / Breakout Tape",
            "summary": "Benchmark holds above 50DMA with positive breadth — favors Near-Trigger Breakouts and Mid-Trend Pullbacks.",
            "favoredBucket": "NEAR_TRIGGER",
            "breadthPct": breadth_pct,
        }

    if (not benchmark_above_sma50 or breadth_pct < 42.0) and chg >= 0.35:
        return {
            "regime": "SNAPBACK_REVERSAL",
            "regimeLabel": "Snapback / Reversal Tape",
            "summary": "Index rebounding from a weak base — Oversold Snapbacks often lead intraday moves while trend setups stay selective.",
            "favoredBucket": "OVERSOLD_SNAPBACK",
            "breadthPct": breadth_pct,
        }

    if not benchmark_above_sma50 and breadth_pct < 45.0 and chg < 0.35:
        return {
            "regime": "DEFENSIVE",
            "regimeLabel": "Defensive / Weak Tape",
            "summary": "Benchmark below 50DMA with weak breadth — treat all tactical setups with smaller size and tight invalidation levels.",
            "favoredBucket": "NEAR_TRIGGER",
            "breadthPct": breadth_pct,
        }

    return {
        "regime": "CHOPPY_ROTATION",
        "regimeLabel": "Choppy / Rotation Tape",
        "summary": "Mixed breadth with selective sector strength — focus on multi-engine Near-Trigger leaders and clean Mid-Trend Pullbacks.",
        "favoredBucket": "MID_TREND_PULLBACK",
        "breadthPct": breadth_pct,
    }


def evaluate_strong_swing_near_trigger(gates: Any) -> dict[str, Any]:
    if not isinstance(gates, list):
        return {"eligible": False, "failedTimingGates": [], "failedOtherGates": ["missing_gates"]}
    failed_timing: list[str] = []
    failed_other: list[str] = []
    for raw in gates:
        if not isinstance(raw, dict):
            continue
        key = raw.get("key")
        if raw.get("passed") is not False or raw.get("blocking") is False or not key:
            continue
        if key in HARD_DISQUALIFYING_STRONG_GATES:
            return {"eligible": False, "failedTimingGates": failed_timing, "failedOtherGates": [key]}
        if key in TIMING_ONLY_STRONG_GATES:
            failed_timing.append(str(key))
        else:
            failed_other.append(str(key))
    return {
        "eligible": len(failed_other) <= 1,
        "failedTimingGates": failed_timing,
        "failedOtherGates": failed_other,
    }


def compute_atr_levels(
    price: float,
    atr_pct: float | None,
    mode: str,
    sma20: float | None = None,
) -> dict[str, float]:
    safe_atr = min(8.0, max(1.5, atr_pct if atr_pct is not None else 3.0))
    stop_mult = 1.2 if mode == "SNAPBACK" else 1.5
    rr_mult = 1.8 if mode == "SNAPBACK" else 2.0
    stop_dist = price * ((safe_atr * stop_mult) / 100.0)
    invalidation_stop = _round2(max(0.01, price - stop_dist))
    risk = max(0.01, price - invalidation_stop)
    target_zone = _round2(price + risk * rr_mult)
    if mode == "SNAPBACK" and sma20 is not None and sma20 > price * 1.03:
        target_zone = _round2(max(target_zone, sma20))
    risk_pct = _round2((risk / price) * 100.0)
    return {
        "referenceEntry": _round2(price),
        "invalidationStop": invalidation_stop,
        "targetZone": target_zone,
        "riskPct": risk_pct,
    }


def assess(payload: dict[str, Any]) -> dict[str, Any]:
    """Compute Tactical Radar regime, buckets, confluence ranking, and ATR levels."""
    price_floor = float(payload.get("priceFloor") or 20.0)
    traded_value_floor = _to_num(payload.get("tradedValueFloor"))
    if traded_value_floor is None or traded_value_floor <= 0:
        traded_value_floor = 1_000_000 if payload.get("market") == "US" else 10_000_000
    limit = max(1, int(payload.get("limitPerBucket") or 10))
    excluded = set(payload.get("excludedAssetIds") or [])
    news_notes: dict[str, str] = payload.get("newsNotes") or {}

    breadth = payload.get("breadth") or {}
    advancers = int(breadth.get("advancers") or 0)
    decliners = int(breadth.get("decliners") or 0)
    bench = payload.get("benchmark") or {}
    bench_above_50 = bench.get("aboveSma50")
    if bench_above_50 is not None:
        bench_above_50 = bool(bench_above_50)
    bench_chg = _to_num(bench.get("changePct"))

    regime_info = classify_market_regime(bench_above_50, bench_chg, advancers, decliners)
    context = {
        **regime_info,
        "benchmarkTicker": str(bench.get("ticker") or ""),
        "benchmarkPrice": _to_num(bench.get("price")),
        "benchmarkChangePct": bench_chg,
        "benchmarkAboveSma50": bench_above_50,
        "advancers": advancers,
        "decliners": decliners,
        "asOfDate": breadth.get("asOfDate"),
    }

    # ---- Bucket 1: NEAR_TRIGGER ----
    near_by_ticker: dict[str, dict[str, Any]] = {}

    def upsert_near(ticker: str, exchange: str | None, init: dict[str, Any], engine_label: str, reason_part: str) -> None:
        existing = near_by_ticker.get(ticker)
        if existing is None:
            near_by_ticker[ticker] = {
                **init,
                "exchange": exchange or "",
                "engines": [engine_label],
                "engineSet": {engine_label},
                "reasons": [reason_part],
            }
            return
        if _exchange_rank(exchange) > _exchange_rank(existing.get("exchange")):
            existing["assetId"] = init["assetId"]
            existing["exchange"] = exchange or existing["exchange"]
            existing["price"] = init["price"]
            if init.get("changePct") is not None:
                existing["changePct"] = init["changePct"]
        existing["baseScore"] = max(existing["baseScore"], init["baseScore"])
        if engine_label not in existing["engineSet"]:
            existing["engineSet"].add(engine_label)
            existing["engines"].append(engine_label)
            existing["reasons"].append(reason_part)
        for field in ("entry", "stop", "target"):
            if existing.get(field) is None and init.get(field) is not None:
                existing[field] = init[field]

    for row in payload.get("strongRows") or []:
        aid = row.get("assetId")
        if not aid or aid in excluded or _is_etf_like(row.get("ticker"), row.get("name")):
            continue
        check = evaluate_strong_swing_near_trigger(row.get("gates"))
        if not check["eligible"]:
            continue
        price = _to_num(row.get("livePrice")) or _to_num(row.get("currentPrice"))
        if price is None or price < price_floor:
            continue
        score = _to_num(row.get("strengthScore")) or 0.0
        timing_list = (check["failedTimingGates"] + check["failedOtherGates"])[:2]
        if not timing_list:
            reason_part = f"Strong Swing ({round(score)}) ready"
        else:
            joined = ", ".join(g.replace("_", " ") for g in timing_list)
            reason_part = f"Strong Swing ({round(score)}) · awaiting {joined}"
        upsert_near(
            str(row["ticker"]),
            row.get("exchange"),
            {
                "assetId": aid,
                "ticker": str(row["ticker"]),
                "name": str(row.get("name") or row["ticker"]),
                "sector": row.get("sector"),
                "baseScore": score,
                "price": price,
                "changePct": _to_num(row.get("liveChangePct")),
                "entry": _to_num(row.get("confirmationEntry")),
                "stop": _to_num(row.get("projectedStop")),
                "target": _to_num(row.get("projectedTarget")),
                "rsi14": _to_num(row.get("rsi14")),
                "atrPct": _to_num(row.get("atrPct")),
                "volumeRatio": _to_num(row.get("volumeRatio")),
                "return5d": _to_num(row.get("return5d")),
                "return20d": _to_num(row.get("return20d")),
                "distanceSma20Pct": _to_num(row.get("distanceSma20Pct")),
                "distanceSma200Pct": _to_num(row.get("distanceSma200Pct")),
                "asOfDate": row.get("asOfDate"),
            },
            "Strong Swing",
            reason_part,
        )

    for row in payload.get("trendRows") or []:
        aid = row.get("assetId")
        if not aid or aid in excluded or _is_etf_like(row.get("ticker"), row.get("name")):
            continue
        price = _to_num(row.get("livePrice")) or _to_num(row.get("entry"))
        if price is None or price < price_floor:
            continue
        variant = row.get("setupVariant")
        status = str(row.get("status") or "")
        label = (
            f"Mid-Way ({str(variant).replace('_', ' ')})"
            if variant
            else f"Continuation ({status.replace('_', ' ')})"
        )
        score = min(96.0, _to_num(row.get("score")) or 0.0)
        upsert_near(
            str(row["ticker"]),
            row.get("exchange"),
            {
                "assetId": aid,
                "ticker": str(row["ticker"]),
                "name": str(row.get("name") or row["ticker"]),
                "sector": row.get("sector"),
                "baseScore": score,
                "price": price,
                "changePct": _to_num(row.get("liveChangePct")),
                "entry": _to_num(row.get("entry")),
                "stop": _to_num(row.get("stop")),
                "target": _to_num(row.get("target")),
                "rsi14": _to_num(row.get("rsi14")),
                "atrPct": _to_num(row.get("atrPct")),
                "volumeRatio": _to_num(row.get("volumeRatio")),
                "return5d": _to_num(row.get("return5d")),
                "return20d": _to_num(row.get("return20d")),
                "distanceSma20Pct": _to_num(row.get("distanceSma20Pct")),
                "distanceSma200Pct": _to_num(row.get("distanceSma200Pct")),
                "asOfDate": row.get("asOfDate"),
            },
            "Trend Continuation",
            label,
        )

    for row in payload.get("obsRows") or []:
        aid = row.get("assetId")
        if not aid or aid in excluded or _is_etf_like(row.get("ticker"), row.get("name")):
            continue
        price = _to_num(row.get("livePrice")) or _to_num(row.get("close"))
        if price is None or price < price_floor:
            continue
        raw_eng = str(row.get("engine") or "")
        eng_name = (
            "Trend Continuation"
            if raw_eng == "TREND_CONTINUATION"
            else "Momentum V2"
            if raw_eng == "MOMENTUM_IGNITION_V2"
            else "Momentum"
        )
        status = str(row.get("status") or "")
        base_score = 84.0 if status in ("PRE_IGNITION", "IMPULSE_DETECTED") else 78.0
        upsert_near(
            str(row["ticker"]),
            row.get("exchange"),
            {
                "assetId": aid,
                "ticker": str(row["ticker"]),
                "name": str(row.get("name") or row["ticker"]),
                "sector": row.get("sector"),
                "baseScore": base_score,
                "price": price,
                "changePct": _to_num(row.get("liveChangePct")),
                "entry": None,
                "stop": None,
                "target": None,
                "rsi14": _to_num(row.get("rsi14")),
                "atrPct": _to_num(row.get("atrPct")),
                "volumeRatio": _to_num(row.get("volumeRatio")),
                "return5d": _to_num(row.get("return5d")),
                "return20d": _to_num(row.get("return20d")),
                "distanceSma20Pct": _to_num(row.get("distanceSma20Pct")),
                "distanceSma200Pct": _to_num(row.get("distanceSma200Pct")),
                "asOfDate": row.get("asOfDate"),
            },
            eng_name,
            f"{eng_name} ({status.replace('_', ' ')})",
        )

    for row in payload.get("swingRows") or []:
        aid = row.get("assetId")
        if not aid or aid in excluded or _is_etf_like(row.get("ticker"), row.get("name")):
            continue
        price = _to_num(row.get("livePrice")) or _to_num(row.get("lastClose"))
        if price is None or price < price_floor:
            continue
        raw_score = _to_num(row.get("score")) or 0.0
        score100 = round(min(1.0, raw_score) * 100.0)
        upsert_near(
            str(row["ticker"]),
            row.get("exchange"),
            {
                "assetId": aid,
                "ticker": str(row["ticker"]),
                "name": str(row.get("name") or row["ticker"]),
                "sector": row.get("sector"),
                "baseScore": float(max(70, min(90, score100))),
                "price": price,
                "changePct": _to_num(row.get("liveChangePct")),
                "entry": None,
                "stop": None,
                "target": None,
                "rsi14": _to_num(row.get("rsi14")),
                "atrPct": _to_num(row.get("atrPct")),
                "volumeRatio": _to_num(row.get("volumeRatio")),
                "return5d": _to_num(row.get("return5d")),
                "return20d": _to_num(row.get("return20d")),
                "distanceSma20Pct": _to_num(row.get("distanceSma20Pct")),
                "distanceSma200Pct": _to_num(row.get("distanceSma200Pct")),
                "asOfDate": row.get("asOfDate"),
            },
            "Swing Breakout",
            f"Swing Breakout ({score100}/100)",
        )

    near_trigger: list[dict[str, Any]] = []
    for item in near_by_ticker.values():
        confluence = len(item["engines"])
        final_score = min(100, round(item["baseScore"] + (confluence - 1) * 10))
        fallback = compute_atr_levels(item["price"], item["atrPct"], "TREND")
        ref_entry = _round2(item["entry"]) if item.get("entry") and item["entry"] > 0 else fallback["referenceEntry"]
        inv_stop = (
            _round2(item["stop"])
            if item.get("stop") and 0 < item["stop"] < ref_entry
            else fallback["invalidationStop"]
        )
        tgt_zone = (
            _round2(item["target"])
            if item.get("target") and item["target"] > ref_entry
            else fallback["targetZone"]
        )
        risk_pct = _round2(((ref_entry - inv_stop) / ref_entry) * 100.0)
        near_trigger.append({
            "assetId": item["assetId"],
            "ticker": item["ticker"],
            "name": item["name"],
            "exchange": item["exchange"],
            "sector": item.get("sector"),
            "bucket": "NEAR_TRIGGER",
            "riskTier": "MODERATE",
            "score": final_score,
            "price": _round2(item["price"]),
            "changePct": _round2(item["changePct"]) if item.get("changePct") is not None else None,
            "referenceEntry": ref_entry,
            "invalidationStop": inv_stop,
            "targetZone": tgt_zone,
            "riskPct": risk_pct,
            "rsi14": _round2(item["rsi14"]) if item.get("rsi14") is not None else None,
            "atrPct": _round2(item["atrPct"]) if item.get("atrPct") is not None else None,
            "volumeRatio": _round2(item["volumeRatio"]) if item.get("volumeRatio") is not None else None,
            "return5d": _round2(item["return5d"]) if item.get("return5d") is not None else None,
            "return20d": _round2(item["return20d"]) if item.get("return20d") is not None else None,
            "distanceSma20Pct": _round2(item["distanceSma20Pct"]) if item.get("distanceSma20Pct") is not None else None,
            "distanceSma200Pct": _round2(item["distanceSma200Pct"]) if item.get("distanceSma200Pct") is not None else None,
            "engines": item["engines"],
            "confluenceCount": confluence,
            "reason": " + ".join(item["reasons"][:2]),
            "newsNote": news_notes.get(item["assetId"]),
            "asOfDate": item.get("asOfDate"),
        })

    near_trigger.sort(
        key=lambda c: (-c["confluenceCount"], -c["score"], -(c["volumeRatio"] or 0.0), c["ticker"])
    )
    near_trigger = near_trigger[:limit]
    used_tickers = {c["ticker"] for c in near_trigger}

    # ---- Bucket 2: MID_TREND_PULLBACK ----
    pullback_by_ticker: dict[str, dict[str, Any]] = {}
    for row in payload.get("pullbackRows") or []:
        aid = row.get("assetId")
        tk = str(row.get("ticker") or "")
        if not aid or not tk or aid in excluded or tk in used_tickers or _is_etf_like(tk, row.get("name")):
            continue
        prev = pullback_by_ticker.get(tk)
        if prev is None or _exchange_rank(row.get("exchange")) > _exchange_rank(prev.get("exchange")):
            pullback_by_ticker[tk] = row

    mid_trend_pullback: list[dict[str, Any]] = []
    for row in pullback_by_ticker.values():
        price = _to_num(row.get("livePrice")) or _to_num(row.get("close"))
        if price is None or price < price_floor:
            continue
        atr_pct = _to_num(row.get("atrPct"))
        rsi14 = _to_num(row.get("rsi14"))
        ret20 = _to_num(row.get("return20d")) or 0.0
        v_ratio = _to_num(row.get("volumeRatio")) or 1.0
        dist20 = _to_num(row.get("distanceSma20Pct")) or 0.0
        dist200 = _to_num(row.get("distanceSma200Pct"))
        traded_val = _to_num(row.get("tradedValue")) or 0.0
        levels = compute_atr_levels(price, atr_pct, "TREND")
        # Score turnover relative to the market's eligibility floor.
        liq_bonus = min(8.0, 4.0 * math.log10(max(1.0, traded_val / traded_value_floor)))
        score = min(
            96,
            round(
                58
                + min(16.0, ret20 * 0.75)
                + min(12.0, max(0.0, (v_ratio - 0.75) * 10.0))
                + liq_bonus
                + (4 if dist20 <= 4.0 else 0)
            ),
        )
        rsi_str = f"{rsi14:.0f}" if rsi14 is not None else "--"
        mid_trend_pullback.append({
            "assetId": row["assetId"],
            "ticker": str(row["ticker"]),
            "name": str(row.get("name") or row["ticker"]),
            "exchange": str(row.get("exchange") or ""),
            "sector": row.get("sector"),
            "bucket": "MID_TREND_PULLBACK",
            "riskTier": "MODERATE",
            "score": score,
            "price": _round2(price),
            "changePct": _round2(_to_num(row.get("liveChangePct"))) if _to_num(row.get("liveChangePct")) is not None else None,
            **levels,
            "rsi14": _round2(rsi14) if rsi14 is not None else None,
            "atrPct": _round2(atr_pct) if atr_pct is not None else None,
            "volumeRatio": _round2(v_ratio),
            "return5d": _round2(_to_num(row.get("return5d"))) if _to_num(row.get("return5d")) is not None else None,
            "return20d": _round2(ret20),
            "distanceSma20Pct": _round2(dist20),
            "distanceSma200Pct": _round2(dist200) if dist200 is not None else None,
            "engines": ["Stage-2 Pullback"],
            "confluenceCount": 1,
            "reason": f"Above SMA20/50/200 · 20D +{ret20:.1f}% · RSI {rsi_str} · {dist20:.1f}% above SMA20",
            "newsNote": news_notes.get(row["assetId"]),
            "asOfDate": row.get("asOfDate"),
        })

    mid_trend_pullback.sort(key=lambda c: (-c["score"], -(c["return20d"] or 0.0), c["ticker"]))
    mid_trend_pullback = mid_trend_pullback[:limit]
    for c in mid_trend_pullback:
        used_tickers.add(c["ticker"])

    # ---- Bucket 3: OVERSOLD_SNAPBACK ----
    snapback_by_ticker: dict[str, dict[str, Any]] = {}
    for row in payload.get("snapbackRows") or []:
        aid = row.get("assetId")
        tk = str(row.get("ticker") or "")
        if not aid or not tk or aid in excluded or tk in used_tickers or _is_etf_like(tk, row.get("name")):
            continue
        prev = snapback_by_ticker.get(tk)
        if prev is None or _exchange_rank(row.get("exchange")) > _exchange_rank(prev.get("exchange")):
            snapback_by_ticker[tk] = row

    oversold_snapback: list[dict[str, Any]] = []
    for row in snapback_by_ticker.values():
        price = _to_num(row.get("livePrice")) or _to_num(row.get("close"))
        if price is None or price < price_floor:
            continue
        atr_pct = _to_num(row.get("atrPct"))
        rsi14 = _to_num(row.get("rsi14"))
        rsi_val = rsi14 if rsi14 is not None else 38.0
        v_ratio = _to_num(row.get("volumeRatio")) or 1.0
        chg = _to_num(row.get("liveChangePct"))
        dist200 = _to_num(row.get("distanceSma200Pct"))
        sma20 = _to_num(row.get("sma20"))
        levels = compute_atr_levels(price, atr_pct, "SNAPBACK", sma20)
        score = min(
            92,
            round(
                58
                + max(0.0, (42.0 - rsi_val) * 1.1)
                + min(12.0, max(0.0, (v_ratio - 0.7) * 8.0))
                + (8 if chg is not None and chg > 0 else 0)
                + (5 if dist200 is not None and dist200 >= 0 else 0)
            ),
        )
        base_txt = (
            f"{'+' if dist200 >= 0 else ''}{dist200:.1f}% vs 200DMA"
            if dist200 is not None
            else "near base"
        )
        oversold_snapback.append({
            "assetId": row["assetId"],
            "ticker": str(row["ticker"]),
            "name": str(row.get("name") or row["ticker"]),
            "exchange": str(row.get("exchange") or ""),
            "sector": row.get("sector"),
            "bucket": "OVERSOLD_SNAPBACK",
            "riskTier": "HIGHER_MEAN_REVERSION",
            "score": score,
            "price": _round2(price),
            "changePct": _round2(chg) if chg is not None else None,
            **levels,
            "rsi14": _round2(rsi_val),
            "atrPct": _round2(atr_pct) if atr_pct is not None else None,
            "volumeRatio": _round2(v_ratio),
            "return5d": _round2(_to_num(row.get("return5d"))) if _to_num(row.get("return5d")) is not None else None,
            "return20d": _round2(_to_num(row.get("return20d"))) if _to_num(row.get("return20d")) is not None else None,
            "distanceSma20Pct": _round2(_to_num(row.get("distanceSma20Pct"))) if _to_num(row.get("distanceSma20Pct")) is not None else None,
            "distanceSma200Pct": _round2(dist200) if dist200 is not None else None,
            "engines": ["Oversold Snapback"],
            "confluenceCount": 1,
            "reason": f"Mean reversion · RSI {rsi_val:.0f} · {base_txt} · vol {v_ratio:.1f}x",
            "newsNote": news_notes.get(row["assetId"]),
            "asOfDate": row.get("asOfDate"),
        })

    oversold_snapback.sort(key=lambda c: (-c["score"], -(c["volumeRatio"] or 0.0), c["ticker"]))
    oversold_snapback = oversold_snapback[:limit]

    return {
        "context": context,
        "buckets": {
            "NEAR_TRIGGER": near_trigger,
            "MID_TREND_PULLBACK": mid_trend_pullback,
            "OVERSOLD_SNAPBACK": oversold_snapback,
        },
        "excludedCounts": payload.get("excludedCounts") or {"adverseNews": 0, "resultsBlackout": 0},
    }
