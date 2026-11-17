from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

from .armed_swing import expected_volume_share, valid_session_volume_curve

BLACKOUT_SESSIONS = 3

# The confirmation window opens at 10:15 IST, an hour into the session. Before that a
# volume pace reading is mostly noise: the opening auction and the first minutes carry a
# disproportionate share of the day's volume, so any stock looks fast.
CONFIRMATION_MINUTE = 60
SESSION_MINUTES = 375  # 09:15-15:30 IST

# How fast the day's volume must be running, against the median session's shape at the
# same minute. A single decisive bar is asked for more than three ordinary ones, because
# the stair-step has already shown three sessions of evidence.
IMPULSE_MIN_TOD_RVOL = 2.5
STAIR_STEP_MIN_TOD_RVOL = 1.8

SETUP_STAGE2 = "STAGE2_IMPULSE"
SETUP_EP_REBOUND = "EP_REBOUND"
SETUP_STAIR_STEP = "STAIR_STEP"


def _number(value: Any) -> float | None:
    return None if value is None else float(value)


def _trading_day(day: date, holidays: set[str], specials: set[str]) -> bool:
    value = day.isoformat()
    return value in specials or (day.weekday() < 5 and value not in holidays)


def _offset(day: str, sessions: int, holidays: set[str], specials: set[str]) -> str:
    cursor = date.fromisoformat(day)
    remaining = sessions
    while remaining:
        cursor += timedelta(days=1)
        if _trading_day(cursor, holidays, specials):
            remaining -= 1
    return cursor.isoformat()


def _lag(start: str, end: str, holidays: set[str], specials: set[str]) -> int:
    if start >= end:
        return 0
    cursor = date.fromisoformat(start)
    count = 0
    while cursor.isoformat() < end and count < 5000:
        cursor += timedelta(days=1)
        if _trading_day(cursor, holidays, specials):
            count += 1
    return count


def _parse(value: str | None) -> datetime | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _coverage(execution: dict[str, Any] | None, today: str, required_from: str,
              required_through: str, now: datetime) -> tuple[bool, str]:
    if not execution:
        return False, "Results calendar unavailable."
    success = _parse(execution.get("last_success_at"))
    today_dt = datetime.fromisoformat(today).replace(tzinfo=timezone.utc)
    if success is None or (today_dt - success.astimezone(timezone.utc)).total_seconds() > 7 * 86400:
        return False, "Results calendar not checked in the last 7 days."
    if execution.get("next_date"):
        return True, f"Next results {execution['next_date']}."
    if (execution.get("authoritative_source") == "NSE_CALENDAR"
            and execution.get("authoritative_as_of") == today
            and execution.get("authoritative_coverage_from")
            and execution["authoritative_coverage_from"] <= required_from
            and execution.get("authoritative_coverage_through")
            and execution["authoritative_coverage_through"] >= required_through):
        return True, f"NSE calendar checked through {execution['authoritative_coverage_through']}; no result is announced in the blackout window."
    # A past result does not prove the next three sessions are clear. Only an explicit
    # upcoming date or authoritative coverage spanning the whole blackout can verify
    # this execution gate.
    return False, "The authoritative results calendar does not cover the full blackout window."




def session_progress(minutes_elapsed: float | None) -> float | None:
    """How far through the session we are, 0 at the open and 1 at the close."""
    if minutes_elapsed is None:
        return None
    return max(0.0, min(1.0, minutes_elapsed / SESSION_MINUTES))


def time_of_day_rvol(live: dict[str, Any] | None, curve: dict[str, Any] | None,
                     average_volume_20: float | None, market: str = "IN") -> float | None:
    """Today's cumulative volume against what this market normally has by now.

    A raw volume comparison at 10:30 says almost nothing, because a normal session has
    only done a fraction of its day by then. The 40-session curve from migration 0077 --
    the same one Armed Swing uses, rather than a second one maintained in parallel --
    gives the share expected at this minute, and the ratio against it is what makes an
    early reading comparable to a full day's.
    """
    if not live or not average_volume_20 or average_volume_20 <= 0:
        return None
    if not valid_session_volume_curve(curve, market):
        return None
    progress = session_progress(_number(live.get("minutesElapsed")))
    if progress is None:
        return None
    expected_share = expected_volume_share(curve, progress)
    if expected_share <= 0:
        return None
    volume = _number(live.get("volume"))
    if volume is None or volume < 0:
        return None
    return volume / (average_volume_20 * expected_share)


def required_tod_rvol(setup_variant: str | None) -> float:
    return STAIR_STEP_MIN_TOD_RVOL if setup_variant == SETUP_STAIR_STEP else IMPULSE_MIN_TOD_RVOL


def breakout_confirmed(setup_variant: str | None, price: float | None,
                       levels: dict[str, Any] | None) -> tuple[bool, str]:
    """Whether today's price has actually broken the level the variant entries on.

    Each variant has its own level, and they are not interchangeable:

    * a stage-2 impulse or event rebound enters on day two through day one's high, or on
      day three through day two's high when day two sat inside day one's range;
    * a stair-step enters on day four through the highest of its three steps.

    Without the level there is no entry. Treating a missing level as satisfied would make
    the pace gate the only thing standing between a candidate and a buy button.
    """
    if price is None or not levels:
        return False, "Today's breakout level is unavailable."
    if setup_variant == SETUP_STAIR_STEP:
        level = _number(levels.get("stairStepHigh"))
        if level is None:
            return False, "The three-session stair-step high is unavailable."
        if price <= level:
            return False, f"Price {price:.2f} has not cleared the stair-step high {level:.2f}."
        return True, f"Cleared the three-session stair-step high {level:.2f}."
    previous_high = _number(levels.get("previousSessionHigh"))
    if previous_high is None:
        return False, "The prior session's high is unavailable."
    inside_day = bool(levels.get("insideDay"))
    if price <= previous_high:
        shape = "inside-day" if inside_day else "opening-range"
        return False, f"Price {price:.2f} has not cleared the {shape} level {previous_high:.2f}."
    return True, f"Cleared {previous_high:.2f}, the prior session's high."


