import unittest

from strategy_math.sector_thrust import assess_market_checkpoint


CURVE = [[0.0, 0.0], [0.25, 0.30], [0.5, 0.55], [0.75, 0.78], [1.0, 1.0]]


def _asset(
    aid: str,
    ticker: str,
    name: str,
    sector: str,
    prev_close: float,
    price: float,
    session_vol: float,
    avg_vol: float = 100_000,
    avg_val: float = 50_000_000,
    atr_pct: float = 3.5,
    price_fresh: bool = True,
    vol_fresh: bool = True,
    exchange: str = "NSE",
    is_etf: bool = False,
):
    return {
        "assetId": aid,
        "ticker": ticker,
        "name": name,
        "sector": sector,
        "exchange": exchange,
        "prevClose": prev_close,
        "price": price,
        "priceFresh": price_fresh,
        "sessionVolume": session_vol,
        "volumeFresh": vol_fresh,
        "avgVolume20d": avg_vol,
        "avgTradedValue20d": avg_val,
        "atrPct": atr_pct,
        "isEtf": is_etf,
    }


class SectorThrustTests(unittest.TestCase):
    def test_narrow_sugar_industry_fires_while_parent_consumer_defensive_is_quiet(self):
        assets = [
            # 5 Sugar stocks: 4 surging, 1 in Catch-Up Watch (+2.0%, <= 1 ATR of 3.5%)
            _asset("s1", "DHAMPURSUG", "Dhampur Sugar Mills", "Consumer Defensive", 160, 180, 120_000),
            _asset("s2", "UTTAMSUGAR", "Uttam Sugar Mills", "Consumer Defensive", 345, 385, 110_000),
            _asset("s3", "BALRAMCHIN", "Balrampur Chini Mills", "Consumer Defensive", 500, 540, 95_000),
            _asset("s4", "DWARKESH", "Dwarikesh Sugar", "Consumer Defensive", 60, 65.5, 90_000),
            _asset("s5", "AVADHSUGAR", "Avadh Sugar", "Consumer Defensive", 400, 408, 70_000),
            # 12 quiet Consumer Defensive FMCG stocks so parent sector stays quiet
            *[
                _asset(f"f{i}", f"FMCG{i}", f"Consumer Co {i}", "Consumer Defensive", 200, 200.5, 50_000)
                for i in range(12)
            ],
        ]
        out = assess_market_checkpoint({
            "market": "IN",
            "mode": "LIVE",
            "sessionDate": "2026-11-26",
            "checkpointAt": "2026-11-26T05:00:00Z",
            "sessionProgress": 0.5,
            "volumeCurvePoints": CURVE,
            "curveVersion": "in-test-v1",
            "assets": assets,
            "articles": [
                {"title": "ISMA cuts 2026-27 India sugar output forecast by 15%", "source": "Reuters", "publishedAt": "2026-11-26T04:45:00Z"}
            ],
        })
        by_key = {(g["groupLevel"], g["groupKey"]): g for g in out["groups"]}
        sugar = by_key[("INDUSTRY", "sugar_ethanol")]
        parent = by_key[("SECTOR", "consumer_defensive")]
        self.assertEqual(sugar["status"], "ACTIVE")
        self.assertEqual(sugar["volumeConfirmationRoute"], "MEDIAN_PACE")
        self.assertEqual([m["ticker"] for m in sugar["leaders"]], ["DHAMPURSUG", "UTTAMSUGAR", "DWARKESH", "BALRAMCHIN"])
        self.assertEqual([m["ticker"] for m in sugar["catchUp"]], ["AVADHSUGAR"])
        self.assertAlmostEqual(sugar["catchUp"][0]["atrExtension"], 0.57, places=2)
        self.assertEqual(len(sugar["relatedNews"]), 1)
        self.assertEqual(parent["status"], "WATCH")

    def test_duplicate_nse_bse_listings_counted_once_and_single_spike_ignored(self):
        assets = [
            _asset("a1-nse", "DHAMPURSUG", "Dhampur Sugar", "Consumer Defensive", 160, 185, 200_000, exchange="NSE"),
            _asset("a1-bse", "DHAMPURSUG", "Dhampur Sugar", "Consumer Defensive", 160, 185, 200_000, exchange="BSE"),
            _asset("a2", "UTTAMSUGAR", "Uttam Sugar", "Consumer Defensive", 350, 351, 50_000),
            _asset("a3", "BALRAMCHIN", "Balrampur Chini", "Consumer Defensive", 500, 501, 50_000),
            _asset("a4", "DWARKESH", "Dwarikesh Sugar", "Consumer Defensive", 60, 60.2, 50_000),
        ]
        out = assess_market_checkpoint({
            "market": "IN",
            "mode": "LIVE",
            "sessionDate": "2026-11-26",
            "checkpointAt": "2026-11-26T05:00:00Z",
            "sessionProgress": 0.5,
            "volumeCurvePoints": CURVE,
            "assets": assets,
        })
        sugar = next(g for g in out["groups"] if g["groupKey"] == "sugar_ethanol")
        self.assertEqual(sugar["eligibleCount"], 4)  # DHAMPURSUG counted once
        self.assertEqual(sugar["status"], "WATCH")  # single-stock spike cannot fire

    def test_stale_volume_with_fresh_price_stays_unverified(self):
        assets = [
            _asset("s1", "DHAMPURSUG", "Dhampur Sugar", "Consumer Defensive", 160, 180, 200_000, price_fresh=True, vol_fresh=False),
            _asset("s2", "UTTAMSUGAR", "Uttam Sugar", "Consumer Defensive", 345, 385, 200_000, price_fresh=True, vol_fresh=False),
            _asset("s3", "BALRAMCHIN", "Balrampur Chini", "Consumer Defensive", 500, 540, 200_000, price_fresh=True, vol_fresh=False),
            _asset("s4", "DWARKESH", "Dwarikesh Sugar", "Consumer Defensive", 60, 66, 200_000, price_fresh=True, vol_fresh=False),
        ]
        out = assess_market_checkpoint({
            "market": "IN",
            "mode": "LIVE",
            "sessionDate": "2026-11-26",
            "checkpointAt": "2026-11-26T05:00:00Z",
            "sessionProgress": 0.5,
            "volumeCurvePoints": CURVE,
            "assets": assets,
        })
        sugar = next(g for g in out["groups"] if g["groupKey"] == "sugar_ethanol")
        self.assertEqual(sugar["status"], "UNVERIFIED")
        self.assertEqual(sugar["volumeFreshCount"], 0)

    def test_missing_volume_curve_in_live_mode_returns_unverified(self):
        assets = [
            _asset("s1", "DHAMPURSUG", "Dhampur Sugar", "Consumer Defensive", 160, 180, 200_000),
            _asset("s2", "UTTAMSUGAR", "Uttam Sugar", "Consumer Defensive", 345, 385, 200_000),
            _asset("s3", "BALRAMCHIN", "Balrampur Chini", "Consumer Defensive", 500, 540, 200_000),
        ]
        out = assess_market_checkpoint({
            "market": "IN",
            "mode": "LIVE",
            "sessionDate": "2026-11-26",
            "checkpointAt": "2026-11-26T05:00:00Z",
            "sessionProgress": 0.5,
            "volumeCurvePoints": None,
            "assets": assets,
        })
        self.assertEqual(out["status"], "UNVERIFIED")
        sugar = next(g for g in out["groups"] if g["groupKey"] == "sugar_ethanol")
        self.assertEqual(sugar["status"], "UNVERIFIED")

    def test_faded_group_preserves_first_triggered_at(self):
        assets = [
            _asset("s1", "DHAMPURSUG", "Dhampur Sugar", "Consumer Defensive", 160, 161, 100_000),
            _asset("s2", "UTTAMSUGAR", "Uttam Sugar", "Consumer Defensive", 345, 346, 100_000),
            _asset("s3", "BALRAMCHIN", "Balrampur Chini", "Consumer Defensive", 500, 502, 100_000),
        ]
        out = assess_market_checkpoint({
            "market": "IN",
            "mode": "LIVE",
            "sessionDate": "2026-11-26",
            "checkpointAt": "2026-11-26T08:00:00Z",
            "sessionProgress": 0.8,
            "volumeCurvePoints": CURVE,
            "priorGroupTriggers": {"INDUSTRY:sugar_ethanol": "2026-11-26T04:30:00Z"},
            "assets": assets,
        })
        sugar = next(g for g in out["groups"] if g["groupKey"] == "sugar_ethanol")
        self.assertEqual(sugar["status"], "FADED")
        self.assertEqual(sugar["firstTriggeredAt"], "2026-11-26T04:30:00Z")


if __name__ == "__main__":
    unittest.main()
