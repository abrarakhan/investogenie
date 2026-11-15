"""Adaptive Allocation pair selection and Universal Portfolio mathematics."""
import math

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
