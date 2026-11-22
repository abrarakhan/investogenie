"""Long-term annual-history metrics."""
from datetime import date
import math

EMPTY={"revenueCagr3y":None,"revenueCagr5y":None,"profitCagr3y":None,"profitCagr5y":None,"medianRoce5y":None,"medianCashConversion5y":None,"medianFcfMargin5y":None,"positiveProfitYearsRatio":None,"historyYears":0,"statementPeriods":0}
def finite(v):
    try:
        n=float(v)
        return n if math.isfinite(n) else None
    except (TypeError,ValueError): return None
def median(xs):
    if not xs:return None
    xs=sorted(xs); n=len(xs); return xs[n//2] if n%2 else (xs[n//2-1]+xs[n//2])/2
def cagr(latest,oldest,years):
    return ((latest/oldest)**(1/years)-1)*100 if latest and oldest and latest>0 and oldest>0 and years>=2 else None
def back(points,years):
    d=points[0]["date"]
    try: target=d.replace(year=d.year-years)
    except ValueError: target=d.replace(year=d.year-years,day=28)
    choices=sorted(points[1:],key=lambda p:abs((p["date"]-target).days))
    return choices[0] if choices and abs((choices[0]["date"]-target).days)<=540 else None
def historical_metrics(raw):
    points=[]
    for p in raw:
        try:d=date.fromisoformat(str(p.get("period","")))
        except ValueError:continue
        points.append({"date":d,"revenue":finite(p.get("revenue")),"netProfit":finite(p.get("netProfit")),"roce":finite(p.get("roce")),"operatingCashFlow":finite(p.get("operatingCashFlow")),"freeCashFlow":finite(p.get("freeCashFlow"))})
    points.sort(key=lambda p:p["date"],reverse=True)
    if not points:return dict(EMPTY)
    latest=points[0]; p3=back(points,3); p5=back(points,5); observed=points[:6]
    roce=[p["roce"] for p in observed if p["roce"] is not None]; profits=[p["netProfit"] for p in observed if p["netProfit"] is not None]
    cash=[p["operatingCashFlow"]/p["netProfit"] for p in observed if p["netProfit"] is not None and p["netProfit"]>0 and p["operatingCashFlow"] is not None]
    margins=[p["freeCashFlow"]/p["revenue"]*100 for p in observed if p["revenue"] is not None and p["revenue"]>0 and p["freeCashFlow"] is not None]
    return {"revenueCagr3y":cagr(latest["revenue"],p3["revenue"],3) if p3 else None,"revenueCagr5y":cagr(latest["revenue"],p5["revenue"],5) if p5 else None,"profitCagr3y":cagr(latest["netProfit"],p3["netProfit"],3) if p3 else None,"profitCagr5y":cagr(latest["netProfit"],p5["netProfit"],5) if p5 else None,"medianRoce5y":median(roce),"medianCashConversion5y":median(cash),"medianFcfMargin5y":median(margins),"positiveProfitYearsRatio":sum(v>0 for v in profits)/len(profits) if len(profits)>=3 else None,"historyYears":max(0,points[0]["date"].year-points[-1]["date"].year) if len(points)>1 else 0,"statementPeriods":max(len(cash),len(margins))}

def assess(data): return historical_metrics(data.get("points",[]))

def _clamp(v,lo,hi): return min(hi,max(lo,v))
def _js_round(v): return math.floor(v+.5)
def _value(f,field):
    if field=="earningsYield": return 100/f["peRatio"] if f.get("peRatio") and f["peRatio"]>0 else None
    if field in ("peRatio","priceToBook"):
        v=f.get(field)
        return v if v is not None and v>0 else None
    if field=="debtToEquity":
        v=f.get(field)
        return v if v is not None and v>=0 else None
    if field in ("revenueCagr3y","profitCagr3y"):
        fallback="revenueGrowthYoY" if field.startswith("revenue") else "profitGrowthYoY"
        v=f.get(field) if f.get(field) is not None else f.get(fallback)
        return _clamp(v,-100,100) if v is not None else None
    if field=="pegRatio":
        growth=_value(f,"profitCagr3y")
        return f["peRatio"]/min(growth,50) if f.get("peRatio") and f["peRatio"]>0 and growth and growth>0 else None
    return f.get(field)
def _score(v,target,direction):
    if target==0:return 100 if (v>0 if direction=="higher" else v<=0) else 0
    distance=(v-target)/abs(target) if direction=="higher" else (target-v)/abs(target)
    return _clamp(100/(1+math.exp(_clamp(-3.2*distance,-60,60))),0,100)
def score_fundamentals(data):
    market=data["market"]; out=[]
    floor=500 if market=="IN" else 50
    for f in data["fundamentals"]:
        sector=str(f.get("sector") or "").lower()
        ineligible="Current ratios are not sector-correct for banks, insurers, financial companies, or REITs." if any(x in sector for x in ("financial","bank","insurance","reit","real estate")) else None
        if not ineligible and f.get("marketCap") is None: ineligible="Market capitalization is missing."
        if not ineligible and f["marketCap"]<floor: ineligible=f"Market capitalization is below the {'INR 500 crore' if market=='IN' else 'USD 50 million'} investability floor."
        scores=[]
        for strategy in data["strategies"]:
            weighted=available_weight=total_weight=0; matched=available=0; outcomes=[]
            for c in strategy["criteria"]:
                total_weight+=c["weight"]; v=_value(f,c["field"])
                if v is None or not math.isfinite(v): outcomes.append({"label":c["label"],"passed":False,"dataMissing":True,"description":c["description"],"value":None,"score":0}); continue
                s=_score(v,c["target"],c["direction"]); passed=v>=c["target"] if c["direction"]=="higher" else v<=c["target"]
                available_weight+=c["weight"]; available+=1; weighted+=s*c["weight"]; matched+=int(passed)
                outcomes.append({"label":c["label"],"passed":passed,"dataMissing":False,"description":c["description"],"value":v,"score":_js_round(s)})
            raw=weighted/available_weight if available_weight else 0; completeness=available_weight/total_weight if total_weight else 0
            age=f.get("reportAgeDays"); age_factor=0 if age is None else 1 if age<=180 else .75 if age<=365 else .4
            years=f.get("historyYears",0); history_factor=1 if years>=4 else .85 if years>=2 else .65
            confidence=_js_round(completeness*age_factor*history_factor*100); eligible=not ineligible and confidence>=60
            scores.append({"key":strategy["key"],"matchScore":_js_round(raw*(.7+.3*confidence/100)) if eligible else 0,"rawScore":_js_round(raw),"confidence":confidence,"matchedCriteria":matched,"availableCriteria":available,"totalCriteria":len(strategy["criteria"]),"eligible":eligible,"eligibilityReason":ineligible or ("Insufficient or stale evidence for this strategy." if confidence<60 else None),"outcomes":outcomes})
        out.append(scores)
    return out
