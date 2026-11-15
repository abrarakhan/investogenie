import unittest
from datetime import date,timedelta
from strategy_math.adaptive_allocation import backtest, select_pair

def candidate(ticker,sector,rank,returns,count=200):
    close=100; points=[]; start=date(2025,1,1)
    for i in range(count):
        close*=1+returns(i); points.append({"date":str(start+timedelta(days=i)),"close":close})
    return {"id":ticker,"ticker":ticker,"name":ticker,"exchange":"TEST","sector":sector,"liquidityRank":rank,"prices":points}

class AdaptivePairTest(unittest.TestCase):
    def test_selects_diversified_pair(self):
        alpha=candidate("ALPHA","Tech",1,lambda i:.01 if i%2 else -.008)
        clone=candidate("CLONE","Tech",2,lambda i:.009 if i%2 else -.007)
        hedge=candidate("HEDGE","Energy",3,lambda i:-.006 if i%2 else .009)
        result=select_pair([alpha,clone,hedge])
        self.assertEqual((result["assetA"]["ticker"],result["assetB"]["ticker"]),("ALPHA","HEDGE")); self.assertLess(result["correlation"],0)
    def test_fails_closed_on_short_history(self):
        with self.assertRaisesRegex(ValueError,"126 clean common sessions"):
            select_pair([candidate("SHORT","Tech",1,lambda i:.001,50),candidate("OTHER","Finance",2,lambda i:.001)])

class UniversalPortfolioTest(unittest.TestCase):
    def setUp(self):
        start=date(2025,1,1)
        self.points=[{"date":str(start+timedelta(days=i)),"prices":[100*(1.001**i)*(1.02 if i%2 else .98),100*(1.0005**i)*(.98 if i%2 else 1.02)]} for i in range(260)]
    def run_model(self,fees=10,band=.5):
        return backtest({"points":self.points,"config":{"initialCapital":100000,"feeBps":fees,"noTradeBandPct":band}})
    def test_produces_finite_allocations_and_metrics(self):
        result=self.run_model(); self.assertEqual(result["sessions"],260); self.assertTrue(0<=result["latestTarget"][0]<=1); self.assertGreater(result["universalNet"]["finalValue"],0)
    def test_charges_rebalancing_costs(self):
        free=self.run_model(0,0); costly=self.run_model(50,0); self.assertLess(costly["universalNet"]["finalValue"],free["universalNet"]["finalValue"]); self.assertGreater(costly["estimatedCosts"],0)
    def test_fails_closed_on_discontinuity(self):
        broken=[{"date":p["date"],"prices":p["prices"][:]} for p in self.points]; broken[100]["prices"][0]*=.4
        with self.assertRaisesRegex(ValueError,"corporate-action"): backtest({"points":broken,"config":{"initialCapital":1,"feeBps":0,"noTradeBandPct":0}})

if __name__=="__main__": unittest.main()
