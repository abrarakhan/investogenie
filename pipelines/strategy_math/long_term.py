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
    target=points[0]["date"].replace(year=points[0]["date"].year-years)
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
