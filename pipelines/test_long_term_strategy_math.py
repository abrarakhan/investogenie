import unittest
from strategy_math.long_term import historical_metrics, score_fundamentals

class LongTermHistoryTest(unittest.TestCase):
    def test_golden_history_metrics(self):
        rows=[
          {"period":"2025-03-31","revenue":160,"netProfit":32,"roce":24,"operatingCashFlow":36,"freeCashFlow":20},
          {"period":"2024-03-31","revenue":145,"netProfit":27,"roce":20,"operatingCashFlow":29,"freeCashFlow":17},
          {"period":"2023-03-31","revenue":125,"netProfit":22,"roce":18,"operatingCashFlow":24,"freeCashFlow":14},
          {"period":"2022-03-31","revenue":100,"netProfit":16,"roce":16,"operatingCashFlow":18,"freeCashFlow":10},
          {"period":"2021-03-31","revenue":90,"netProfit":14,"roce":14,"operatingCashFlow":15,"freeCashFlow":9},
          {"period":"2020-03-31","revenue":80,"netProfit":10,"roce":12,"operatingCashFlow":11,"freeCashFlow":8},]
        result=historical_metrics(rows)
        self.assertAlmostEqual(result["revenueCagr3y"],16.9607,3)
        self.assertAlmostEqual(result["profitCagr5y"],26.1914,3)
        self.assertEqual(result["medianRoce5y"],17)
        self.assertEqual(result["historyYears"],5)
        self.assertEqual(result["statementPeriods"],6)
    def test_insufficient_history_does_not_manufacture_cagr(self):
        result=historical_metrics([{"period":"2025-03-31","revenue":100,"netProfit":10,"roce":12},{"period":"2024-03-31","revenue":90,"netProfit":-2,"roce":8}])
        self.assertIsNone(result["revenueCagr3y"]); self.assertIsNone(result["profitCagr3y"]); self.assertIsNone(result["positiveProfitYearsRatio"])
    def test_missing_cash_values_remain_missing(self):
        result=historical_metrics([{"period":"2025-03-31","revenue":100,"netProfit":10,"roce":12},{"period":"2024-03-31","revenue":90,"netProfit":9,"roce":11},{"period":"2023-03-31","revenue":80,"netProfit":8,"roce":10}])
        self.assertIsNone(result["medianCashConversion5y"]); self.assertEqual(result["statementPeriods"],0)

class LongTermScoringTest(unittest.TestCase):
    def test_scoring_confidence_and_eligibility(self):
        criterion={"label":"ROE","field":"roe","target":15,"direction":"higher","weight":1,"description":"Return"}
        base={"roe":20,"marketCap":10000,"reportAgeDays":90,"historyYears":5,"sector":"Industrials"}
        scores=score_fundamentals({"market":"IN","fundamentals":[base,{**base,"sector":"Financial Services"}],"strategies":[{"key":"TEST","criteria":[criterion]}]})
        self.assertTrue(scores[0][0]["eligible"]); self.assertGreater(scores[0][0]["matchScore"],0)
        self.assertFalse(scores[1][0]["eligible"]); self.assertIn("sector-correct",scores[1][0]["eligibilityReason"])

    def test_missing_and_stale_evidence_fails_closed(self):
        criteria=[{"label":"ROE","field":"roe","target":15,"direction":"higher","weight":1,"description":"Return"},{"label":"Debt","field":"debtToEquity","target":.5,"direction":"lower","weight":1,"description":"Debt"}]
        f={"roe":20,"debtToEquity":None,"marketCap":10000,"reportAgeDays":500,"historyYears":1,"sector":"Industrials"}
        score=score_fundamentals({"market":"IN","fundamentals":[f],"strategies":[{"key":"TEST","criteria":criteria}]})[0][0]
        self.assertFalse(score["eligible"]); self.assertLess(score["confidence"],60); self.assertTrue(score["outcomes"][1]["dataMissing"])

if __name__ == "__main__": unittest.main()
