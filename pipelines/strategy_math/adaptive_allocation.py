"""Adaptive Allocation pair selection and Universal Portfolio mathematics."""
import math
from datetime import date

def _mean(xs): return sum(xs)/len(xs)
def _corr(a,b):
    am,bm=_mean(a),_mean(b); cov=sum((x-am)*(y-bm) for x,y in zip(a,b)); av=sum((x-am)**2 for x in a); bv=sum((y-bm)**2 for y in b)
    den=math.sqrt(av*bv); return cov/den if den>0 else 1
def select_pair(candidates):
    selections=[]; count=len(candidates)
    for li in range(count):
      for ri in range(li+1,count):
        a,b=candidates[li],candidates[ri]; right={p["date"]:p["close"] for p in b["prices"]}; common=[(p["close"],right[p["date"]]) for p in a["prices"] if p["date"] in right][-253:]
        if len(common)<126: continue
        ra=[]; rb=[]; clean=True
        for i in range(1,len(common)):
          xa,xb=common[i][0]/common[i-1][0],common[i][1]/common[i-1][1]
          if not all(math.isfinite(v) and .6<=v<=1.6 for v in (xa,xb)): clean=False; break
          ra.append(math.log(xa)); rb.append(math.log(xb))
        if not clean: continue
        ret_a=(common[-1][0]/common[0][0]-1)*100; ret_b=(common[-1][1]/common[0][1]-1)*100; corr=_corr(ra,rb)
        score=corr+(.3 if a.get("sector") and b.get("sector") and a["sector"]==b["sector"] else 0)+.2*((ret_a<=0)+(ret_b<=0))+.05*((a["liquidityRank"]+b["liquidityRank"])/max(1,count*2))
        selections.append({"assetA":a,"assetB":b,"correlation":corr,"returnA12mPct":ret_a,"returnB12mPct":ret_b,"commonSessions":len(common),"score":score})
    if not selections: raise ValueError("No eligible stock pair has at least 126 clean common sessions. Refresh market history and try again.")
    return sorted(selections,key=lambda x:(x["score"],x["assetA"]["ticker"],x["assetB"]["ticker"]))[0]

def _softmax(values):
    top=max(values); exp=[math.exp(v-top) for v in values]; total=sum(exp); return [v/total for v in exp]
def _metrics(values,returns,dates):
    initial=values[0]; final=values[-1]; years=max(1/252,(date.fromisoformat(dates[-1])-date.fromisoformat(dates[0])).days/365.25)
    avg=sum(returns)/max(1,len(returns)); variance=sum((r-avg)**2 for r in returns)/max(1,len(returns)-1)
    peak=values[0]; drawdown=0
    for value in values: peak=max(peak,value); drawdown=min(drawdown,(value/peak-1)*100)
    return {"finalValue":final,"totalReturnPct":(final/initial-1)*100,"cagrPct":((final/initial)**(1/years)-1)*100,"annualVolatilityPct":math.sqrt(variance*252)*100,"maxDrawdownPct":drawdown}
def backtest(data):
    points=data["points"]; cfg=data["config"]
    if len(points)<30: raise ValueError("At least 30 common trading sessions are required.")
    capital=max(1,float(cfg["initialCapital"])); cost_rate=max(0,float(cfg["feeBps"]))/10000; band=max(0,float(cfg["noTradeBandPct"]))/100
    steps=max(10,min(500,math.floor(cfg.get("gridSteps",100)+.5))); weights=[i/steps for i in range(steps+1)]; gross_logs=[0.0]*len(weights); net_logs=[0.0]*len(weights)
    ug=un=eq=bh=capital; gw=nw=ew=[.5,.5]; target=[.5,.5]; turnover_total=costs=0.0
    vg=[capital]; vn=[capital]; ve=[capital]; vb=[capital]; rg=[]; rn=[]; re=[]; rb=[]; series=[]; dates=[p["date"] for p in points]; initial=points[0]["prices"]
    relatives_all=[]
    for day in range(1,len(points)):
        previous,current=points[day-1]["prices"],points[day]["prices"]; rel=[current[0]/previous[0],current[1]/previous[1]]; relatives_all.append(rel)
        if any(not math.isfinite(v) or v<=0 or v<.6 or v>1.6 for v in rel): raise ValueError(f"Suspicious corporate-action discontinuity on {points[day]['date']}. Refresh adjusted history before backtesting.")
        for i,w in enumerate(weights):
            factor=w*rel[0]+(1-w)*rel[1]; gross_logs[i]+=math.log(factor); post=w*rel[0]/factor; net_logs[i]+=math.log(factor*max(1e-12,1-abs(w-post)*cost_rate))
        gf=gw[0]*rel[0]+gw[1]*rel[1]; nf=nw[0]*rel[0]+nw[1]*rel[1]; ef=ew[0]*rel[0]+ew[1]*rel[1]; post=nw[0]*rel[0]/nf; epost=ew[0]*rel[0]/ef
        ug*=gf; un*=nf; eq*=ef; bh=capital*(.5*current[0]/initial[0]+.5*current[1]/initial[1])
        posterior=_softmax(net_logs); wa=sum(p*w for p,w in zip(posterior,weights)); target=[wa,1-wa]
        gp=_softmax(gross_logs); gwa=sum(p*w for p,w in zip(gp,weights)); gw=[gwa,1-gwa]
        drift=abs(target[0]-post); turnover=0
        if drift>=band: turnover=drift; cost=un*turnover*cost_rate; un-=cost; costs+=cost; turnover_total+=turnover; nw=target[:]
        else:nw=[post,1-post]
        eturn=abs(.5-epost); eq*=max(1e-12,1-eturn*cost_rate); ew=[.5,.5]
        for values,value,returns in ((vg,ug,rg),(vn,un,rn),(ve,eq,re),(vb,bh,rb)): returns.append(value/values[-1]-1); values.append(value)
        series.append({"date":points[day]["date"],"universalNet":un,"universalGross":ug,"buyHold":bh,"equalCrpNet":eq,"targetWeightA":target[0],"turnover":turnover})
    best=max(range(len(net_logs)),key=lambda i:net_logs[i]); bwa=weights[best]; best_values=[capital]; best_returns=[]; wealth=capital
    for rel in relatives_all:
        factor=bwa*rel[0]+(1-bwa)*rel[1]; post=bwa*rel[0]/factor; old=wealth; wealth*=factor*max(1e-12,1-abs(bwa-post)*cost_rate); best_values.append(wealth); best_returns.append(wealth/old-1)
    nm,em,bm=_metrics(vn,rn,dates),_metrics(ve,re,dates),_metrics(vb,rb,dates); verdict="SUCCESS" if nm["finalValue"]>max(em["finalValue"],bm["finalValue"]) else "MIXED" if nm["finalValue"]>min(em["finalValue"],bm["finalValue"]) else "FAILURE"
    return {"sessions":len(points),"startDate":dates[0],"endDate":dates[-1],"universalNet":nm,"universalGross":_metrics(vg,rg,dates),"buyHold":bm,"equalCrpNet":em,"hindsightBestCrp":{**_metrics(best_values,best_returns,dates),"weightA":bwa},"latestTarget":target,"totalTurnover":turnover_total,"estimatedCosts":costs,"series":series,"verdict":verdict}
