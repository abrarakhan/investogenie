"""Authoritative Python calculation engine for Sector Catalyst Thrust.

Evaluates both broad sectors and narrow industries on a shared 5-minute checkpoint
(or EOD closing bar) using fail-closed price/volume freshness gates, market-specific
intraday volume curves, session-level first-trigger preservation, and Leaders vs.
Catch-Up Watch separation.
"""
from __future__ import annotations

import math
from statistics import median
from typing import Any

from strategy_math.sector_themes import (
    TAXONOMY_VERSION,
    classify_asset,
    exchange_rank,
    is_etf_like,
    match_related_news,
)

RULE_VERSION = "sector_thrust_v1"

# Separate starting thresholds for industries vs broad sectors
GROUP_THRESHOLDS: dict[str, dict[str, float | int]] = {
    "INDUSTRY": {
        "min_qualifying_stocks": 3,
        "min_qualifying_pct": 0.35,
        "leader_return_pct": 3.5,
        "min_median_return_pct": 2.5,
        "min_eligible_members": 3,
    },
    "SECTOR": {
        "min_qualifying_stocks": 5,
        "min_qualifying_pct": 0.15,
        "leader_return_pct": 2.0,
        "min_median_return_pct": 1.0,
        "min_eligible_members": 5,
    },
}

MIN_PRICE_COVERAGE_PCT = 0.70
MIN_VOLUME_COVERAGE_FOR_MEDIAN = 0.50
MIN_MEDIAN_RVOL = 1.30
MIN_LEADER_RVOL = 1.50
MIN_LEADERS_FOR_VOLUME_ROUTE = 2

CATCH_UP_MIN_RETURN_PCT = 1.0
CATCH_UP_MAX_ATR_MULT = 1.0  # Original baseline rule (<= 1.0 completed-bar ATR)


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


def interpolate_volume_share(points: list[list[float]] | None, progress: float | None) -> float | None:
    """Interpolate expected cumulative volume share from a versioned market_volume_curves point list."""
    if not points or progress is None or not math.isfinite(progress):
        return None
    p = max(0.0, min(1.0, float(progress)))
    cleaned: list[tuple[float, float]] = []
    for item in points:
        if isinstance(item, (list, tuple)) and len(item) >= 2:
            x, y = _to_num(item[0]), _to_num(item[1])
            if x is not None and y is not None:
                cleaned.append((x, y))
    if len(cleaned) < 2:
        return None
    cleaned.sort(key=lambda pair: pair[0])
    if p <= cleaned[0][0]:
        return max(0.01, cleaned[0][1])
    if p >= cleaned[-1][0]:
        return max(0.01, cleaned[-1][1])
    for (x0, y0), (x1, y1) in zip(cleaned, cleaned[1:]):
        if x0 <= p <= x1:
            if x1 <= x0:
                return max(0.01, y1)
            ratio = (p - x0) / (x1 - x0)
            return max(0.01, y0 + ratio * (y1 - y0))
    return None


def compute_member_levels(price: float, atr_pct: float | None) -> dict[str, float]:
    safe_atr = min(8.0, max(1.2, atr_pct if atr_pct is not None else 3.0))
    stop_dist = price * ((safe_atr * 1.5) / 100.0)
    inv_stop = _round2(max(0.01, price - stop_dist))
    risk = max(0.01, price - inv_stop)
    target = _round2(price + risk * 2.0)
    return {
        "referenceEntry": _round2(price),
        "invalidationStop": inv_stop,
        "targetZone": target,
    }


