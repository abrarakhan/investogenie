"""Advisory recovery targets for still-open swing trades.

All target calculations live in Python. Historical analogues use only completed
paths whose full forward horizon predates the current observation.
"""
import json
import math
import os
import sys

import psycopg2


def true_range(bar, previous_close):
    return max(bar[2] - bar[3], abs(bar[2] - previous_close), abs(bar[3] - previous_close))


def percentile(values, fraction):
    ordered = sorted(values)
    if not ordered:
        return None
    position = (len(ordered) - 1) * fraction
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def round_to_tick(value, tick):
    return round(round(value / tick) * tick, 2)


def recovery_targets(bars, current_price, current_atr, move_1d, move_2d, horizon, tick=0.05):
    """Return an ATR objective and a 60th-percentile similar-path objective."""
    if current_price <= 0 or current_atr <= 0:
        return {"recoveryTarget": None, "historicalTarget": None, "sampleSize": 0, "horizon": horizon}
    horizon = max(2, min(int(horizon), 20))
    recovery = round_to_tick(current_price + current_atr, tick)
    current_atr_pct = current_atr / current_price
    analogues = []
    # Each tuple is (date, open, high, low, close). The last `horizon` bars can
    # never be anchors because their future path is not fully observed.
    for index in range(15, len(bars) - horizon):
        close = bars[index][4]
        prior = bars[index - 1][4]
        prior2 = bars[index - 2][4]
        if min(close, prior, prior2) <= 0:
            continue
        ranges = [true_range(bars[j], bars[j - 1][4]) for j in range(index - 13, index + 1)]
        atr_pct = (sum(ranges) / len(ranges)) / close
        ret_1d = ((close / prior) - 1) * 100
        ret_2d = ((close / prior2) - 1) * 100
        score = (
            abs(ret_1d - (move_1d or 0)) / 2
            + abs(ret_2d - (move_2d or 0)) / 3
            + abs(atr_pct - current_atr_pct) / max(current_atr_pct, 0.005)
        )
        future_high = max(bar[2] for bar in bars[index + 1:index + horizon + 1])
        analogues.append((score, max(0, (future_high / close) - 1)))
    nearest = sorted(analogues, key=lambda item: item[0])[:20]
    historical = None
    if len(nearest) >= 12:
        forward_mfe = percentile([item[1] for item in nearest], 0.60)
        if forward_mfe is not None and forward_mfe > 0:
            historical = round_to_tick(current_price * (1 + forward_mfe), tick)
    return {
        "recoveryTarget": recovery,
        "historicalTarget": historical,
        "sampleSize": len(nearest),
        "horizon": horizon,
    }


def main():
    requests = json.loads(sys.argv[1])
    ids = list({item["assetId"] for item in requests})
    database_url = os.environ.get("DATABASE_URL", "postgresql://localhost:5432/investogenie")
    with psycopg2.connect(database_url) as connection, connection.cursor() as cursor:
        cursor.execute(
            """select asset_id::text,date::text,open,high,low,close
                 from public.daily_ohlcv
                where asset_id=any(%s::uuid[])
                  and date < %s::date
                order by asset_id,date desc""",
            (ids, requests[0]["cutoffDate"]),
        )
        grouped = {}
        for asset_id, date, open_, high, low, close in cursor.fetchall():
            rows = grouped.setdefault(asset_id, [])
            if len(rows) < 600:
                rows.append((date, float(open_), float(high), float(low), float(close)))
    output = {}
    for item in requests:
        bars = list(reversed(grouped.get(item["assetId"], [])))
        output[item["tradeId"]] = recovery_targets(
            bars,
            float(item["currentPrice"]),
            float(item["atr"]),
            item.get("move1dPct"),
            item.get("move2dPct"),
            item["horizon"],
            0.05 if item["market"] == "IN" else 0.01,
        )
    print(json.dumps(output))


if __name__ == "__main__":
    main()
