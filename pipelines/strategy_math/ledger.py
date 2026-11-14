"""Swing trade ledger projection and XIRR — server-authoritative, Decimal-native.

Ported from lib/swingTradeLedger.ts (calculateXirr, summarizeSwingTradeLedger) with the same
algorithm, bracketing and tolerance. What changes is the arithmetic substrate: money and the
solver run in decimal.Decimal instead of IEEE-754 binary floats, so repeated accumulation across
partial fills, scale-outs and broker reconciliations cannot drift a paisa at a time.

Why not scipy.optimize: it solves in float64. Routing Decimal cash flows through it converts
down to binary float and back, reintroducing exactly the drift this module exists to remove —
and it would add a heavy dependency that the deployment does not currently carry. The existing
bisection is reproduced in Decimal instead, which is both dependency-free and more precise than
the float version it replaces.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timezone
import math
from decimal import Decimal, getcontext, localcontext
from typing import Any

# Wide enough that intermediate products in the NPV sum never lose paise, and that ln/exp in
# the discount factor stay well clear of the 1e-6 convergence tolerance.
getcontext().prec = 40

ZERO = Decimal(0)
ONE = Decimal(1)
DAYS_PER_YEAR = Decimal(365)
ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# Matches the TypeScript solver exactly, so a difference in output is a difference in precision
# and never a difference in method.
XIRR_LOW = Decimal("-0.9999")
XIRR_HIGH = Decimal(10)
XIRR_MAX_BRACKET = Decimal(1_000_000)
XIRR_TOLERANCE = Decimal("0.000001")
XIRR_ITERATIONS = 200


def money(value: Any) -> Decimal:
    """Decimal from a JSON number without going through binary float."""
    if value is None:
        return ZERO
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def _as_float(value: Decimal | None) -> float | None:
    return None if value is None else float(value)


def _day_index(iso: str) -> int:
    return date(int(iso[0:4]), int(iso[5:7]), int(iso[8:10])).toordinal()


def _pow(base: Decimal, exponent: Decimal) -> Decimal:
    """base ** exponent for fractional exponents, in Decimal rather than float."""
    if base <= 0:
        raise ValueError("non-positive base")
    if exponent == 0:
        return ONE
    return (exponent * base.ln()).exp()


def calculate_xirr(cash_flows: list[dict[str, Any]]) -> Decimal | None:
    flows = [
        (str(flow["date"])[:10], money(flow["amount"]))
        for flow in cash_flows
        if flow.get("date") and ISO_DATE.match(str(flow["date"])[:10])
    ]
    if not any(amount < 0 for _, amount in flows) or not any(amount > 0 for _, amount in flows):
        return None

    first = min(_day_index(iso) for iso, _ in flows)
    offsets = [(Decimal(_day_index(iso) - first) / DAYS_PER_YEAR, amount) for iso, amount in flows]

    def npv(rate: Decimal) -> Decimal | None:
        factor_base = ONE + rate
        if factor_base <= 0:
            return None
        total = ZERO
        for years, amount in offsets:
            try:
                total += amount / _pow(factor_base, years)
            except (ValueError, ArithmeticError):
                return None
        return total

    with localcontext() as context:
        context.prec = 40
        low, high = XIRR_LOW, XIRR_HIGH
        low_value, high_value = npv(low), npv(high)
        # Widen the bracket the same way the TypeScript solver does.
        while (low_value is not None and high_value is not None
               and low_value * high_value > 0 and high < XIRR_MAX_BRACKET):
            high *= 10
            high_value = npv(high)
        if low_value is None or high_value is None or low_value * high_value > 0:
            return None
        for _ in range(XIRR_ITERATIONS):
            mid = (low + high) / 2
            value = npv(mid)
            if value is None:
                return None
            if abs(value) < XIRR_TOLERANCE:
                return mid * 100
            if low_value * value <= 0:
                high, high_value = mid, value
            else:
                low, low_value = mid, value
        return ((low + high) / 2) * 100


def summarize(payload: dict[str, Any]) -> dict[str, Any]:
    """Ledger roll-up: exposure, realised/unrealised P&L, capital employed, ROI and XIRR."""
    trades: list[dict[str, Any]] = payload.get("trades") or []
    as_of = str(payload.get("asOf") or "")[:10]

    open_count = closed_count = 0
    open_invested = unrealized = realized = overall = total_invested = current_open = ZERO
    events: list[tuple[str, int, Decimal]] = []

    for trade in trades:
        progress = trade.get("progress") or {}
        invested_value = money(progress.get("investedValue"))
        progress_pnl = money(progress.get("pnlValue"))
        purchase_value = money(trade["purchaseValue"]) if trade.get("purchaseValue") is not None else invested_value
        quantity = money(trade.get("quantity"))
        short = trade.get("direction") == "SHORT"
        is_open = trade.get("status") == "OPEN"
        remaining_quantity = (money(trade["remainingQuantity"]) if trade.get("remainingQuantity") is not None
                              else (quantity if is_open else ZERO))
        remaining_cost = (purchase_value * (remaining_quantity / quantity)) if quantity > 0 else invested_value

        current_price = trade.get("currentPrice")
        if is_open and current_price is not None:
            mark_value = money(current_price) * remaining_quantity
            current_open_value = (remaining_cost + (remaining_cost - mark_value)) if short else mark_value
        elif is_open:
            current_open_value = remaining_cost + progress_pnl
        else:
            current_open_value = ZERO

        unrealized_pnl = (current_open_value - remaining_cost) if is_open else ZERO
        if trade.get("realizedPnlValue") is not None:
            realized_pnl = money(trade["realizedPnlValue"])
        else:
            realized_pnl = progress_pnl if trade.get("status") == "CLOSED" else ZERO

        if trade.get("boughtOn"):
            events.append((str(trade["boughtOn"])[:10], 0, -purchase_value))
        exits = trade.get("exits") or []
        for exit_row in exits:
            events.append((str(exit_row["soldOn"])[:10], 1, money(exit_row.get("saleValue"))))
        if (not exits and trade.get("status") == "CLOSED" and trade.get("closedOn")
                and trade.get("exitPrice") and quantity > 0):
            events.append((str(trade["closedOn"])[:10], 1, money(trade["exitPrice"]) * quantity))

        if is_open:
            open_count += 1
            open_invested += remaining_cost
            current_open += current_open_value
            unrealized += unrealized_pnl
        else:
            closed_count += 1
        realized += realized_pnl
        overall += unrealized_pnl + realized_pnl
        total_invested += purchase_value

    # Capital recycling: only cash the book did not already hold counts as fresh capital.
    capital_flows: list[dict[str, Any]] = []
    capital_employed = ZERO
    retained = ZERO
    for iso, _order, amount in sorted(events, key=lambda item: (item[0], item[1])):
        retained += amount
        if retained < 0:
            contribution = -retained
            capital_employed += contribution
            capital_flows.append({"date": iso, "amount": -contribution})
            retained = ZERO

    if capital_flows:
        if any(trade.get("status") == "OPEN" for trade in trades):
            terminal_date = as_of
        else:
            terminal_date = max((iso for iso, _, _ in events), default=as_of)
        capital_flows.append({"date": terminal_date, "amount": retained + current_open})
    else:
        capital_employed = total_invested

    roi = (overall / capital_employed * 100) if capital_employed > 0 else None
    xirr = calculate_xirr(capital_flows)

    return {
        "openCount": open_count,
        "closedCount": closed_count,
        "openInvestedValue": float(open_invested),
        "unrealizedPnlValue": float(unrealized),
        "realizedPnlValue": float(realized),
        "overallPnlValue": float(overall),
        "totalInvestedValue": float(total_invested),
        "capitalEmployedValue": float(capital_employed),
        "currentOpenValue": float(current_open),
        "roiPct": _as_float(roi),
        "xirrPct": _as_float(xirr),
    }


def assess(payload: dict[str, Any]) -> dict[str, Any]:
    """Worker entry point."""
    return summarize(payload)


# --- Per-trade projection ----------------------------------------------------------------
# Ported from calculateRecommendedGttStop / tradingDaysBetween / calculateSwingTradeProgress.
# The trading calendar is supplied by the caller rather than rebuilt here: TypeScript refreshes
# NSE holidays at runtime, so Python must use that same resolved set or the two would disagree
# about how many sessions a trade has been held.

def _iso_ordinal(iso: str) -> int:
    return date(int(iso[0:4]), int(iso[5:7]), int(iso[8:10])).toordinal()


def _is_trading_day(iso: str, holidays: set[str], special: set[str]) -> bool:
    if iso in special:
        return True
    weekday = date.fromordinal(_iso_ordinal(iso)).weekday()  # Mon=0 .. Sun=6
    return weekday < 5 and iso not in holidays


def trading_days_between(start_iso: str, end_iso: str, holidays: set[str], special: set[str]) -> int:
    start, end = _iso_ordinal(start_iso[:10]), _iso_ordinal(end_iso[:10])
    if end <= start:
        return 0
    count = 0
    for ordinal in range(start + 1, end + 1):
        if _is_trading_day(date.fromordinal(ordinal).isoformat(), holidays, special):
            count += 1
    return count


def recommended_gtt_stop(payload: dict[str, Any]) -> dict[str, Any]:
    buy_price = money(payload["buyPrice"])
    projected_stop = money(payload["projectedStop"])
    projected_trailing = payload.get("projectedTrailingStop")
    trailing_distance = payload.get("trailingDistance")
    current_price = payload.get("currentPrice")
    next_bar = bool(payload.get("postEntryNextBarPolicy"))
    trailing_stop = money(projected_trailing) if projected_trailing is not None else projected_stop

    if payload.get("direction") == "SHORT":
        observed_low = buy_price if next_bar else min(buy_price, money(current_price) if current_price is not None else buy_price)
        initial_risk = max(ZERO, projected_stop - buy_price)
        break_even = initial_risk > 0 and observed_low <= buy_price - (Decimal("0.75") * initial_risk)
        chandelier = projected_stop if trailing_distance is None else observed_low + money(trailing_distance)
        recommended=min(projected_stop, trailing_stop, chandelier, buy_price if break_even else projected_stop)
        recorded=money(payload.get("recordedGttStop") if payload.get("recordedGttStop") is not None else projected_stop)
        return {"recommendedStop":float(recommended),"breakEvenActivated":break_even,
                "effectiveTrailingStop":float(min(recommended,recorded)),
                "gttUpdateRequired":payload.get("status")=="OPEN" and recommended<recorded-Decimal("0.005")}

    post_entry_high = payload.get("postEntryCompletedHigh")
    highest_high = payload.get("highestHigh")
    if next_bar:
        observed_high = max(buy_price, money(post_entry_high) if post_entry_high is not None else buy_price)
    else:
        observed_high = max(buy_price,
                            money(highest_high) if highest_high is not None else buy_price,
                            money(current_price) if current_price is not None else buy_price)
    initial_risk = max(ZERO, buy_price - projected_stop)
    break_even = initial_risk > 0 and observed_high >= buy_price + (Decimal("0.75") * initial_risk)
    chandelier = projected_stop if trailing_distance is None else observed_high - money(trailing_distance)
    recommended=max(projected_stop, trailing_stop, chandelier,buy_price if break_even else projected_stop)
    recorded=money(payload.get("recordedGttStop") if payload.get("recordedGttStop") is not None else projected_stop)
    return {"recommendedStop":float(recommended),"breakEvenActivated":break_even,
            "effectiveTrailingStop":float(max(recommended,recorded)),
            "gttUpdateRequired":payload.get("status")=="OPEN" and recommended>recorded+Decimal("0.005")}


def swing_trade_progress(payload: dict[str, Any], holidays: set[str], special: set[str]) -> dict[str, Any]:
    # An open trade carries no asOf; TypeScript used "now" for it. The caller normally supplies
    # the date so both runtimes agree on one value, but fall back rather than crash on "".
    today = str(payload.get("asOf") or "")[:10] or date.today().isoformat()
    bought_on = str(payload["boughtOn"])[:10]
    days_held = trading_days_between(bought_on, today, holidays, special)
    calendar_days = max(0, _iso_ordinal(today) - _iso_ordinal(bought_on))

    status = payload.get("status")
    current_price = payload.get("currentPrice")
    exit_price = payload.get("exitPrice")
    raw_mark = (exit_price if exit_price is not None else current_price) if status == "CLOSED" else current_price
    mark = None if raw_mark is None else money(raw_mark)

    buy_price = money(payload["buyPrice"])
    quantity = money(payload["quantity"])
    target = money(payload["target"])
    stop = money(payload["stop"])
    trailing_stop = payload.get("trailingStop")
    expected_days = int(payload["expectedDays"])
    direction = str(payload.get("direction") or "LONG")
    short = direction == "SHORT"

    invested = buy_price * quantity
    current_value = None if mark is None else mark * quantity
    pnl_value = None if mark is None else ((buy_price - mark) if short else (mark - buy_price)) * quantity
    pnl_pct = None if mark is None else (((buy_price - mark) / buy_price) if short else ((mark / buy_price) - ONE)) * 100
    target_distance = (buy_price - target) if short else (target - buy_price)
    target_progress = None if (mark is None or target_distance <= 0) else (
        ((buy_price - mark) / target_distance) if short else ((mark - buy_price) / target_distance)
    ) * 100
    remaining_upside = None if mark is None else (
        ((mark / target) - ONE) if short else ((target / mark) - ONE)
    ) * 100

    if status == "CLOSED":
        state = "CLOSED"
    elif mark is None:
        state = "NO_QUOTE"
    elif (mark <= target if short else mark >= target):
        state = "TARGET_REACHED"
    elif (mark >= stop if short else mark <= stop):
        state = "STOP_BREACHED"
    elif trailing_stop is not None and (mark >= money(trailing_stop) if short else mark <= money(trailing_stop)):
        state = "TRAIL_BREACHED"
    elif days_held > expected_days:
        state = "WINDOW_EXPIRED"
    else:
        state = "ON_TRACK"

    return {
        "daysHeld": days_held,
        "calendarDaysHeld": calendar_days,
        "daysRemaining": max(0, expected_days - days_held),
        "currentValue": _as_float(current_value),
        "investedValue": float(invested),
        "pnlValue": _as_float(pnl_value),
        "pnlPct": _as_float(pnl_pct),
        "targetProgressPct": _as_float(target_progress),
        "remainingUpsidePct": _as_float(remaining_upside),
        "state": state,
    }


def assess_trades(payload: dict[str, Any]) -> dict[str, Any]:
    """One trade's projection: GTT protection plus held/P&L progress."""
    holidays = set(payload.get("holidays") or [])
    special = set(payload.get("specialSessions") or [])
    return {
        "gtt": recommended_gtt_stop(payload["gtt"]),
        "progress": swing_trade_progress(payload["progress"], holidays, special),
    }


