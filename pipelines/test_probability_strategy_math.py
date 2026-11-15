import unittest
from strategy_math.probability import assess

class ProbabilityMathTest(unittest.TestCase):
    def test_cross_section_is_ranked_and_uses_quote_anchor(self):
        assets=[]
        for n, slope in enumerate((0.05, 0.2, -0.03)):
            points=[{"date":f"2026-{1+(i//28):02d}-{1+(i%28):02d}","close":100+i*slope+((i%7)-3)*.1} for i in range(300)]
            assets.append({"assetId":str(n),"ticker":f"T{n}","name":f"T{n}","exchange":"NSE","currency":"INR","quotePrice":200+n,"quoteChangePct":None,"points":points})
        result=assess({"config":{"horizonDays":21,"minBars":280,"maxRows":2,"ewmaLambda":.94,"studentTdf":5,"drawdownThresholdPct":10},"assets":assets})
        self.assertEqual(len(result["rows"]),2)
        self.assertGreaterEqual(result["rows"][0]["probabilityUpPct"],result["rows"][1]["probabilityUpPct"])
        self.assertIn(result["rows"][0]["lastPrice"],(200,201,202))
        self.assertEqual(result["featureCount"],3)

if __name__ == "__main__": unittest.main()