def evaluate_group(
    *,
    group_level: str,
    group_key: str,
    group_label: str,
    parent_sector: str | None,
    members: list[dict[str, Any]],
    mode: str,
    checkpoint_at: str,
    expected_volume_share: float | None,
    prior_first_triggered_at: str | None,
    prior_member_first_seen: dict[str, str],
    articles: list[dict[str, Any]],
    catch_up_max_atr_mult: float = CATCH_UP_MAX_ATR_MULT,
    catch_up_floor_pct: float | None = None,
) -> dict[str, Any]:
    """Evaluate a single broad sector or narrow industry group with fail-closed gates."""
    thresh = GROUP_THRESHOLDS[group_level]
    eligible_count = len(members)
    related_news = match_related_news(articles, group_level, group_key, group_label)

    if eligible_count < int(thresh["min_eligible_members"]):
        return {
            "groupLevel": group_level,
            "groupKey": group_key,
            "groupLabel": group_label,
            "parentSector": parent_sector,
            "status": "UNVERIFIED",
            "unverifiedReason": f"Only {eligible_count} eligible liquid stocks (minimum {int(thresh['min_eligible_members'])}).",
            "eligibleCount": eligible_count,
            "priceFreshCount": sum(1 for m in members if m["priceFresh"]),
            "volumeFreshCount": sum(1 for m in members if m["volumeFresh"]),
            "qualifyingCount": 0,
            "medianReturnPct": None,
            "medianRvol": None,
            "volumeConfirmationRoute": "NONE",
            "firstTriggeredAt": prior_first_triggered_at,
            "relatedNews": related_news,
            "leaders": [],
            "catchUp": [],
        }

    fresh_price_members = [m for m in members if m["priceFresh"] and m["returnPct"] is not None]
    price_fresh_count = len(fresh_price_members)
    price_cov = price_fresh_count / eligible_count

    # Volume freshness: only count members that ALSO have a fresh price and valid baseline volume
    volume_fresh_members: list[dict[str, Any]] = []
    for m in fresh_price_members:
        if m["volumeFresh"] and m["rvol"] is not None:
            volume_fresh_members.append(m)
    volume_fresh_count = len(volume_fresh_members)

    median_return = _round2(median(m["returnPct"] for m in fresh_price_members)) if fresh_price_members else None
    median_rvol = _round2(median(m["rvol"] for m in volume_fresh_members)) if volume_fresh_members else None

    if price_cov < MIN_PRICE_COVERAGE_PCT:
        return {
            "groupLevel": group_level,
            "groupKey": group_key,
            "groupLabel": group_label,
            "parentSector": parent_sector,
            "status": "UNVERIFIED",
            "unverifiedReason": f"Fresh price coverage {price_fresh_count}/{eligible_count} ({price_cov*100:.0f}%) is below 70%.",
            "eligibleCount": eligible_count,
            "priceFreshCount": price_fresh_count,
            "volumeFreshCount": volume_fresh_count,
            "qualifyingCount": 0,
            "medianReturnPct": median_return,
            "medianRvol": median_rvol,
            "volumeConfirmationRoute": "NONE",
            "firstTriggeredAt": prior_first_triggered_at,
            "relatedNews": related_news,
            "leaders": [],
            "catchUp": [],
        }

    if mode == "LIVE" and (expected_volume_share is None or expected_volume_share <= 0):
        return {
            "groupLevel": group_level,
            "groupKey": group_key,
            "groupLabel": group_label,
            "parentSector": parent_sector,
            "status": "UNVERIFIED",
            "unverifiedReason": "Missing verified intraday volume curve for this market.",
            "eligibleCount": eligible_count,
            "priceFreshCount": price_fresh_count,
            "volumeFreshCount": volume_fresh_count,
            "qualifyingCount": 0,
            "medianReturnPct": median_return,
            "medianRvol": None,
            "volumeConfirmationRoute": "NONE",
            "firstTriggeredAt": prior_first_triggered_at,
            "relatedNews": related_news,
            "leaders": [],
            "catchUp": [],
        }

    leader_ret = float(thresh["leader_return_pct"])
    min_stocks = int(thresh["min_qualifying_stocks"])
    min_pct = float(thresh["min_qualifying_pct"])
    min_med_ret = float(thresh["min_median_return_pct"])

    qualifying_leaders = [m for m in fresh_price_members if m["returnPct"] >= leader_ret]
    qualifying_count = len(qualifying_leaders)
    qualifying_pct = qualifying_count / eligible_count

    breadth_ok = (
        qualifying_count >= min_stocks
        and qualifying_pct >= min_pct
        and median_return is not None
        and median_return >= min_med_ret
    )

    # Explicit two-route volume confirmation
    vol_cov_of_fresh = volume_fresh_count / price_fresh_count if price_fresh_count > 0 else 0.0
    route_a_eligible = vol_cov_of_fresh >= MIN_VOLUME_COVERAGE_FOR_MEDIAN
    route_a_pass = route_a_eligible and median_rvol is not None and median_rvol >= MIN_MEDIAN_RVOL

    leaders_with_vol = [m for m in qualifying_leaders if m["volumeFresh"] and m["rvol"] is not None]
    route_b_eligible = len(leaders_with_vol) >= MIN_LEADERS_FOR_VOLUME_ROUTE
    leaders_pace_pass = [m for m in leaders_with_vol if m["rvol"] >= MIN_LEADER_RVOL]
    route_b_pass = len(leaders_pace_pass) >= MIN_LEADERS_FOR_VOLUME_ROUTE

    if route_a_pass:
        vol_route = "MEDIAN_PACE"
        vol_confirmed = True
    elif route_b_pass:
        vol_route = "TWO_LEADERS"
        vol_confirmed = True
    else:
        vol_route = "NONE"
        vol_confirmed = False

    # Fail closed to UNVERIFIED when breadth passes (or overall) and neither volume route has sufficient evidence
    if not route_a_eligible and not route_b_eligible:
        status = "FADED" if prior_first_triggered_at else "UNVERIFIED"
        reason = (
            f"Volume evidence insufficient: {volume_fresh_count}/{price_fresh_count} fresh-priced members "
            f"({vol_cov_of_fresh*100:.0f}% < 50%) and {len(leaders_with_vol)} leaders with fresh volume (< 2)."
        )
        return {
            "groupLevel": group_level,
            "groupKey": group_key,
            "groupLabel": group_label,
            "parentSector": parent_sector,
            "status": status,
            "unverifiedReason": reason,
            "eligibleCount": eligible_count,
            "priceFreshCount": price_fresh_count,
            "volumeFreshCount": volume_fresh_count,
            "qualifyingCount": qualifying_count,
            "medianReturnPct": median_return,
            "medianRvol": median_rvol,
            "volumeConfirmationRoute": "NONE",
            "firstTriggeredAt": prior_first_triggered_at,
            "relatedNews": related_news,
            "leaders": [],
            "catchUp": [],
        }

    if breadth_ok and vol_confirmed:
        status = "ACTIVE"
        first_triggered_at = prior_first_triggered_at or checkpoint_at
        unverified_reason = None
    elif prior_first_triggered_at:
        status = "FADED"
        first_triggered_at = prior_first_triggered_at
        unverified_reason = None
    else:
        status = "WATCH"
        first_triggered_at = None
        unverified_reason = None

    # Build Leaders & Catch-Up Watch lists (populated for ACTIVE and FADED groups)
    leaders_out: list[dict[str, Any]] = []
    catch_up_out: list[dict[str, Any]] = []

    if status in ("ACTIVE", "FADED"):
        sorted_leaders = sorted(
            qualifying_leaders,
            key=lambda m: (
                -m["returnPct"],
                -(m["rvol"] if m["rvol"] is not None else -1.0),
                -(m["avgTradedValue20d"] or 0.0),
                m["ticker"],
            ),
        )
        for m in sorted_leaders[:10]:
            atr_pct = m.get("atrPct")
            atr_ext = _round2(m["returnPct"] / atr_pct) if atr_pct and atr_pct > 0 else None
            levels = compute_member_levels(m["price"], atr_pct)
            rvol_txt = f"{m['rvol']:.1f}x pace" if m["rvol"] is not None else "vol n/a"
            leaders_out.append({
                "assetId": m["assetId"],
                "ticker": m["ticker"],
                "name": m["name"],
                "role": "LEADER",
                "price": _round2(m["price"]),
                "returnPct": _round2(m["returnPct"]),
                "rvol": _round2(m["rvol"]) if m["rvol"] is not None else None,
                "avgTradedValue20d": _round2(m["avgTradedValue20d"]) if m["avgTradedValue20d"] is not None else None,
                "atrPct": _round2(atr_pct) if atr_pct is not None else None,
                "atrExtension": atr_ext,
                "firstSeenAt": prior_member_first_seen.get(m["assetId"], checkpoint_at),
                "reason": f"Leader: +{m['returnPct']:.1f}% (>= +{leader_ret:.1f}%) · {rvol_txt}",
                **levels,
            })

        catch_up_candidates = []
        for m in fresh_price_members:
            ret = m["returnPct"]
            atr_pct = m.get("atrPct")
            if ret < CATCH_UP_MIN_RETURN_PCT or ret >= leader_ret:
                continue
            if atr_pct is None or atr_pct <= 0:
                continue
            max_allowed = catch_up_max_atr_mult * atr_pct
            if catch_up_floor_pct is not None:
                max_allowed = max(max_allowed, catch_up_floor_pct)
            if ret <= max_allowed:
                catch_up_candidates.append(m)

        sorted_catch_up = sorted(
            catch_up_candidates,
            key=lambda m: (
                -(m["rvol"] if m["rvol"] is not None else -1.0),
                -(m["avgTradedValue20d"] or 0.0),
                -m["returnPct"],
                m["ticker"],
            ),
        )
        for m in sorted_catch_up[:10]:
            atr_pct = m["atrPct"]
            atr_ext = _round2(m["returnPct"] / atr_pct)
            levels = compute_member_levels(m["price"], atr_pct)
            rvol_txt = f"{m['rvol']:.1f}x pace" if m["rvol"] is not None else "vol n/a"
            catch_up_out.append({
                "assetId": m["assetId"],
                "ticker": m["ticker"],
                "name": m["name"],
                "role": "CATCH_UP",
                "price": _round2(m["price"]),
                "returnPct": _round2(m["returnPct"]),
                "rvol": _round2(m["rvol"]) if m["rvol"] is not None else None,
                "avgTradedValue20d": _round2(m["avgTradedValue20d"]) if m["avgTradedValue20d"] is not None else None,
                "atrPct": _round2(atr_pct),
                "atrExtension": atr_ext,
                "firstSeenAt": prior_member_first_seen.get(m["assetId"], checkpoint_at),
                "reason": f"Catch-Up: +{m['returnPct']:.1f}% ({atr_ext:.2f} ATR) · {rvol_txt}",
                **levels,
            })

    return {
        "groupLevel": group_level,
        "groupKey": group_key,
        "groupLabel": group_label,
        "parentSector": parent_sector,
        "status": status,
        "unverifiedReason": unverified_reason,
        "eligibleCount": eligible_count,
        "priceFreshCount": price_fresh_count,
        "volumeFreshCount": volume_fresh_count,
        "qualifyingCount": qualifying_count,
        "medianReturnPct": median_return,
        "medianRvol": median_rvol,
        "volumeConfirmationRoute": vol_route,
        "firstTriggeredAt": first_triggered_at,
        "relatedNews": related_news,
        "leaders": leaders_out,
        "catchUp": catch_up_out,
    }


