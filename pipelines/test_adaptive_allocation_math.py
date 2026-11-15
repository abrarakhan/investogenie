import unittest
from datetime import date,timedelta
from strategy_math.adaptive_allocation import select_pair

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

if __name__=="__main__": unittest.main()
