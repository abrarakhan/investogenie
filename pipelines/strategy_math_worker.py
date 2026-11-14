#!/usr/bin/env python3
"""JSON stdin/stdout boundary for server-authoritative strategy mathematics."""
from __future__ import annotations

import json
import math
import sys

from strategy_math.strong_swing import assess as assess_strong_swing
from strategy_math.momentum import assess_both as assess_momentum
from strategy_math.trend_execution import assess as assess_trend_execution
from strategy_math.armed_swing import STATUS_ORDER as ARMED_STATUS_ORDER, assess as assess_armed_swing
from strategy_math.ledger import (assess as assess_ledger, assess_trades as assess_ledger_trades,
                                   assess_gtt as assess_ledger_gtt, assess_progress as assess_ledger_progress,
                                   strategy_follow_up as assess_ledger_followup, assess_overlay as assess_ledger_overlay)
from strategy_math.ledger import assess_news
from strategy_math.swing_scan import (assess as assess_swing_scan, cross_section as assess_swing_cross_section,
                                      levels_for_screen as assess_swing_levels)


def _json_safe(value):
    """Match JSON.stringify: non-finite JavaScript numbers become null."""
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    return value


def main() -> int:
    request = json.load(sys.stdin)
    engine = request.get("engine")
    inputs = request.get("inputs")
    if not isinstance(inputs, list):
        raise ValueError("inputs must be a list")
    if engine == "strong_swing":
        results = [assess_strong_swing(item) for item in inputs]
        status_order = {"EXECUTION_READY": 0, "WAIT_FOR_ENTRY": 1, "WATCHLIST": 2, "UNVERIFIED": 3, "RISK_OFF": 4, "INVALIDATED": 5}
        order = sorted(range(len(results)), key=lambda index: (
            status_order[results[index]["status"]], -results[index]["strengthScore"],
            -float(inputs[index].get("baseScore") or 0), -float(inputs[index].get("rankScore") or float("-inf")),
            str(inputs[index].get("ticker") or ""),
        ))
        for rank, index in enumerate(order, 1):
            results[index]["pythonRank"] = rank
    elif engine == "momentum":
        results = [assess_momentum(item) for item in inputs]
        legacy_order = {"ENTRY_READY": 0, "BREAKOUT_TRIGGERED": 1, "WAIT_FOR_PULLBACK": 2, "EARLY_WATCH": 3, "NOT_QUALIFIED": 4}
        v2_order = {"MOMENTUM_READY": 0, "EXECUTION_BLOCKED": 1, "FIRST_THRUST": 2, "RETEST_SETUP": 3,
                    "PRE_IGNITION": 4, "LATE_PROFIT_BOOKING": 5, "FAILED_BREAKOUT": 6, "NOT_QUALIFIED": 7}
        for key, statuses, score_key, rank_name in (
            ("legacyPlan", legacy_order, "legacy", "legacyRank"),
            ("v2Plan", v2_order, "v2", "v2Rank"),
        ):
            order = sorted(range(len(results)), key=lambda index: (
                statuses[results[index][key]["status"]], -results[index][score_key]["score"],
                -float(inputs[index].get("baseScore") or 0), str(inputs[index].get("ticker") or ""),
            ))
            for rank, index in enumerate(order, 1):
                results[index][rank_name] = rank
    elif engine == "armed_swing":
        results = [assess_armed_swing(item) for item in inputs]
        # Mirrors rankArmedSwingCandidates: actionable first, then stronger leaders closer to
        # their trigger. Ranking belongs here so TypeScript never re-orders the book.
        order = sorted(range(len(results)), key=lambda index: (
            ARMED_STATUS_ORDER[results[index]["status"]],
            -results[index]["strengthScore"],
            -(results[index]["rsPercentile"] if results[index]["rsPercentile"] is not None else -1),
            abs(results[index]["distanceToTriggerAtr"]),
            str(inputs[index].get("ticker") or ""),
        ))
        for rank, index in enumerate(order, 1):
            results[index]["pythonRank"] = rank
    elif engine == "ledger_gtt":
        results = [assess_ledger_gtt(item) for item in inputs]
    elif engine == "ledger_progress":
        results = [assess_ledger_progress(item) for item in inputs]
    elif engine == "ledger_followup":
        results = [assess_ledger_followup(item) for item in inputs]
    elif engine == "ledger_overlay":
        results = [assess_ledger_overlay(item) for item in inputs]
    elif engine == "news_swing":
        results = [assess_news(item) for item in inputs]
        order = sorted(range(len(results)), key=lambda index: (
            1 if results[index]["state"] == "RISK_OFF" else 0,
            -results[index]["combinedScore"], -results[index]["newsAdjustment"],
            -results[index]["technicalScore"], str(inputs[index].get("ticker") or ""),
        ))
        for rank, index in enumerate(order, 1): results[index]["pythonRank"] = rank
    elif engine == "ledger_trades":
        results = [assess_ledger_trades(item) for item in inputs]
    elif engine == "ledger":
        # One summary per request, but the boundary is a batch everywhere else, so keep shape.
        results = [assess_ledger(item) for item in inputs]
    elif engine == "swing_scan":
        results = [assess_swing_scan(item) for item in inputs]
    elif engine == "swing_cross_section":
        results = [assess_swing_cross_section(item) for item in inputs]
    elif engine == "swing_levels":
        results = [assess_swing_levels(item) for item in inputs]
    elif engine == "trend_execution":
        results = [assess_trend_execution(item) for item in inputs]
        statuses = {"TREND_CONTINUATION_READY": 0, "CONTINUATION_WATCH": 1, "IMPULSE_DETECTED": 2, "EXTENDED_RISK": 3}
        order = sorted(range(len(results)), key=lambda index: (
            -int(bool(inputs[index]["candidate"]["ready"])),
            -int(inputs[index]["candidate"].get("metrics", {}).get("developing_staircase") is True),
            statuses[inputs[index]["candidate"]["status"]],
            -float(inputs[index]["candidate"]["score"]),
        ))
        for rank, index in enumerate(order, 1):
            results[index]["pythonRank"] = rank
    else:
        raise ValueError(f"unsupported strategy engine: {engine}")
    json.dump({"engine": engine, "results": _json_safe(results)}, sys.stdout, allow_nan=False, separators=(",", ":"))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