def assess_gtt(payload: dict[str, Any]) -> dict[str, Any]:
    """Batch entry point for GTT protection alone (phase one of the ledger build)."""
    return recommended_gtt_stop(payload)


def assess_progress(payload: dict[str, Any]) -> dict[str, Any]:
    """Batch entry point for held/P&L progress alone (phase two of the ledger build)."""
    return swing_trade_progress(
        payload,
        set(payload.get("holidays") or []),
        set(payload.get("specialSessions") or []),
    )


def _mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else math.nan


def _ema(values: list[float], period: int) -> float | None:
    if not values:
        return None
    factor = 2 / (period + 1); value = values[0]
    for current in values[1:]: value = current * factor + value * (1 - factor)
    return value


def _darvas_bottom(bars: list[dict[str, Any]], tick: float) -> float | None:
    best = None; top = 0
    for i in range(len(bars)):
        if float(bars[i]["high"]) > float(bars[top]["high"]): top = i
        if i - top < 3: continue
        running = math.inf
        for j in range(top + 1, i - 2):
            low = float(bars[j]["low"])
            if low >= running: continue
            running = low
            if all(float(bars[j+k]["low"]) >= low for k in (1,2,3)):
                stop = math.floor((low - tick) / tick + 1e-9) * tick
                best = stop if best is None else max(best, stop); break
    return best


