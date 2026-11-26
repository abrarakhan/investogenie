import unittest

from strategy_math.tactical_radar import (
    assess,
    classify_market_regime,
    compute_atr_levels,
    evaluate_strong_swing_near_trigger,
)


class TacticalRadarMathTests(unittest.TestCase):
    def test_unverified_when_benchmark_50dma_missing_even_with_strong_breadth(self):
        res = classify_market_regime(None, 0.8, 1500, 500)
        self.assertEqual(res["regime"], "UNVERIFIED")
        self.assertEqual(res["breadthPct"], 75.0)

    def test_unverified_when_breadth_empty_from_stale_quotes(self):
        res = classify_market_regime(True, 0.5, 0, 0)
        self.assertEqual(res["regime"], "UNVERIFIED")
        self.assertIsNone(res["breadthPct"])

    def test_trend_breakout_regime(self):
        res = classify_market_regime(True, 0.45, 1200, 800)
        self.assertEqual(res["regime"], "TREND_BREAKOUT")
        self.assertEqual(res["favoredBucket"], "NEAR_TRIGGER")
        self.assertEqual(res["breadthPct"], 60.0)

    def test_snapback_reversal_regime(self):
        res = classify_market_regime(False, 0.7, 750, 1250)
        self.assertEqual(res["regime"], "SNAPBACK_REVERSAL")
        self.assertEqual(res["favoredBucket"], "OVERSOLD_SNAPBACK")

    def test_defensive_regime(self):
        res = classify_market_regime(False, -0.6, 600, 1400)
        self.assertEqual(res["regime"], "DEFENSIVE")

    def test_choppy_rotation_regime(self):
        res = classify_market_regime(True, 0.1, 950, 1050)
        self.assertEqual(res["regime"], "CHOPPY_ROTATION")
        self.assertEqual(res["favoredBucket"], "MID_TREND_PULLBACK")

    def test_near_trigger_gates(self):
        ok = evaluate_strong_swing_near_trigger([
            {"key": "price", "passed": True, "blocking": True},
            {"key": "follow_through", "passed": False, "blocking": True},
            {"key": "session_reversal", "passed": False, "blocking": True},
        ])
        self.assertTrue(ok["eligible"])
        self.assertEqual(ok["failedTimingGates"], ["follow_through", "session_reversal"])

        bad = evaluate_strong_swing_near_trigger([
            {"key": "liquidity", "passed": False, "blocking": True},
            {"key": "follow_through", "passed": False, "blocking": True},
        ])
        self.assertFalse(bad["eligible"])

    def test_atr_levels_tighter_for_snapback(self):
        trend = compute_atr_levels(200.0, 4.0, "TREND")
        snap = compute_atr_levels(200.0, 4.0, "SNAPBACK", 225.0)
        self.assertLess(snap["riskPct"], trend["riskPct"])
        self.assertGreater(snap["invalidationStop"], trend["invalidationStop"])
        self.assertGreaterEqual(snap["targetZone"], 225.0)

    def test_assess_confluence_and_exclusions(self):
        out = assess({
            "market": "IN",
            "priceFloor": 20,
            "limitPerBucket": 10,
            "breadth": {"advancers": 1200, "decliners": 800, "asOfDate": "2026-11-26"},
            "benchmark": {"ticker": "NIFTY", "price": 25884.5, "changePct": 0.25, "aboveSma50": True},
            "excludedAssetIds": ["a-excluded"],
            "excludedCounts": {"adverseNews": 1, "resultsBlackout": 0},
            "newsNotes": {},
            "strongRows": [
                {
                    "assetId": "a-1",
                    "ticker": "WOCKPHARMA",
                    "name": "Wockhardt",
                    "exchange": "NSE",
                    "strengthScore": 85,
                    "livePrice": 2100,
                    "gates": [{"key": "follow_through", "passed": False, "blocking": True}],
                },
                {
                    "assetId": "a-excluded",
                    "ticker": "BADNEWS",
                    "name": "Bad News Ltd",
                    "exchange": "NSE",
                    "strengthScore": 95,
                    "livePrice": 500,
                    "gates": [],
                },
            ],
            "obsRows": [
                {
                    "assetId": "a-1",
                    "ticker": "WOCKPHARMA",
                    "name": "Wockhardt",
                    "exchange": "NSE",
                    "engine": "TREND_CONTINUATION",
                    "status": "CONTINUATION_WATCH",
                    "livePrice": 2100,
                }
            ],
            "trendRows": [],
            "swingRows": [],
            "pullbackRows": [
                {
                    "assetId": "a-2",
                    "ticker": "ACE",
                    "name": "Action Construction",
                    "exchange": "NSE",
                    "close": 1200,
                    "livePrice": 1200,
                    "rsi14": 60,
                    "atrPct": 3.5,
                    "volumeRatio": 1.1,
                    "return20d": 14.8,
                    "distanceSma20Pct": 2.5,
                    "distanceSma200Pct": 15.0,
                }
            ],
            "snapbackRows": [],
        })
        self.assertEqual(out["context"]["regime"], "TREND_BREAKOUT")
        near = out["buckets"]["NEAR_TRIGGER"]
        self.assertEqual([c["ticker"] for c in near], ["WOCKPHARMA"])
        self.assertEqual(near[0]["confluenceCount"], 2)
        self.assertEqual(near[0]["score"], 95)
        self.assertEqual([c["ticker"] for c in out["buckets"]["MID_TREND_PULLBACK"]], ["ACE"])

    def test_excludes_etfs_and_boosts_high_turnover_pullbacks(self):
        out = assess({
            "market": "IN",
            "priceFloor": 20,
            "limitPerBucket": 15,
            "breadth": {"advancers": 1200, "decliners": 800, "asOfDate": "2026-11-26"},
            "benchmark": {"ticker": "NIFTY", "price": 25884.5, "changePct": 0.25, "aboveSma50": True},
            "excludedAssetIds": [],
            "excludedCounts": {"adverseNews": 0, "resultsBlackout": 0},
            "newsNotes": {},
            "strongRows": [],
            "obsRows": [
                {"assetId": "e-1", "ticker": "PSUBNKBEES", "name": "Nippon India ETF PSU Bank", "exchange": "NSE", "engine": "MOMENTUM_IGNITION", "status": "EARLY_WATCH", "livePrice": 90},
                {"assetId": "e-2", "ticker": "PVTBANIETF", "name": "ICICI Pru Pvt Bank ETF", "exchange": "NSE", "engine": "MOMENTUM_IGNITION", "status": "EARLY_WATCH", "livePrice": 28},
                {"assetId": "e-3", "ticker": "SBIBANKNIF", "name": "SBI Nifty Bank ETF", "exchange": "NSE", "engine": "MOMENTUM_IGNITION", "status": "EARLY_WATCH", "livePrice": 520},
                {"assetId": "s-1", "ticker": "PRESTIGE", "name": "Prestige Estates", "exchange": "NSE", "engine": "MOMENTUM_IGNITION", "status": "EARLY_WATCH", "livePrice": 1685},
            ],
            "trendRows": [],
            "swingRows": [],
            "pullbackRows": [
                {"assetId": "p-small", "ticker": "SMALLCAP", "name": "Small Cap Ltd", "exchange": "NSE", "close": 100, "livePrice": 100, "rsi14": 60, "atrPct": 3.5, "volumeRatio": 0.8, "return20d": 18.0, "distanceSma20Pct": 4.5, "distanceSma200Pct": 12.0, "tradedValue": 12_000_000},
                {"assetId": "p-inst", "ticker": "INSTLEADER", "name": "Inst Leader Ltd", "exchange": "NSE", "close": 1685, "livePrice": 1685, "rsi14": 63, "atrPct": 3.0, "volumeRatio": 1.56, "return20d": 18.5, "distanceSma20Pct": 5.3, "distanceSma200Pct": 13.8, "tradedValue": 1_690_000_000},
            ],
            "snapbackRows": [],
        })
        self.assertEqual([c["ticker"] for c in out["buckets"]["NEAR_TRIGGER"]], ["PRESTIGE"])
        self.assertEqual(out["buckets"]["MID_TREND_PULLBACK"][0]["ticker"], "INSTLEADER")


    def test_turnover_bonus_is_equal_at_the_same_multiple_of_market_floor(self):
        def score(market, traded_value):
            result = assess({
                "market": market,
                "pullbackRows": [{
                    "assetId": "stock", "ticker": "EQUITY", "close": 100,
                    "return20d": 12, "volumeRatio": 1, "tradedValue": traded_value,
                }],
            })
            return result["buckets"]["MID_TREND_PULLBACK"][0]["score"]

        self.assertEqual(score("IN", 30_000_000), score("US", 3_000_000))
        self.assertGreater(score("US", 3_000_000), score("US", 1_000_000))


if __name__ == "__main__":
    unittest.main()