def assess_market_checkpoint(payload: dict[str, Any]) -> dict[str, Any]:
    """Evaluate all broad sectors and narrow industries for one market checkpoint."""
    market = str(payload.get("market") or "IN")
    mode = str(payload.get("mode") or "LIVE")  # LIVE | EOD | REPLAY
    session_date = str(payload.get("sessionDate") or "")
    checkpoint_at = str(payload.get("checkpointAt") or "")
    value_floor = float(payload.get("tradedValueFloor") or (10_000_000 if market == "IN" else 1_000_000))
    price_floor = float(payload.get("priceFloor") or (20.0 if market == "IN" else 2.0))
    curve_points = payload.get("volumeCurvePoints")
    curve_version = payload.get("curveVersion")
    session_progress = _to_num(payload.get("sessionProgress"))
    articles = payload.get("articles") or []
    prior_group_triggers: dict[str, str] = payload.get("priorGroupTriggers") or {}
    prior_member_seen: dict[str, str] = payload.get("priorMemberFirstSeen") or {}
    catch_up_max_atr = float(payload.get("catchUpMaxAtrMult") or CATCH_UP_MAX_ATR_MULT)
    catch_up_floor_pct = _to_num(payload.get("catchUpFloorPct"))

    expected_vol_share = (
        1.0 if mode == "EOD" else interpolate_volume_share(curve_points, session_progress)
    )

    # 1. Deduplicate by company (ticker) preferring primary exchange, exclude ETFs/illiquid
    deduped: dict[str, dict[str, Any]] = {}
    for raw in payload.get("assets") or []:
        tk = str(raw.get("ticker") or "").strip().upper()
        if not tk:
            continue
        if is_etf_like(tk, raw.get("name"), bool(raw.get("isEtf"))):
            continue
        avg_val = _to_num(raw.get("avgTradedValue20d")) or 0.0
        prev_close = _to_num(raw.get("prevClose"))
        if avg_val < value_floor or prev_close is None or prev_close < price_floor:
            continue
        prev = deduped.get(tk)
        if prev is None or exchange_rank(raw.get("exchange")) > exchange_rank(prev.get("exchange")):
            deduped[tk] = raw

    # 2. Classify each eligible company into 1 broad sector + at most 1 narrow industry
    sector_buckets: dict[str, list[dict[str, Any]]] = {}
    sector_labels: dict[str, str] = {}
    industry_buckets: dict[str, list[dict[str, Any]]] = {}
    industry_meta: dict[str, tuple[str, str]] = {}  # key -> (label, parent_sector)
    unclassified_count = 0

    for tk, raw in deduped.items():
        cls = classify_asset(market, tk, raw.get("name"), raw.get("sector"))
        if not cls["classified"]:
            unclassified_count += 1

        prev_close = float(raw["prevClose"])
        live_price = _to_num(raw.get("price"))
        price_fresh = bool(raw.get("priceFresh")) and live_price is not None and live_price > 0
        ret_pct = ((live_price / prev_close) - 1.0) * 100.0 if (price_fresh and live_price is not None) else None

        avg_vol_20d = _to_num(raw.get("avgVolume20d"))
        session_vol = _to_num(raw.get("sessionVolume"))
        vol_fresh = (
            price_fresh
            and bool(raw.get("volumeFresh"))
            and session_vol is not None
            and session_vol >= 0
            and avg_vol_20d is not None
            and avg_vol_20d > 0
            and expected_vol_share is not None
            and expected_vol_share > 0
        )
        rvol = (session_vol / (avg_vol_20d * expected_vol_share)) if vol_fresh else None

        member = {
            "assetId": str(raw["assetId"]),
            "ticker": tk,
            "name": str(raw.get("name") or tk),
            "price": live_price if live_price is not None else prev_close,
            "priceFresh": price_fresh,
            "volumeFresh": vol_fresh,
            "returnPct": ret_pct,
            "rvol": rvol,
            "avgTradedValue20d": _to_num(raw.get("avgTradedValue20d")),
            "atrPct": _to_num(raw.get("atrPct")),
        }

        if cls["classified"]:
            sk = cls["broadSectorKey"]
            sector_buckets.setdefault(sk, []).append(member)
            sector_labels[sk] = cls["broadSector"]

        if cls["industryKey"]:
            ik = cls["industryKey"]
            industry_buckets.setdefault(ik, []).append(member)
            industry_meta[ik] = (cls["industryGroup"], cls["broadSector"])

    groups: list[dict[str, Any]] = []
    for ik, members in sorted(industry_buckets.items()):
        label, parent = industry_meta[ik]
        prior_trig = prior_group_triggers.get(f"INDUSTRY:{ik}")
        groups.append(
            evaluate_group(
                group_level="INDUSTRY",
                group_key=ik,
                group_label=label,
                parent_sector=parent,
                members=members,
                mode=mode,
                checkpoint_at=checkpoint_at,
                expected_volume_share=expected_vol_share,
                prior_first_triggered_at=prior_trig,
                prior_member_first_seen=prior_member_seen,
                articles=articles,
                catch_up_max_atr_mult=catch_up_max_atr,
                catch_up_floor_pct=catch_up_floor_pct,
            )
        )

    for sk, members in sorted(sector_buckets.items()):
        prior_trig = prior_group_triggers.get(f"SECTOR:{sk}")
        groups.append(
            evaluate_group(
                group_level="SECTOR",
                group_key=sk,
                group_label=sector_labels[sk],
                parent_sector=None,
                members=members,
                mode=mode,
                checkpoint_at=checkpoint_at,
                expected_volume_share=expected_vol_share,
                prior_first_triggered_at=prior_trig,
                prior_member_first_seen=prior_member_seen,
                articles=articles,
                catch_up_max_atr_mult=catch_up_max_atr,
                catch_up_floor_pct=catch_up_floor_pct,
            )
        )

    status_rank = {"ACTIVE": 0, "FADED": 1, "WATCH": 2, "UNVERIFIED": 3, "INCONCLUSIVE": 4}
    groups.sort(
        key=lambda g: (
            status_rank.get(g["status"], 9),
            0 if g["groupLevel"] == "INDUSTRY" else 1,
            -(g["medianReturnPct"] if g["medianReturnPct"] is not None else -999.0),
            g["groupLabel"],
        )
    )

    active_count = sum(1 for g in groups if g["status"] == "ACTIVE")
    faded_count = sum(1 for g in groups if g["status"] == "FADED")
    unverified_count = sum(1 for g in groups if g["status"] == "UNVERIFIED")
    run_status = mode if (mode == "EOD" or (expected_vol_share is not None and len(deduped) > 0)) else "UNVERIFIED"
    run_reason = None
    if mode == "LIVE" and expected_vol_share is None:
        run_status = "UNVERIFIED"
        run_reason = "Missing verified intraday volume curve for this market."

    return {
        "market": market,
        "mode": mode,
        "sessionDate": session_date,
        "checkpointAt": checkpoint_at,
        "ruleVersion": RULE_VERSION,
        "taxonomyVersion": TAXONOMY_VERSION,
        "curveVersion": curve_version,
        "status": run_status,
        "unverifiedReason": run_reason,
        "eligibleUniverseCount": len(deduped),
        "unclassifiedCount": unclassified_count,
        "summary": {
            "totalGroups": len(groups),
            "activeGroups": active_count,
            "fadedGroups": faded_count,
            "unverifiedGroups": unverified_count,
        },
        "groups": groups,
    }