def strategy_follow_up(payload: dict[str, Any]) -> dict[str, Any]:
    bars = payload.get("bars") or []; none = {"line": None, "lineLabel": None, "target": None, "closeExitConfirmed": False}
    frozen = payload.get("frozenTarget"); buy = payload.get("buyPrice")
    def finish(value: dict[str, Any]) -> dict[str, Any]:
        moving=value.get("target");effective=frozen
        if moving is not None and buy is not None:
            if payload.get("direction")=="SHORT" and float(moving)<float(buy):effective=max(float(frozen),float(moving))
            elif payload.get("direction")!="SHORT" and float(moving)>float(buy):effective=min(float(frozen),float(moving))
        return {**value,"effectiveTarget":effective}
    if not bars: return finish(none)
    key, direction = str(payload.get("strategyKey")), str(payload.get("direction") or "LONG")
    closes = [float(bar["close"]) for bar in bars]; line = None; label = None; target = None
    if key == "QULLAMAGGIE" and len(closes) >= 10: line, label = _ema(closes, 10), "10-day EMA"
    elif key == "MINERVINI" and len(closes) >= 50: line, label = _mean(closes[-50:]), "50-day average"
    elif key == "PTJ" and len(closes) >= 200: line, label = _mean(closes[-200:]), "200-day average"
    elif key == "DARVAS":
        after = [bar for bar in bars if str(bar["date"])[:10] > str(payload.get("boughtOn") or "")[:10]]
        line, label = _darvas_bottom(after, float(payload.get("tick") or .01)), "bottom of the latest box"
    elif key == "SIMONS" and len(closes) >= 20: target = math.floor(_mean(closes[-20:]) * 100 + .5) / 100
    if line is None: return finish({**none, "target": target})
    line = round(float(line), 2)
    confirmed = closes[-1] < line if direction == "LONG" else closes[-1] > line
    return finish({"line": line, "lineLabel": label, "target": None, "closeExitConfirmed": confirmed})


