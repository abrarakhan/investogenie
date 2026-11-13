from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

BLACKOUT_SESSIONS = 3


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
    past = execution.get("last_past_date")
    if past and (today_dt - datetime.fromisoformat(past).replace(tzinfo=timezone.utc)).total_seconds() <= 70 * 86400:
        return True, f"Last results {past}; next is not due within the blackout."
    return False, "No upcoming or recent results date on file; the next release is unknown."


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
    day_two = metrics.get("early_breakout") is True or metrics.get("setup") == "DAY_TWO_STAIRCASE"
    if row["status"] != "TREND_CONTINUATION_READY" or not row["ready"] or not day_two:
        blockers.append("Only a confirmed day-two entry can be bought.")
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
    return {"executionEligible": not blockers, "executionBlockers": blockers,
            "observationOnly": bool(blockers), "currentPrice": price}

