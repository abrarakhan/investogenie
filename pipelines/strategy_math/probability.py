"""Cross-sectional probability forecasts. Sole calculation authority."""
from __future__ import annotations
import math

T5 = {"p5": -2.015, "p25": -0.727, "p50": 0.0, "p75": 0.727, "p95": 2.015}

def mean(xs): return sum(xs) / len(xs) if xs else 0.0
def std(xs):
    if len(xs) < 2: return 0.0
    m = mean(xs)
    return math.sqrt(sum((x-m)**2 for x in xs)/(len(xs)-1))
def clamp(x, lo, hi): return max(lo, min(hi, x))
def pct(a, b): return ((b/a)-1)*100 if a > 0 else 0.0
def sigmoid(x): return 1/(1+math.exp(-clamp(x, -8, 8)))

def ewma(closes, lam):
    rets = [math.log(closes[i]/closes[i-1]) for i in range(1,len(closes)) if closes[i-1] > 0 and closes[i] > 0]
    if len(rets) < 20: return 0.0
    variance = sum(r*r for r in rets[:30])/min(30,len(rets))
    for r in rets[30:]: variance = lam*variance+(1-lam)*r*r
    return math.sqrt(max(variance,0))

def zmap(rows, key):
    vals=[r[key] for r in rows if math.isfinite(r[key])]; m=mean(vals); s=std(vals) or 1
    return {r["assetId"]: ((r[key]-m)/s if math.isfinite(r[key]) else 0) for r in rows}

def assess(data):
    cfg=data["config"]; features=[]
    for asset in data["assets"]:
        valid=[p for p in asset["points"] if isinstance(p.get("close"),(int,float)) and math.isfinite(p["close"]) and p["close"]>0]
        closes=[p["close"] for p in valid]; dates=[p["date"] for p in valid]
        if len(closes)<cfg["minBars"]: continue
        i=len(closes)-1; last=closes[-1]; window=closes[-20:]; sd=std(window) or last*.01
        five=[pct(closes[j-5],closes[j]) for j in range(5,len(closes))]; ret5=pct(closes[i-5],last)
        recent=five[-120:]; ret_sd=std(recent) or 1
        features.append({**asset,"closes":closes,"dates":dates,"momentum12":pct(closes[i-252],closes[i-21]),
          "momentum6":pct(closes[i-126],closes[i-21]),"priceZ":(last-mean(window))/sd,
          "ret5Z":(ret5-mean(recent))/ret_sd,"sigma":ewma(closes,cfg["ewmaLambda"])})
    zs={k:zmap(features,k) for k in ("momentum12","momentum6","priceZ","ret5Z")}; rows=[]
    scale=math.sqrt(cfg["studentTdf"]/(cfg["studentTdf"]-2)) if cfg["studentTdf"]>2 else 1
    for r in features:
        aid=r["assetId"]; momentum=1.15*zs["momentum12"][aid]+.55*zs["momentum6"][aid]
        snap=-.22*zs["priceZ"][aid]-.14*zs["ret5Z"][aid]; penalty=-.18*max(0,r["sigma"]*math.sqrt(252)-.35)
        expected=clamp(1.55*momentum+snap+penalty,-18,18); sigma=clamp(r["sigma"]*math.sqrt(cfg["horizonDays"])*100,2,45)
        prob=clamp(sigmoid(expected/max(1,sigma)*1.75)*100,5,95)
        risk=clamp(sigmoid((sigma-cfg["drawdownThresholdPct"]+max(0,-expected))/6)*100,3,97)
        quote=r.get("quotePrice"); price=quote if isinstance(quote,(int,float)) and math.isfinite(quote) and quote>0 else r["closes"][-1]
        percentiles={k:expected+(q/scale)*sigma for k,q in T5.items()}; ranges={k:price*(1+v/100) for k,v in percentiles.items()}
        contrib=[("12-1M momentum",zs["momentum12"][aid]),("6-1M momentum",zs["momentum6"][aid]),("20DMA snapback",-zs["priceZ"][aid]),("5D snapback",-zs["ret5Z"][aid])]
        contrib.sort(key=lambda x:abs(x[1]),reverse=True)
        rows.append({"assetId":aid,"ticker":r["ticker"],"name":r["name"],"exchange":r["exchange"],"currency":r["currency"],"lastPrice":price,"changePct":r.get("quoteChangePct"),"bars":len(r["closes"]),"asOf":r["dates"][-1],"probabilityUpPct":prob,"expectedReturnPct":expected,"sigma21Pct":sigma,"drawdownRiskPct":risk,"percentiles":percentiles,"priceRange":ranges,"contributions":[{"label":label,"value":value,"tone":"neutral" if abs(value)<.25 else "positive" if value>0 else "negative"} for label,value in contrib[:3]],"calibration":{"hitRatePct":None,"brierScore":None,"warning":"Calibration pending - treat as an exploratory probability estimate."}})
    rows.sort(key=lambda r:r["probabilityUpPct"],reverse=True)
    return {"rows":rows[:cfg["maxRows"]],"eligible":len(data["assets"]),"featureCount":len(features)}