def _news_score(technical: float, impacts: list[dict[str, Any]], now_iso: str) -> dict[str, Any]:
    score = max(0, min(100, technical * 100 if technical <= 1 else technical)); weighted = 0.0; veto = False
    now = datetime.fromisoformat(now_iso.replace("Z", "+00:00"))
    for impact in impacts:
        published = datetime.fromisoformat(str(impact["publishedAt"]).replace("Z", "+00:00"))
        hours = (now - published).total_seconds() / 3600
        decay = 1 if hours < 0 else 0 if hours >= 168 else .5 ** (hours / 24)
        direction = 1 if impact["direction"] == "POSITIVE" else -1 if impact["direction"] == "NEGATIVE" else 0
        scope = 1 if impact["scope"] == "ASSET" else .75 if impact["scope"] == "SECTOR" else .6
        sentiment=max(-1,min(1,float(impact["sentimentScore"])));confidence=max(0,min(1,float(impact["confidence"])));severity=max(0,min(1,float(impact["severity"])))
        weighted += direction * abs(sentiment) * confidence * severity * decay * scope * 20
        veto = veto or (impact["direction"]=="NEGATIVE" and sentiment<=-.65 and confidence>=.7 and severity>=.8 and decay>=.35)
    adjustment=round(max(-20,min(20,weighted))*10)/10; combined=round(max(0,min(100,score+adjustment))*10)/10
    state="RISK_OFF" if veto else "FAVORED" if adjustment>=4 else "CAUTION" if adjustment<=-4 else "NEUTRAL"
    return {"technicalScore":score,"newsAdjustment":adjustment,"combinedScore":combined,"state":state}


