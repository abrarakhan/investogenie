"""Deterministic Strong Swing first-touch labeler.

All monetary calculations use Decimal. The web application may orchestrate these
jobs and render their persisted output, but must not reimplement this policy.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import date
from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR
from enum import Enum
from typing import Iterable, Sequence


ZERO = Decimal("0")
ONE = Decimal("1")
TEN_THOUSAND = Decimal("10000")


class LabelOutcome(str, Enum):
    TARGET_FIRST = "TARGET_FIRST"
    STOP_FIRST = "STOP_FIRST"
    SAME_BAR_AMBIGUOUS = "SAME_BAR_AMBIGUOUS"
    WINDOW_EXPIRED = "WINDOW_EXPIRED"
    NOT_ENTERED = "NOT_ENTERED"
    INVALID_DATA = "INVALID_DATA"


@dataclass(frozen=True)
class Bar:
    session: date
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal


@dataclass(frozen=True)
class LabelingPolicy:
    label_version: str = "strong-swing-first-touch-v1"
    trailing_policy_version: str = "strong-swing-trailing-v1"
    entry_fill_policy_version: str = "strong-swing-entry-v1"
    calendar_version: str = "NSE-calendar-v1"
    break_even_r_multiple: Decimal = Decimal("0.75")
    maximum_entry_extension_atr: Decimal = Decimal("0.50")
    slippage_bps_per_side: Decimal = Decimal("10")
    charges_bps_round_trip: Decimal = Decimal("10")


@dataclass(frozen=True)
class LabelResult:
    outcome: LabelOutcome
    binary_target: int | None
    entry_session: date | None
    entry_price: Decimal | None
    exit_session: date | None
    exit_price: Decimal | None
    sessions_to_outcome: int | None
    realized_return: Decimal | None
    max_favorable_excursion: Decimal | None
    max_adverse_excursion: Decimal | None
    effective_stop_at_outcome: Decimal | None
    high_water_mark: Decimal | None
    invalid_reason: str | None
    label_version: str
    trailing_policy_version: str
    entry_fill_policy_version: str
    calendar_version: str

    def serializable(self) -> dict[str, object]:
        data = asdict(self)
        data["outcome"] = self.outcome.value
        for key, value in tuple(data.items()):
            if isinstance(value, Decimal):
                data[key] = format(value, "f")
            elif isinstance(value, date):
                data[key] = value.isoformat()
        return data


def _round_up(value: Decimal, tick: Decimal) -> Decimal:
    return (value / tick).to_integral_value(rounding=ROUND_CEILING) * tick


def _round_down(value: Decimal, tick: Decimal) -> Decimal:
    return (value / tick).to_integral_value(rounding=ROUND_FLOOR) * tick


def _net_return(entry: Decimal, exit_price: Decimal, policy: LabelingPolicy) -> Decimal:
    gross = exit_price / entry - ONE
    costs = (policy.slippage_bps_per_side * Decimal("2") + policy.charges_bps_round_trip) / TEN_THOUSAND
    return gross - costs


def _result(
    outcome: LabelOutcome,
    policy: LabelingPolicy,
    *,
    entry_session: date | None = None,
    entry_price: Decimal | None = None,
    exit_session: date | None = None,
    exit_price: Decimal | None = None,
    sessions: int | None = None,
    mfe: Decimal | None = None,
    mae: Decimal | None = None,
    stop: Decimal | None = None,
    high_water: Decimal | None = None,
    invalid_reason: str | None = None,
) -> LabelResult:
    binary = 1 if outcome == LabelOutcome.TARGET_FIRST else 0 if outcome in {
        LabelOutcome.STOP_FIRST,
        LabelOutcome.SAME_BAR_AMBIGUOUS,
        LabelOutcome.WINDOW_EXPIRED,
    } else None
    return LabelResult(
        outcome=outcome,
        binary_target=binary,
        entry_session=entry_session,
        entry_price=entry_price,
        exit_session=exit_session,
        exit_price=exit_price,
        sessions_to_outcome=sessions,
        realized_return=_net_return(entry_price, exit_price, policy) if entry_price and exit_price else None,
        max_favorable_excursion=mfe,
        max_adverse_excursion=mae,
        effective_stop_at_outcome=stop,
        high_water_mark=high_water,
        invalid_reason=invalid_reason,
        label_version=policy.label_version,
        trailing_policy_version=policy.trailing_policy_version,
        entry_fill_policy_version=policy.entry_fill_policy_version,
        calendar_version=policy.calendar_version,
    )


def _validate_bars(bars: Sequence[Bar], expected_sessions: Sequence[date]) -> str | None:
    if tuple(bar.session for bar in bars) != tuple(expected_sessions):
        return "expected trading session is absent or out of order"
    if len(set(expected_sessions)) != len(expected_sessions):
        return "duplicate expected trading session"
    for bar in bars:
        if min(bar.open, bar.high, bar.low, bar.close) <= ZERO:
            return f"non-positive OHLC value on {bar.session.isoformat()}"
        if bar.high < max(bar.open, bar.low, bar.close) or bar.low > min(bar.open, bar.high, bar.close):
            return f"invalid OHLC range on {bar.session.isoformat()}"
    return None


def label_candidate(
    bars: Iterable[Bar],
    *,
    expected_sessions: Sequence[date],
    confirmation_entry: Decimal,
    initial_stop: Decimal,
    target: Decimal,
    projected_trail: Decimal,
    trailing_distance: Decimal,
    atr: Decimal,
    holding_sessions: int,
    tick_size: Decimal,
    policy: LabelingPolicy = LabelingPolicy(),
) -> LabelResult:
    """Label one long candidate using frozen levels and next-bar stop updates."""
    rows = tuple(bars)
    invalid = _validate_bars(rows, expected_sessions)
    if invalid:
        return _result(LabelOutcome.INVALID_DATA, policy, invalid_reason=invalid)
    if holding_sessions <= 0 or tick_size <= ZERO or atr <= ZERO:
        return _result(LabelOutcome.INVALID_DATA, policy, invalid_reason="invalid policy inputs")
    entry = _round_up(confirmation_entry, tick_size)
    target = _round_up(target, tick_size)
    initial_stop = _round_down(initial_stop, tick_size)
    projected_trail = _round_down(projected_trail, tick_size)
    trailing_distance = _round_up(trailing_distance, tick_size)
    if not (initial_stop < entry < target) or trailing_distance <= ZERO:
        return _result(LabelOutcome.INVALID_DATA, policy, invalid_reason="invalid frozen levels")

    fill_session: date | None = None
    fill_price: Decimal | None = None
    effective_stop = max(initial_stop, projected_trail)
    high_water = entry
    mfe = ZERO
    mae = ZERO
    elapsed = 0

    for bar in rows:
        if fill_price is None:
            if bar.open >= entry:
                if bar.open - entry > policy.maximum_entry_extension_atr * atr:
                    continue
                fill_price = _round_up(bar.open, tick_size)
            elif bar.high >= entry:
                fill_price = entry
            else:
                continue
            fill_session = bar.session
            high_water = fill_price
            effective_stop = min(effective_stop, fill_price - tick_size)

        elapsed += 1
        assert fill_price is not None and fill_session is not None
        mfe = max(mfe, bar.high / fill_price - ONE)
        mae = min(mae, bar.low / fill_price - ONE)

        # Opening gaps have an observable execution order and take precedence.
        if elapsed > 1 and bar.open <= effective_stop:
            exit_price = _round_down(bar.open, tick_size)
            return _result(LabelOutcome.STOP_FIRST, policy, entry_session=fill_session,
                           entry_price=fill_price, exit_session=bar.session, exit_price=exit_price,
                           sessions=elapsed, mfe=mfe, mae=mae, stop=effective_stop,
                           high_water=high_water)
        if elapsed > 1 and bar.open >= target:
            exit_price = _round_down(bar.open, tick_size)
            return _result(LabelOutcome.TARGET_FIRST, policy, entry_session=fill_session,
                           entry_price=fill_price, exit_session=bar.session, exit_price=exit_price,
                           sessions=elapsed, mfe=mfe, mae=mae, stop=effective_stop,
                           high_water=high_water)

        stop_touched = bar.low <= effective_stop
        target_touched = bar.high >= target
        if stop_touched and target_touched:
            return _result(LabelOutcome.SAME_BAR_AMBIGUOUS, policy, entry_session=fill_session,
                           entry_price=fill_price, exit_session=bar.session, exit_price=effective_stop,
                           sessions=elapsed, mfe=mfe, mae=mae, stop=effective_stop,
                           high_water=high_water)
        if stop_touched:
            return _result(LabelOutcome.STOP_FIRST, policy, entry_session=fill_session,
                           entry_price=fill_price, exit_session=bar.session, exit_price=effective_stop,
                           sessions=elapsed, mfe=mfe, mae=mae, stop=effective_stop,
                           high_water=high_water)
        if target_touched:
            return _result(LabelOutcome.TARGET_FIRST, policy, entry_session=fill_session,
                           entry_price=fill_price, exit_session=bar.session, exit_price=target,
                           sessions=elapsed, mfe=mfe, mae=mae, stop=effective_stop,
                           high_water=high_water)

        # This bar can only affect the following bar's stop.
        high_water = max(high_water, bar.high)
        initial_risk = fill_price - initial_stop
        next_stop = max(initial_stop, projected_trail, high_water - trailing_distance)
        if high_water >= fill_price + policy.break_even_r_multiple * initial_risk:
            next_stop = max(next_stop, fill_price)
        effective_stop = _round_down(next_stop, tick_size)

        if elapsed >= holding_sessions:
            exit_price = _round_down(bar.close, tick_size)
            return _result(LabelOutcome.WINDOW_EXPIRED, policy, entry_session=fill_session,
                           entry_price=fill_price, exit_session=bar.session, exit_price=exit_price,
                           sessions=elapsed, mfe=mfe, mae=mae, stop=effective_stop,
                           high_water=high_water)

    if fill_price is None:
        return _result(LabelOutcome.NOT_ENTERED, policy)
    return _result(LabelOutcome.INVALID_DATA, policy, entry_session=fill_session,
                   entry_price=fill_price, sessions=elapsed, mfe=mfe, mae=mae,
                   stop=effective_stop, high_water=high_water,
                   invalid_reason="holding window extends beyond supplied sessions")
