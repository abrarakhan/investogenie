"""Python authority for Base Swing discovery and the five named strategy tags.

The formulas are a direct port of swingClassifier.ts, candidateRanking.ts and
legendaryStrategies.ts.  TypeScript supplies raw chronological bars and cross-sectional
percentiles, then persists this module's serialisable result without recomputing it.
"""
from __future__ import annotations

import math
from typing import Any

from strategy_math.common import Bar, js_round, mean, round2

POLICY = "swing-python-v1-2026-11-14"
LEGENDARY_POLICY = "legendary-v2-2026-11-14"


def std(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    m = mean(values)
    return math.sqrt(sum((v - m) ** 2 for v in values) / (len(values) - 1))


def sma_at(values: list[float], period: int, end: int | None = None) -> float:
    end = len(values) - 1 if end is None else end
    start = end - period + 1
    return math.nan if start < 0 else mean(values[start:end + 1])


def ema_series(values: list[float], period: int) -> list[float]:
    if not values:
        return []
    k = 2 / (period + 1)
    out = [values[0]]
    for value in values[1:]:
        out.append(value * k + out[-1] * (1 - k))
    return out


def atr(bars: list[Bar], period: int = 14) -> float:
    values = []
    for index in range(max(1, len(bars) - period), len(bars)):
        previous = bars[index - 1].close
        values.append(max(bars[index].high - bars[index].low,
                          abs(bars[index].high - previous), abs(bars[index].low - previous)))
    return mean(values) if values else 0.0


def pct_change(old: float, new: float) -> float:
    return 0.0 if old == 0 or not math.isfinite(old) else (new - old) / abs(old)


def derive_levels(setup: dict[str, float], direction: str, risk: dict[str, float]) -> dict[str, Any]:
    a, current, velocity = setup["atr"], setup["currentPrice"], setup["dailyVelocity"]
    if direction == "SHORT":
        entry = round2(min(setup["shortTrigger"], current))
        stop = round2(entry + risk["stopAtrMult"] * a)
        unit = stop - entry
        target = round2(max(0, entry - risk["targetRR"] * unit))
        trail = round2(min(setup["ll22"], current) + risk["trailAtrMult"] * a)
    else:
        entry = round2(max(setup["longTrigger"], current))
        stop = round2(max(0, entry - risk["stopAtrMult"] * a))
        unit = entry - stop
        target = round2(entry + risk["targetRR"] * unit)
        trail = round2(max(0, max(setup["hh22"], current) - risk["trailAtrMult"] * a))
    distance = abs(target - entry)
    days = min(60, max(1, js_round(distance / velocity))) if velocity > 0 else 0
    return {"direction": direction, "currentPrice": round2(current), "entry": entry, "target": target,
            "stopLoss": stop, "trailingStop": trail, "atr": round2(a),
            "riskRewardRatio": round2(distance / unit) if unit > 0 else 0, "expectedDays": days}


def classify(bars: list[Bar]) -> dict[str, Any]:
    if len(bars) < 21:
        raise ValueError("Base Swing requires at least 21 bars")
    closes, highs, lows, volumes = ([getattr(b, key) for b in bars] for key in ("close", "high", "low", "volume"))
    last = bars[-1]
    bb = closes[-20:]
    middle, deviation = mean(bb), std(bb)
    upper, lower = middle + 2 * deviation, middle - 2 * deviation
    bandwidth = 0 if middle == 0 else (upper - lower) / middle
    widths = []
    for end in range(20, len(closes) + 1):
        window = closes[end - 20:end]
        m, sd = mean(window), std(window)
        widths.append(0 if m == 0 else (4 * sd) / m)
    squeeze = (sum(1 for value in widths[:-1] if value <= bandwidth) / len(widths[:-1]) if len(widths) > 1 else 1) <= .25
    donchian_high, donchian_low = max(highs[-21:-1]), min(lows[-21:-1])
    breakout, breakdown = last.close > donchian_high or last.close > upper, last.close < donchian_low or last.close < lower
    ago = bars[-6]
    price_change = pct_change(ago.close, last.close)
    has_oi = last.open_interest is not None and ago.open_interest is not None
    oi_change = pct_change(float(ago.open_interest), float(last.open_interest)) if has_oi else 0
    recent, preceding = volumes[-5:], volumes[-25:-5]
    participation = mean(recent) / mean(preceding) if preceding and mean(preceding) > 0 else 0
    long_build = price_change > 0 and (oi_change >= .05 if has_oi else participation >= 1.2)
    short_build = price_change < 0 and (oi_change >= .05 if has_oi else participation >= 1.2)
    base_volume = mean(volumes[-21:-1])
    expansion = last.volume / base_volume if base_volume else 0
    volume_ok = expansion >= 1.5
    long_score = (.35 if breakout else 0) + (.25 if squeeze else 0) + (.3 if long_build else 0) + (.1 if volume_ok and (breakout or squeeze) else 0)
    short_score = (.35 if breakdown else 0) + (.25 if squeeze else 0) + (.3 if short_build else 0) + (.1 if volume_ok and (breakdown or squeeze) else 0)
    long_verdict = "LONG_BREAKOUT" if breakout and long_build else "COILED_SPRING" if squeeze and long_build else "BREAKOUT_UNCONFIRMED" if breakout else "NO_SETUP"
    short_verdict = "SHORT_BREAKDOWN" if breakdown and short_build else "SHORT_COILED_SPRING" if squeeze and short_build else "BREAKDOWN_UNCONFIRMED" if breakdown else "NO_SETUP"
    if long_verdict == short_verdict == "NO_SETUP":
        bias, verdict, score, reason = "NONE", "NO_SETUP", max(long_score, short_score), "No structural trigger on the latest bar."
    elif short_verdict != "NO_SETUP" and short_score > long_score:
        bias, verdict, score = "SHORT", short_verdict, min(1, short_score)
        reason = f"Price {last.close:.2f} broke Donchian low {donchian_low:.2f} / lower band {lower:.2f}"
    else:
        bias, verdict, score = "LONG", long_verdict, min(1, long_score)
        reason = f"Price {last.close:.2f} cleared Donchian high {donchian_high:.2f} / upper band {upper:.2f}"
    recent_closes = closes[-21:]
    velocity = mean([abs(recent_closes[i] - recent_closes[i - 1]) for i in range(1, len(recent_closes))])
    setup = {"currentPrice": last.close, "atr": atr(bars), "longTrigger": max(donchian_high, upper),
             "shortTrigger": min(donchian_low, lower), "hh22": max(highs[-22:]), "ll22": min(lows[-22:]),
             "dailyVelocity": velocity}
    return {"verdict": verdict, "bias": bias, "score": score, "asOf": last.date, "close": last.close,
            "bollinger": {"upper": upper, "lower": lower, "middle": middle, "bandwidth": bandwidth},
            "isSqueeze": squeeze, "isBreakout": breakout, "isBreakdown": breakdown,
            "donchianHigh": donchian_high, "donchianLow": donchian_low, "priceChangePct": price_change,
            "oiChangePct": oi_change, "isLongBuildup": long_build, "isShortBuildup": short_build,
            "buildupSource": "OI" if has_oi else "VOLUME", "participationRatio": participation,
            "volumeExpansion": expansion, "reasons": [reason], "setup": setup}


def no_result(key: str, note: str, direction: str = "LONG") -> dict[str, Any]:
    return {"key": key, "matched": False, "score": 0, "direction": direction,
            "entryTrigger": None, "exit": None, "note": note}


def result(key: str, matched: bool, score: float, direction: str, entry: float,
           stop: float, target: float | None, trail: float, note: str,
           max_risk: float | None = None, scale: float | None = None) -> dict[str, Any]:
    return {"key": key, "matched": matched, "score": round2(score), "direction": direction,
            "entryTrigger": round2(entry) if matched else None,
            "exit": ({"stop": round2(stop), "target": None if target is None else round2(target),
                      "trail": round2(trail), "maxRisk": max_risk, "scaleOutFraction": scale} if matched else None),
            "note": note}


def detect_qulla(bars: list[Bar], percentile: float | None) -> dict[str, Any]:
    if len(bars) < 70: return no_result("QULLAMAGGIE", "Insufficient history (need ~70 bars).")
    highs, lows, closes, volumes = ([getattr(b, key) for b in bars] for key in ("high", "low", "close", "volume"))
    last, start = len(bars) - 1, len(bars) - 1 - 40
    high_idx = max(range(start, last + 1), key=lambda i: highs[i])
    flag_high, flag_len = highs[high_idx], last - high_idx
    consolidating = flag_len >= 10
    pole_low = min(lows[max(0, high_idx - 63):high_idx + 1])
    move = flag_high / pole_low - 1 if pole_low > 0 else 0
    flag_low = min(lows[high_idx + 1:]) if consolidating else math.nan
    depth = (flag_high - flag_low) / flag_high if consolidating and flag_high > 0 else 1
    flag = bars[high_idx + 1:] if consolidating else []
    half = len(flag) // 2
    early, late = flag[:half], flag[half:]
    span = lambda xs: max(b.high for b in xs) - min(b.low for b in xs)
    tightening = bool(early and late and min(b.low for b in late) >= min(b.low for b in early) and span(late) <= span(early))
    ema10, ema20 = ema_series(closes, 10), ema_series(closes, 20)
    surfing = closes[-1] > ema10[-1] > ema20[-1] and ema20[-1] > ema20[-6]
    move_volume = mean(volumes[max(0, high_idx - 19):high_idx + 1])
    flag_volume = mean(volumes[high_idx + 1:]) if consolidating else math.nan
    dry = math.isfinite(flag_volume) and move_volume > 0 and flag_volume < move_volume
    recent = [b.high / b.low - 1 for b in bars[-20:] if b.low > 0]
    adr = mean(recent) if recent else 0
    conditions = [move >= .3, consolidating, depth <= .2, tightening, surfing, dry, adr >= .04,
                  percentile is None or percentile >= 98]
    matched = all(conditions)
    stop = max(flag_low, flag_high - atr(bars)) if math.isfinite(flag_low) else flag_high - atr(bars)
    return result("QULLAMAGGIE", matched, sum(conditions) / len(conditions), "LONG", flag_high, stop,
                  None, max(stop, ema10[-1]), "Qullamaggie breakout setup." if matched else "No Qullamaggie breakout setup on the latest bar.", scale=.5)


def contractions(bars: list[Bar]) -> tuple[list[float], int | None]:
    n, start, k = len(bars), max(1, len(bars) - 120), 3
    depths, open_peak, pivot = [], None, None
    for i in range(start + k, n - k):
        window = bars[i-k:i+k+1]
        peak = all(bars[i].high >= b.high for b in window)
        trough = all(bars[i].low <= b.low for b in window)
        if peak: open_peak, pivot = i, i
        elif trough and open_peak is not None and bars[open_peak].high > 0:
            depths.append((bars[open_peak].high - bars[i].low) / bars[open_peak].high); open_peak = None
    if open_peak is not None and open_peak < n - 1 and bars[open_peak].high > 0:
        depths.append((bars[open_peak].high - min(b.low for b in bars[open_peak+1:])) / bars[open_peak].high)
    return depths, pivot


def detect_minervini(bars: list[Bar], rating: float | None) -> dict[str, Any]:
    if len(bars) < 222: return no_result("MINERVINI", "Insufficient history (Trend Template needs ~222 bars).")
    closes, highs, lows, volumes = ([getattr(b, key) for b in bars] for key in ("close", "high", "low", "volume"))
    last, close = len(bars) - 1, closes[-1]
    ma50, ma150, ma200, ma200_old = sma_at(closes,50), sma_at(closes,150), sma_at(closes,200), sma_at(closes,200,last-22)
    hi, lo = max(highs[-min(252,len(bars)):]), min(lows[-min(252,len(bars)):])
    six = closes[max(0,last-126)]
    template = [close > ma150 and close > ma200, ma150 > ma200, ma200 > ma200_old,
                ma50 > ma150 > ma200, close > ma50, lo > 0 and close >= lo*1.3,
                hi > 0 and close >= hi*.75, rating >= 70 if rating is not None else six > 0 and close/six-1 >= .1]
    depths, pivot_idx = contractions(bars); recent = depths[-4:]
    narrowing = len(recent)>=2 and all(recent[i] < recent[i-1] for i in range(1,len(recent)))
    narrowing = narrowing and recent[-1] <= .15 and max(recent) <= .35
    pivot = highs[pivot_idx] if pivot_idx is not None else max(highs[-10:])
    near = pivot*.95 <= close <= pivot*1.05
    final_start = pivot_idx+1 if pivot_idx is not None and last-pivot_idx>=3 else last-4
    dry = mean(volumes[final_start:]) < mean(volumes[-50:])
    breakout_idx = next((i for i,b in enumerate(bars) if pivot_idx is not None and i>pivot_idx and b.close>pivot), -1)
    volume_idx = breakout_idx if breakout_idx>=0 else last
    avg50 = mean(volumes[max(0,volume_idx-50):volume_idx])
    volume_ok = breakout_idx<0 or (avg50>0 and volumes[breakout_idx]>avg50)
    vcp=[narrowing,near,dry and volume_ok]; matched=all(template) and all(vcp)
    final_low=min(lows[pivot_idx+1:]) if pivot_idx is not None and pivot_idx<last else math.nan
    stop=max(final_low,pivot*.92) if math.isfinite(final_low) and final_low<pivot else pivot*.92
    return result("MINERVINI",matched,(sum(template)/8)*.7+sum(vcp)*.1,"LONG",pivot,stop,None,max(stop,ma50),
                  "Minervini VCP." if matched else f"Trend Template {sum(template)}/8 — not a full VCP.",max_risk=.08,scale=.5)


def detect_darvas(bars: list[Bar], tick: float) -> dict[str, Any]:
    if len(bars)<25:return no_result("DARVAS","Insufficient history (need ~25 bars).")
    start=max(0,len(bars)-60); top=max(range(start,len(bars)),key=lambda i:bars[i].high)
    box_top=bars[top].high; top_ok=len(bars)-1-top>=3; new=box_top>=max(b.high for b in bars[-min(252,len(bars)):])
    bottom=math.nan; bottom_ok=False; intact=False
    if top_ok:
        running=math.inf
        for i in range(top+1,len(bars)-3):
            if bars[i].low>=running:continue
            running=bars[i].low
            if all(bars[i+j].low>=bars[i].low for j in (1,2,3)):
                bottom=bars[i].low;bottom_ok=True;intact=all(b.low>=bottom for b in bars[i+4:]);break
    entry=round2(math.ceil((box_top+tick)/tick-1e-9)*tick)
    stop=round2(math.floor((bottom-tick)/tick+1e-9)*tick) if math.isfinite(bottom) else math.nan
    tradable=entry>0 and math.isfinite(stop) and (entry-stop)/entry<=.15
    cond=[new,top_ok,bottom_ok,intact,tradable];matched=all(cond) and box_top>bottom
    return result("DARVAS",matched,sum(cond)/5,"LONG",entry,stop,None,stop,
                  "Darvas box." if matched else "No confirmed Darvas box on the latest bar.",max_risk=.15,scale=.5)


def ptj_score(proximity: float,slope: float)->float:return .5+.25*max(0,1-proximity/.15)+.25*min(1,slope*50)


def detect_ptj(bars:list[Bar])->dict[str,Any]:
    if len(bars)<205:return no_result("PTJ","Insufficient history (200-day rule needs ~205 bars).")
    closes=[b.close for b in bars];ma=sma_at(closes,200);old=sma_at(closes,200,len(bars)-1-22);close=closes[-1]
    rising=ma>old;slope=abs(ma-old)/old if old>0 else 0
    if close>ma and rising:
        direction="LONG";proximity=(close-ma)/ma;entry=max(b.high for b in bars[-10:]);matched=proximity<=.15 and (entry-ma)/entry<=.15
    elif close<ma and not rising:
        direction="SHORT";proximity=(ma-close)/ma;entry=min(b.low for b in bars[-10:]);matched=proximity<=.15 and (ma-entry)/entry<=.15
    else:return no_result("PTJ","Mixed 200-day regime.")
    return result("PTJ",matched,ptj_score(proximity,slope),direction,entry,ma,None,ma,
                  "PTJ 200-day trend." if matched else "Trend aligned but over-extended.",max_risk=.15,scale=.5)


def detect_simons(bars:list[Bar])->dict[str,Any]:
    if len(bars)<21:return no_result("SIMONS","Insufficient history (need ~21 bars).")
    closes=[b.close for b in bars];close=closes[-1];window=closes[-20:];m=mean(window);sd=std(window)
    if not math.isfinite(sd) or sd==0:return no_result("SIMONS","Zero-variance window.")
    z=(close-m)/sd;direction="LONG";extreme=False
    if z<=-2.5:
        extreme=True;direction="LONG"
    elif z>=2.5:
        extreme=True;direction="SHORT"
    ma200=sma_at(closes,200);trend=math.isfinite(ma200) and (close>ma200 if direction=="LONG" else close<ma200)
    sane=close>0 and sd/close<=.15;matched=extreme and trend and sane;stop=close-sd if direction=="LONG" else close+sd
    return result("SIMONS",matched,min(1,abs(z)/3.5),direction,close,stop,m,stop,
                  "Simons mean reversion." if matched else f"z-score {z:.2f}σ — no setup.",max_risk=.15,scale=1)


def with_breakout(bars:list[Bar], detector, stop_at_low:bool=False)->dict[str,Any]:
    now=detector(bars)
    if now["matched"] or len(bars)<2:return now
    before=detector(bars[:-1]);last=bars[-1]
    if not before["matched"] or before["entryTrigger"] is None or before["exit"] is None:return now
    if last.high<before["entryTrigger"] or last.close<=before["exit"]["stop"]:return now
    avg=mean([b.volume for b in bars[-51:-1]]);ratio=last.volume/avg if avg>0 else 0
    stop=max(before["exit"]["stop"],last.low) if stop_at_low and last.low<before["entryTrigger"] else before["exit"]["stop"]
    before.update({"matched":True,"triggered":True,"breakoutVolumeRatio":round2(ratio),
                   "breakoutConfirmed":last.close>=before["entryTrigger"] and ratio>=1.5})
    before["exit"]={**before["exit"],"stop":round2(stop),"trail":max(stop,before["exit"]["trail"])}
    return before


def legendary(bars:list[Bar],rating:float|None,momentum:float|None,floor:float|None,tick:float)->dict[str,Any]:
    results=[with_breakout(bars,lambda x:detect_qulla(x,momentum),True),detect_minervini(bars,rating),
             with_breakout(bars,lambda x:detect_darvas(x,tick)),detect_ptj(bars),detect_simons(bars)]
    liquid=floor is None or mean([b.close*b.volume for b in bars[-20:]])>=floor
    tags=[];scores={}
    for item in results:
        exit_=item["exit"];entry=item["entryTrigger"];sign=1 if item["direction"]=="LONG" else -1
        riskless=exit_ is not None and entry is not None and sign*(entry-exit_["stop"])<=0
        if item["matched"] and not riskless and liquid:
            tags.append(item["key"]);scores[item["key"]]={"policyVersion":LEGENDARY_POLICY,"score":item["score"],
                "dir":item["direction"],"entry":entry,"stop":exit_["stop"],"target":exit_["target"],
                "trail":exit_["trail"],"maxRisk":exit_.get("maxRisk"),"scaleOutFraction":exit_.get("scaleOutFraction")}
            if item.get("triggered"):scores[item["key"]].update({"triggered":True,"volumeRatio":item.get("breakoutVolumeRatio"),"confirmed":bool(item.get("breakoutConfirmed"))})
    return {"tags":tags,"scores":scores,"results":results}


def tie_break(signal:dict[str,Any],rating:float|None)->dict[str,float]:
    level=signal["donchianHigh"] if signal["close"]>signal["donchianHigh"] else signal["bollinger"]["upper"]
    clearance=max(0,(signal["close"]-level)/signal["setup"]["atr"]) if signal["isBreakout"] and signal["setup"]["atr"]>0 else 0
    clamp=lambda v:max(0,min(1,v)) if math.isfinite(v) else 0
    score=round(((clamp(clearance/2)+clamp(signal["volumeExpansion"]/3)+(0 if rating is None else clamp((rating-1)/98)))/3)*10000)/10000
    return {"rankScore":score,"breakoutClearanceAtr":clearance}


def assess(payload:dict[str,Any])->dict[str,Any]:
    bars=[Bar.from_json(value) for value in payload["bars"]]
    signal=classify(bars);rating=payload.get("rsRating")
    levels=derive_levels(signal["setup"],"SHORT" if signal["bias"]=="SHORT" else "LONG",payload.get("risk") or {"stopAtrMult":1.5,"targetRR":2,"trailAtrMult":3})
    named=legendary(bars,rating,payload.get("momentumPercentile"),payload.get("minTradedValue"),float(payload.get("tick") or .01))
    return {"policyVersion":POLICY,"signal":signal,"levels":levels,"legendary":named,"tieBreak":tie_break(signal,rating)}


def cross_section(payload:dict[str,Any])->dict[str,Any]:
    items=payload.get("items") or [];performance=[]
    for item in items:
        c=item["closes"];weighted=weight=0
        if not (c.get("c0") or 0)>0:continue
        for w,key in ((.4,"c63"),(.2,"c126"),(.2,"c189"),(.2,"c252")):
            past=c.get(key)
            if past is None or not past>0:break
            weighted+=w*(c["c0"]/past);weight+=w
        if weight>0:performance.append((item["id"],weighted/weight))
    performance.sort(key=lambda x:x[1]);ratings={}
    for i,(id_,_) in enumerate(performance):ratings[id_]=99 if len(performance)==1 else max(1,js_round(1+98*i/(len(performance)-1)))
    best={}
    for key in ("c21","c63","c126"):
        returns=sorted([(i["id"],i["closes"]["c0"]/i["closes"][key]-1) for i in items if i["closes"].get("c0",0)>0 and (i["closes"].get(key) or 0)>0],key=lambda x:x[1])
        for idx,(id_,_) in enumerate(returns):
            pct=100 if len(returns)==1 else 100*idx/(len(returns)-1);best[id_]=max(best.get(id_,0),pct)
    return {"rsRatings":ratings,"momentumPercentiles":best}


def strategy_trade_levels(setup:dict[str,float], score:dict[str,Any], risk:dict[str,float])->dict[str,Any]:
    direction="SHORT" if score.get("dir")=="SHORT" else "LONG"
    trigger=score.get("entry")
    if trigger is None:trigger=setup["shortTrigger"] if direction=="SHORT" else setup["longTrigger"]
    adjusted={**setup,("shortTrigger" if direction=="SHORT" else "longTrigger"):trigger}
    fallback=derive_levels(adjusted,direction,risk)
    structural=score.get("stop")
    if structural is None or not math.isfinite(float(structural)):return fallback
    sign=1 if direction=="LONG" else -1;entry=fallback["entry"]
    cap=score.get("maxRisk");capped=entry*(1-sign*float(cap)) if cap is not None and float(cap)>0 else None
    stop=float(structural) if capped is None else max(float(structural),capped) if direction=="LONG" else min(float(structural),capped)
    unit=sign*(entry-stop)
    if not unit>0:return fallback
    own=score.get("target");target=float(own) if own is not None and sign*(float(own)-entry)>0 else max(0,entry+sign*risk["targetRR"]*unit)
    line=float(score.get("trail") if score.get("trail") is not None else stop)
    trail=min(entry,max(stop,line)) if direction=="LONG" else max(entry,min(stop,line))
    distance=abs(target-entry);days=min(60,max(1,js_round(distance/setup["dailyVelocity"]))) if setup["dailyVelocity"]>0 else 0
    return {"direction":direction,"currentPrice":fallback["currentPrice"],"entry":entry,"target":round2(target),
            "stopLoss":round2(stop),"trailingStop":round2(trail),"atr":fallback["atr"],
            "riskRewardRatio":round2(distance/unit),"expectedDays":days}


def entry_state(direction:str,price:float,trigger:float|None,stop:float|None,atr_value:float,triggered:bool=False,confirmed:bool=False)->str|None:
    sign=1 if direction=="LONG" else -1
    if stop is not None and math.isfinite(stop) and sign*(price-stop)<=0:return "BELOW_STOP"
    if trigger is not None and atr_value>0 and sign*(price-trigger)>atr_value:return "EXTENDED"
    if triggered:return "BREAKOUT_CONFIRMED" if confirmed else "BREAKOUT_UNCONFIRMED"
    if trigger is not None and sign*(price-trigger)>=0:return "BREAKOUT_UNCONFIRMED"
    return None


def levels_for_screen(payload:dict[str,Any])->dict[str,Any]:
    setup=payload["setup"];risk=payload["risk"];direction=payload.get("direction") or "LONG"
    default=derive_levels(setup,direction,risk)
    default_state=None if payload.get("noSetup") else entry_state(direction,setup["currentPrice"],setup["shortTrigger"] if direction=="SHORT" else setup["longTrigger"],None,setup["atr"])
    strategies={}
    for key,score in (payload.get("scores") or {}).items():
        levels=strategy_trade_levels(setup,score,risk)
        strategies[key]={"state":entry_state(levels["direction"],setup["currentPrice"],score.get("entry"),levels["stopLoss"],setup["atr"],bool(score.get("triggered")),bool(score.get("confirmed"))),
                         "breakoutVolumeRatio":score.get("volumeRatio") if score.get("triggered") else None,
                         "direction":levels["direction"],"entry":levels["entry"],"target":levels["target"],
                         "stopLoss":levels["stopLoss"],"trailingStop":levels["trailingStop"],
                         "riskReward":levels["riskRewardRatio"],"expectedDays":levels["expectedDays"],"score":float(score.get("score") or 0)}
    return {"default":default,"entryState":default_state,"strategies":strategies}