def risk_assessment(payload: dict[str, Any]) -> dict[str, Any]:
    state="NORMAL"; reasons=[]; trade_state=payload["tradeState"]
    if trade_state in ("STOP_BREACHED","TRAIL_BREACHED"):
        state="RISK_OFF";reasons.append("The current quote has breached the frozen stop-loss plan." if trade_state=="STOP_BREACHED" else "The current quote has breached the effective trailing stop.")
    elif trade_state=="TARGET_REACHED":state="RISK_OFF";reasons.append("The recorded strategy target has been reached; protect or realize the planned gain.")
    elif trade_state=="WINDOW_EXPIRED" and payload.get("pnlPct") is not None and payload["pnlPct"]>0:state="CAUTION";reasons.append("The planned holding window has ended with the position above entry; it is now managed on the revised plan.")
    elif trade_state=="WINDOW_EXPIRED":state="RISK_OFF";reasons.append("The recorded strategy holding window has expired without reaching its target.")
    elif trade_state=="NO_QUOTE":state="CAUTION";reasons.append("No current quote is available, so the trade cannot be assessed reliably.")
    asset_news,news=payload["assetNewsScore"],payload["newsScore"]
    if asset_news["state"]=="RISK_OFF" and payload.get("assetNewsVerified"):state="RISK_OFF";reasons.append("A recent severe, high-confidence event specific to this stock triggered the News & AI risk-off veto.")
    elif asset_news["state"]=="RISK_OFF" and state!="RISK_OFF":state="CAUTION";reasons.append("Severe stock-specific news is not yet independently verified; monitor it, but do not exit on this evidence alone.")
    elif news["state"]=="RISK_OFF" and state!="RISK_OFF":state="CAUTION";reasons.append("Broad-market news is adverse; the stock-specific exit veto has not triggered.")
    elif news["state"]=="CAUTION" and state!="RISK_OFF":state="CAUTION";reasons.append(f"Recent news reduced the trade score by {abs(news['newsAdjustment']):.1f} points.")
    def adverse(value):
        if value is None:return None
        return -float(value) if payload.get("direction")=="SHORT" else float(value)
    market1=payload.get("marketMove1dPct");market2=payload.get("marketMove2dPct");stock1=adverse(payload.get("stockMove1dPct"));stock2=adverse(payload.get("stockMove2dPct"))
    if market1 is not None and market1<=-2.5:state="RISK_OFF";reasons.append(f"The market benchmark is down {abs(market1):.2f}% in the current session.")
    elif market1 is not None and market1<=-1.5 and state=="NORMAL":state="CAUTION";reasons.append(f"The market benchmark is down {abs(market1):.2f}% in the current session.")
    if market2 is not None and market2<=-3.5:state="RISK_OFF";reasons.append(f"The market benchmark has fallen {abs(market2):.2f}% over two sessions.")
    elif market2 is not None and market2<=-2 and state=="NORMAL":state="CAUTION";reasons.append(f"The market benchmark has fallen {abs(market2):.2f}% over two sessions.")
    if stock1 is not None and stock1<=-4.5 and payload.get("pnlPct") is not None and payload["pnlPct"]<=-2:state="RISK_OFF";reasons.append(f"The stock moved {abs(stock1):.2f}% against the position in the latest session while the trade is below entry.")
    elif stock1 is not None and stock1<=-3 and state=="NORMAL":state="CAUTION";reasons.append(f"The stock moved {abs(stock1):.2f}% against the position in the latest session.")
    if stock2 is not None and stock2<=-8:state="RISK_OFF";reasons.append(f"The stock has moved {abs(stock2):.2f}% against the position over two sessions.")
    elif stock2 is not None and stock2<=-5 and state=="NORMAL":state="CAUTION";reasons.append(f"The stock has moved {abs(stock2):.2f}% against the position over two sessions.")
    distance=payload.get("distanceToStopPct")
    if distance is not None and 0<=distance<=1.5 and state=="NORMAL":state="CAUTION";reasons.append(f"The quote is only {distance:.2f}% from the frozen stop.")
    if payload.get("pnlPct") is not None and payload["pnlPct"]<=-2 and state=="NORMAL":state="CAUTION";reasons.append(f"The open trade is down {abs(payload['pnlPct']):.2f}% from its recorded buy price.")
    return {"state":state,"recommendation":"EXIT" if state=="RISK_OFF" else "STAY_CAUTION" if state=="CAUTION" or not payload.get("newsFresh") else "STAY",
            "reasons":reasons,"coverageWarning":None if payload.get("newsFresh") else "Current news coverage is unavailable or stale. Configure a deployment news API key for scheduled AI reassessment."}