def assess(raw: dict[str, Any]) -> dict[str, Any]:
    row = raw["candidate"]
    execution = raw.get("execution")
    now = _parse(raw["now"])
    assert now is not None
    today = raw["sessionDate"]
    holidays = set(raw.get("holidays", []))
    specials = set(raw.get("specialTradingDates", []))
    required_from = _offset(today, 1, holidays, specials)
    required_through = _offset(today, BLACKOUT_SESSIONS, holidays, specials)
    price = _number(execution.get("price")) if execution else None
    bid = _number(execution.get("best_bid")) if execution else None
    ask = _number(execution.get("best_ask")) if execution else None
    lower = _number(execution.get("lower_circuit")) if execution else None
    upper = _number(execution.get("upper_circuit")) if execution else None
    entry = _number(row.get("entry"))
    target = _number(row.get("target"))
    updated = _parse(execution.get("updated_at")) if execution else None
    age_minutes = (now - updated.astimezone(timezone.utc)).total_seconds() / 60 if updated else float("inf")
    spread = ((ask - bid) / ((ask + bid) / 2)) * 100 if bid is not None and ask is not None and bid > 0 and ask >= bid else None
    lower_room = ((price / lower) - 1) * 100 if price is not None and lower is not None and lower > 0 else None
    verified, coverage_detail = _coverage(execution, today, required_from, required_through, now)
    sessions_to_results = _lag(today, execution["next_date"], holidays, specials) if execution and execution.get("next_date") else None
    blockers: list[str] = []
    metrics = row.get("metrics") or {}
    setup_variant = metrics.get("setup_variant")
    midway = setup_variant in (SETUP_STAGE2, SETUP_EP_REBOUND, SETUP_STAIR_STEP)
    day_two = metrics.get("early_breakout") is True or metrics.get("setup") == "DAY_TWO_STAIRCASE"
    if not midway and (row["status"] != "TREND_CONTINUATION_READY" or not row["ready"] or not day_two):
        blockers.append("Only a confirmed day-two entry can be bought.")
    if midway and row["status"] not in ("CONTINUATION_WATCH", "TREND_CONTINUATION_READY"):
        blockers.append("The EOD mid-way setup is no longer active.")
    if not raw.get("marketOpen"):
        blockers.append("Entry is available only during NSE market hours.")
    if not execution or execution.get("source") != "BREEZE_LIVE" or age_minutes < 0 or age_minutes > 5:
        blockers.append("A fresh Breeze quote is required.")
    if spread is None or spread > .75:
        blockers.append("Bid/ask spread is missing or above 0.75%.")
    if lower_room is None or lower_room <= 3 or upper is None or entry is None or entry > upper:
        blockers.append("Circuit-band execution room is not verified.")
    if price is None or entry is None or target is None or price < entry * .999 or price >= target:
        blockers.append("Live price is outside the frozen entry-to-target range.")
    if not verified:
        blockers.append(coverage_detail)
    if sessions_to_results is not None and sessions_to_results <= BLACKOUT_SESSIONS:
        blockers.append(f"Results are due within {BLACKOUT_SESSIONS} sessions.")
    computed = _parse(row["computed_at"])
    if computed is None or (now - computed.astimezone(timezone.utc)).total_seconds() > 5 * 60:
        blockers.append("The continuation calculation is stale; wait for the next scan.")

    # Mid-way variants carry their own breakout level and volume-pace requirement, on top
    # of every gate above rather than instead of any of them.
    pace = None
    if midway:
        live = raw.get("liveSession")
        minutes_elapsed = _number((live or {}).get("minutesElapsed"))
        pace = time_of_day_rvol(live, raw.get("volumeCurve"),
                                _number(raw.get("averageVolume20")), raw.get("market", "IN"))
        required = required_tod_rvol(setup_variant)
        if minutes_elapsed is None or minutes_elapsed < CONFIRMATION_MINUTE:
            blockers.append("Volume pace is read only after 10:15 IST.")
        elif pace is None:
            blockers.append("Intraday volume pace could not be measured against the session curve.")
        elif pace < required:
            blockers.append(
                f"Volume pace {pace:.1f}x is below the {required:.1f}x this setup requires.")
        confirmed, detail = breakout_confirmed(setup_variant, price, raw.get("breakoutLevels"))
        if not confirmed:
            blockers.append(detail)
    eligible = not blockers
    return {"executionEligible": eligible, "executionBlockers": blockers,
            "observationOnly": bool(blockers), "currentPrice": price, "todRvol": pace,
            # Status promotion is Python-owned. TypeScript maps this result; it does not
            # infer readiness from the gates a second time.
            "effectiveStatus": "TREND_CONTINUATION_READY" if eligible else row["status"],
            "effectiveReady": eligible}

