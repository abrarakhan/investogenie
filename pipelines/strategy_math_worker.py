#!/usr/bin/env python3
"""JSON stdin/stdout boundary for server-authoritative strategy mathematics."""
from __future__ import annotations

import json
import math
import sys

from strategy_math.strong_swing import assess as assess_strong_swing
from strategy_math.momentum import assess_both as assess_momentum
from strategy_math.trend_execution import assess as assess_trend_execution


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
        status_order = {"EXECUTION_READY": 0, "WAIT_FOR_ENTRY": 1, "WATCHLIST": 2, "RISK_OFF": 3, "INVALIDATED": 4}
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