def revise_plan(payload: dict[str, Any], assessment: dict[str, Any]) -> dict[str, Any]:
    direction=payload.get("direction") or "LONG";short=direction=="SHORT";current=payload.get("currentPrice")
    stop=float(payload["effectiveTrailingStop"] if payload.get("effectiveTrailingStop") is not None else payload["originalStop"])
    extreme=payload.get("highestHighSinceEntry") if short else payload.get("lowestLowSinceEntry")
    breached=extreme is not None and (float(extreme)>=float(payload["originalStop"]) if short else float(extreme)<=float(payload["originalStop"]))
    def response(action,label,target=None,reasons=None):
        remaining=None if target is None or current is None else (((float(current)/target)-1)*100 if short else ((target/float(current))-1)*100)
        return {"action":action,"label":label,"revisedTarget":target,"historicalTarget":payload.get("historicalTarget") if action=="PROTECT_RECOVERY" else None,
                "historicalSampleSize":payload.get("historicalSampleSize",0) if action=="PROTECT_RECOVERY" else 0,"historicalHorizon":payload.get("historicalHorizon",0) if action=="PROTECT_RECOVERY" else 0,
                "protectiveStop":None if action=="UNAVAILABLE" else stop,"remainingUpsidePct":remaining,"originalPlanBreached":breached,"atUpperCircuit":False,"reasons":reasons or []}
    if payload["status"]=="CLOSED" or current is None or current<=0 or payload["remainingQuantity"]<=0:return response("UNAVAILABLE","No open position",reasons=["A revised plan is shown only for an open position with a current quote."])
    stopped=float(current)>=stop if short else float(current)<=stop
    if stopped:return response("EXIT","Exit condition active",reasons=["The current quote is at or beyond the effective protective stop."])
    external=assessment["recommendation"]=="EXIT" and any(not r.startswith("The recorded strategy target has been reached") for r in assessment["reasons"])
    if external:return response("EXIT","Exit risk remains active",reasons=[r for r in assessment["reasons"] if not r.startswith("The recorded strategy target has been reached")])
    profitable=float(current)<payload["buyPrice"] if short else float(current)>payload["buyPrice"]
    target_reached=float(current)<=payload["originalTarget"] if short else float(current)>=payload["originalTarget"]
    expired=bool(payload.get("holdingWindowExpired")) and not target_reached
    if breached or expired:return response("PROTECT_RECOVERY","Held beyond the original plan" if profitable else "Recovery objectives",payload.get("recoveryTarget"),["The original plan was breached or expired; recovery objectives are advisory."])
    move1=float(payload.get("stockMove1dPct") or 0);move2=float(payload.get("stockMove2dPct") or 0);momentum=(move1<0 and move2<0) if short else (move1>0 and move2>0)
    atr_value=payload.get("atr")
    if target_reached and momentum and atr_value is not None and float(atr_value)>0:
        anchor=min(float(current),payload["originalTarget"],payload.get("lowestLowSinceEntry") or float(current)) if short else max(float(current),payload["originalTarget"],payload.get("highestHighSinceEntry") or 0)
        raw_target=anchor-float(atr_value) if short else anchor+float(atr_value)
        target=math.floor(raw_target*100+.5)/100
        return response("EXTEND_RUNNER","Trail remaining runner",target,["The original target has been reached and movement remains favorable; the objective extends by one ATR."])
    if target_reached:return response("PROTECT_PROFIT","Protect achieved profit",reasons=["The frozen target has been reached; protect or realize the planned gain."])
    return response("FOLLOW_ORIGINAL","Original plan remains active",payload["originalTarget"],["No stop breach or completed target is detected; continue measuring against the frozen target and effective trail."])


