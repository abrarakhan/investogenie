import os
import sys
import unittest
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from train import Sample, active_features, build_walk_forward_folds, evaluate_walk_forward, roc_auc


class TrainWalkForwardTests(unittest.TestCase):
    def test_roc_auc_exact_and_handles_ties(self):
        self.assertAlmostEqual(roc_auc([0, 0, 1, 1], [0.1, 0.2, 0.8, 0.9]), 1.0)
        self.assertAlmostEqual(roc_auc([0, 0, 1, 1], [0.5, 0.5, 0.5, 0.5]), 0.5)
        self.assertIsNone(roc_auc([0, 0, 0], [0.1, 0.2, 0.3]))

    def test_walk_forward_folds_respect_purge_gap(self):
        days = [date(2026, 1, 1) + timedelta(days=i) for i in range(40)]
        folds = build_walk_forward_folds(days, n_folds=4, purge_sessions=3)
        self.assertGreaterEqual(len(folds), 3)
        for train_end, test_start, test_end in folds:
            self.assertLess(train_end, test_start)
            self.assertLessEqual(test_start, test_end)
            # At least 3 sessions strictly between train_end and test_start
            self.assertGreaterEqual((test_start - train_end).days, 4)

    def test_evaluate_walk_forward_learns_separable_signal(self):
        samples = []
        base_day = date(2026, 1, 1)
        for day_idx in range(36):
            d = base_day + timedelta(days=day_idx)
            for stock_idx in range(12):
                is_win = 1 if stock_idx >= 9 else 0
                # Strong synthetic feature (rsi14 & news_weighted_sentiment) vs noisy baseline strength_score
                rsi = 65.0 + stock_idx if is_win else 40.0 + stock_idx
                sent = 0.7 if is_win else -0.4
                samples.append(
                    Sample(
                        asof_date=d,
                        asset_id=f"a-{stock_idx}",
                        candidate_status="EXECUTION_READY",
                        strength_score=50.0 + (stock_idx % 5),
                        target=is_win,
                        realized_return=0.08 if is_win else -0.04,
                        features={
                            "rsi14": rsi,
                            "news_weighted_sentiment": sent,
                            "news_impact_count": 2.0,
                            "strength_score": 50.0 + (stock_idx % 5),
                        },
                    )
                )
        feats = active_features(samples)
        report = evaluate_walk_forward(samples, feats, n_folds=3, purge_sessions=2, l2=1.0)
        self.assertGreater(report["oos_ml_auc"], 0.9)
        self.assertGreater(report["oos_ml_auc"], report["oos_baseline_auc"])
        self.assertGreater(report["top_quartile_win_rate"], report["bottom_quartile_win_rate"])
        self.assertEqual(report["verdict"], "READY_FOR_SHADOW")


if __name__ == "__main__":
    unittest.main()