def assess_overlay(payload: dict[str, Any]) -> dict[str, Any]:
    current=payload.get("currentPrice");prior=payload.get("priorClose");prior2=payload.get("twoSessionClose")
    move1=((float(current)/float(prior))-1)*100 if current is not None and prior is not None and float(prior)>0 else None
    move2=((float(current)/float(prior2))-1)*100 if current is not None and prior2 is not None and float(prior2)>0 else None
    payload={**payload,"stockMove1dPct":move1,"stockMove2dPct":move2}
    now=payload.get("now") or datetime.now(timezone.utc).isoformat();impacts=payload.get("impacts") or []
    news=_news_score(float(payload.get("technicalScore") or 50),impacts,now);asset=[i for i in impacts if i.get("scope")=="ASSET"]
    asset_news=_news_score(float(payload.get("technicalScore") or 50),asset,now)
    risk=risk_assessment({**payload,"newsScore":news,"assetNewsScore":asset_news,"assetNewsVerified":any(bool(i.get("verified")) for i in asset)})
    revision=revise_plan(payload,risk)
    return {"risk":risk,"revision":revision,"newsAdjustment":news["newsAdjustment"],
            "stockMove1dPct":move1,"stockMove2dPct":move2}


def assess_news(payload: dict[str, Any]) -> dict[str, Any]:
    return _news_score(float(payload.get("technicalScore") or 0), payload.get("impacts") or [],
                       payload.get("now") or datetime.now(timezone.utc).isoformat())
