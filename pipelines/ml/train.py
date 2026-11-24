#!/usr/bin/env python3
"""Walk-forward ML trainer and evaluator for Strong Swing (+ point-in-time news) labels.

Pure-Python / zero extra ML dependencies (no scikit-learn/lightgbm required).
Trains an L2-regularized Logistic Regression classifier using expanding-window,
purged walk-forward splits and compares out-of-sample AUC, Brier calibration,
and top-vs-bottom quartile realized return against the deterministic strengthScore.

Read-only against Postgres; writes a self-contained JSON model artifact only
when --save-artifact is provided. Never alters live execution gates.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Sequence

NUMERIC_FEATURES = (
    "close_vs_ema20_pct",
    "close_vs_ema50_pct",
    "ema20_vs_ema50_pct",
    "rsi14",
    "macd_hist_atr",
    "atr_pct",
    "volume_ratio_20",
    "five_day_return_pct",
    "ten_day_return_pct",
    "distance_from_52w_high_pct",
    "stop_distance_atr",
    "reward_risk_ratio",
    "strength_score",
    # Point-in-time news & results features (added in c9c2ad0; safely imputed when absent)
    "news_impact_count",
    "news_positive_count",
    "news_negative_count",
    "news_weighted_sentiment",
    "news_max_severity",
    "days_to_results",
)


@dataclass(frozen=True)
class Sample:
    asof_date: date
    asset_id: str
    candidate_status: str
    strength_score: float
    target: int
    realized_return: float
    features: dict[str, float | None]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL"), required=False)
    parser.add_argument("--market", choices=("IN", "US"), default="IN")
    parser.add_argument("--l2", type=float, default=2.0, help="L2 regularization strength")
    parser.add_argument("--folds", type=int, default=4, help="Number of expanding walk-forward folds")
    parser.add_argument("--purge-sessions", type=int, default=3, help="Purge gap in trading dates between train and test")
    parser.add_argument("--save-artifact", default=None, help="Optional path to save trained JSON model artifact")
    args = parser.parse_args()
    if not args.database_url:
        parser.error("--database-url or DATABASE_URL is required")
    return args


def _to_float(value: object) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        num = float(value)
        return num if math.isfinite(num) else None
    except (TypeError, ValueError):
        return None


def _sigmoid(z: float) -> float:
    if z >= 35.0:
        return 1.0
    if z <= -35.0:
        return 0.0
    return 1.0 / (1.0 + math.exp(-z))


def roc_auc(y_true: Sequence[int], scores: Sequence[float]) -> float | None:
    """Exact ROC-AUC via average ranks (handles ties cleanly)."""
    n_pos = sum(1 for y in y_true if y == 1)
    n_neg = len(y_true) - n_pos
    if n_pos == 0 or n_neg == 0:
        return None
    paired = sorted(zip(scores, y_true), key=lambda item: item[0])
    rank_sum_pos = 0.0
    i = 0
    n = len(paired)
    while i < n:
        j = i
        while j + 1 < n and paired[j + 1][0] == paired[i][0]:
            j += 1
        avg_rank = (i + j + 2) / 2.0  # 1-based average rank
        pos_in_tie = sum(1 for k in range(i, j + 1) if paired[k][1] == 1)
        rank_sum_pos += pos_in_tie * avg_rank
        i = j + 1
    return (rank_sum_pos - n_pos * (n_pos + 1) / 2.0) / (n_pos * n_neg)


def brier_score(y_true: Sequence[int], probs: Sequence[float]) -> float:
    if not y_true:
        return 0.0
    return sum((p - y) ** 2 for y, p in zip(y_true, probs)) / len(y_true)


def log_loss(y_true: Sequence[int], probs: Sequence[float]) -> float:
    if not y_true:
        return 0.0
    eps = 1e-12
    total = 0.0
    for y, p in zip(y_true, probs):
        pc = min(1.0 - eps, max(eps, p))
        total += -(y * math.log(pc) + (1 - y) * math.log(1.0 - pc))
    return total / len(y_true)


class LogisticModel:
    """Deterministic L2-regularized logistic regression with median imputation & z-scaling."""

    def __init__(self, feature_names: Sequence[str], l2: float = 2.0):
        self.feature_names = list(feature_names)
        self.l2 = l2
        self.medians: list[float] = [0.0] * len(self.feature_names)
        self.means: list[float] = [0.0] * len(self.feature_names)
        self.stds: list[float] = [1.0] * len(self.feature_names)
        self.weights: list[float] = [0.0] * len(self.feature_names)
        self.bias: float = 0.0

    def _fit_scaler(self, rows: Sequence[dict[str, float | None]]) -> list[list[float]]:
        d = len(self.feature_names)
        raw_cols: list[list[float]] = [[] for _ in range(d)]
        for row in rows:
            for idx, name in enumerate(self.feature_names):
                val = row.get(name)
                if val is not None and math.isfinite(val):
                    raw_cols[idx].append(val)
        for idx, col in enumerate(raw_cols):
            if not col:
                self.medians[idx] = 0.0
            else:
                s = sorted(col)
                mid = len(s) // 2
                self.medians[idx] = s[mid] if len(s) % 2 else (s[mid - 1] + s[mid]) / 2.0

        imputed: list[list[float]] = []
        for row in rows:
            vec = []
            for idx, name in enumerate(self.feature_names):
                val = row.get(name)
                vec.append(val if (val is not None and math.isfinite(val)) else self.medians[idx])
            imputed.append(vec)

        n = max(1, len(imputed))
        for idx in range(d):
            mean = sum(vec[idx] for vec in imputed) / n
            var = sum((vec[idx] - mean) ** 2 for vec in imputed) / n
            self.means[idx] = mean
            self.stds[idx] = math.sqrt(var) if var > 1e-12 else 1.0

        return [[(vec[idx] - self.means[idx]) / self.stds[idx] for idx in range(d)] for vec in imputed]

    def _transform(self, row: dict[str, float | None]) -> list[float]:
        out = []
        for idx, name in enumerate(self.feature_names):
            val = row.get(name)
            v = val if (val is not None and math.isfinite(val)) else self.medians[idx]
            out.append((v - self.means[idx]) / self.stds[idx])
        return out

    def fit(self, rows: Sequence[dict[str, float | None]], y: Sequence[int], steps: int = 300, lr: float = 0.15) -> None:
        X = self._fit_scaler(rows)
        n = len(X)
        d = len(self.feature_names)
        if n == 0:
            return
        pos_rate = min(0.99, max(0.01, sum(y) / n))
        self.bias = math.log(pos_rate / (1.0 - pos_rate))
        self.weights = [0.0] * d

        for _ in range(steps):
            grad_w = [0.0] * d
            grad_b = 0.0
            for xi, yi in zip(X, y):
                z = self.bias + sum(wj * xj for wj, xj in zip(self.weights, xi))
                err = _sigmoid(z) - yi
                grad_b += err
                for j in range(d):
                    grad_w[j] += err * xi[j]
            inv_n = 1.0 / n
            self.bias -= lr * (grad_b * inv_n)
            for j in range(d):
                self.weights[j] -= lr * (grad_w[j] * inv_n + (self.l2 * inv_n) * self.weights[j])

    def predict_proba(self, rows: Sequence[dict[str, float | None]]) -> list[float]:
        probs = []
        for row in rows:
            xi = self._transform(row)
            z = self.bias + sum(wj * xj for wj, xj in zip(self.weights, xi))
            probs.append(_sigmoid(z))
        return probs


def build_walk_forward_folds(
    dates: Sequence[date],
    n_folds: int,
    purge_sessions: int,
) -> list[tuple[date, date, date]]:
    """Return list of (train_end, test_start, test_end) on unique sorted trading dates."""
    unique_dates = sorted(set(dates))
    total = len(unique_dates)
    if total < 6:
        return []
    purge = max(1, min(purge_sessions, total // 6))
    min_train = max(3, total // 3)
    usable = total - min_train - purge
    if usable < 2:
        return []
    actual_folds = max(1, min(n_folds, usable))
    step = max(1, usable // actual_folds)
    folds: list[tuple[date, date, date]] = []
    for k in range(actual_folds):
        test_start_idx = min_train + purge + k * step
        test_end_idx = (total - 1) if k == actual_folds - 1 else min(total - 1, test_start_idx + step - 1)
        train_end_idx = test_start_idx - purge - 1
        if train_end_idx < 1 or test_start_idx > test_end_idx:
            continue
        folds.append((unique_dates[train_end_idx], unique_dates[test_start_idx], unique_dates[test_end_idx]))
    return folds


def evaluate_walk_forward(
    samples: Sequence[Sample],
    feature_names: Sequence[str],
    *,
    n_folds: int = 4,
    purge_sessions: int = 3,
    l2: float = 2.0,
) -> dict[str, object]:
    folds = build_walk_forward_folds([s.asof_date for s in samples], n_folds=n_folds, purge_sessions=purge_sessions)
    oos_y: list[int] = []
    oos_prob: list[float] = []
    oos_base: list[float] = []
    oos_ret: list[float] = []
    fold_reports: list[dict[str, object]] = []

    for idx, (train_end, test_start, test_end) in enumerate(folds, 1):
        train_rows = [s for s in samples if s.asof_date <= train_end]
        test_rows = [s for s in samples if test_start <= s.asof_date <= test_end]
        if len(train_rows) < 20 or not test_rows:
            continue
        model = LogisticModel(feature_names, l2=l2)
        model.fit([s.features for s in train_rows], [s.target for s in train_rows])
        probs = model.predict_proba([s.features for s in test_rows])
        ty = [s.target for s in test_rows]
        tb = [s.strength_score for s in test_rows]
        oos_y.extend(ty)
        oos_prob.extend(probs)
        oos_base.extend(tb)
        oos_ret.extend(s.realized_return for s in test_rows)
        fold_reports.append({
            "fold": idx,
            "train_end": train_end.isoformat(),
            "test_start": test_start.isoformat(),
            "test_end": test_end.isoformat(),
            "train_n": len(train_rows),
            "test_n": len(test_rows),
            "test_wins": sum(ty),
            "ml_auc": round(roc_auc(ty, probs), 4) if roc_auc(ty, probs) is not None else None,
            "baseline_auc": round(roc_auc(ty, tb), 4) if roc_auc(ty, tb) is not None else None,
            "brier": round(brier_score(ty, probs), 4),
        })

    # Fit final model on all samples for weight inspection / optional artifact
    final_model = LogisticModel(feature_names, l2=l2)
    final_model.fit([s.features for s in samples], [s.target for s in samples])

    ml_auc = roc_auc(oos_y, oos_prob)
    base_auc = roc_auc(oos_y, oos_base)
    ml_brier = brier_score(oos_y, oos_prob) if oos_y else None
    base_rate = (sum(oos_y) / len(oos_y)) if oos_y else 0.0
    naive_brier = brier_score(oos_y, [base_rate] * len(oos_y)) if oos_y else None

    # Top-quartile vs bottom-quartile realized performance
    top_q_win = bot_q_win = top_q_ret = bot_q_ret = None
    if len(oos_y) >= 20:
        order = sorted(range(len(oos_y)), key=lambda i: oos_prob[i])
        q = max(1, len(order) // 4)
        bot = order[:q]
        top = order[-q:]
        top_q_win = sum(oos_y[i] for i in top) / len(top)
        bot_q_win = sum(oos_y[i] for i in bot) / len(bot)
        top_q_ret = sum(oos_ret[i] for i in top) / len(top)
        bot_q_ret = sum(oos_ret[i] for i in bot) / len(bot)

    distinct_dates = len({s.asof_date for s in samples})
    with_news = sum(1 for s in samples if (s.features.get("news_impact_count") or 0) > 0)
    ready_reasons: list[str] = []
    if len(samples) < 300:
        ready_reasons.append(f"need >= 300 entered samples (have {len(samples)})")
    if distinct_dates < 30:
        ready_reasons.append(f"need >= 30 trading dates across regimes (have {distinct_dates})")
    if ml_auc is None or ml_auc < 0.58:
        ready_reasons.append(f"OOS AUC below 0.58 gate ({None if ml_auc is None else round(ml_auc, 4)})")
    if ml_auc is not None and base_auc is not None and ml_auc <= base_auc:
        ready_reasons.append(f"OOS AUC ({ml_auc:.4f}) did not beat strengthScore baseline ({base_auc:.4f})")
    if ml_brier is not None and naive_brier is not None and ml_brier >= naive_brier:
        ready_reasons.append("OOS Brier score did not beat naive base-rate calibration")

    verdict = "READY_FOR_SHADOW" if not ready_reasons else "HOLD_COLLECT_MORE_DATA"
    ranked_weights = sorted(
        zip(final_model.feature_names, final_model.weights),
        key=lambda item: abs(item[1]),
        reverse=True,
    )

    return {
        "samples": len(samples),
        "distinct_dates": distinct_dates,
        "wins": sum(s.target for s in samples),
        "samples_with_news": with_news,
        "oos_samples": len(oos_y),
        "oos_ml_auc": round(ml_auc, 4) if ml_auc is not None else None,
        "oos_baseline_auc": round(base_auc, 4) if base_auc is not None else None,
        "oos_brier": round(ml_brier, 4) if ml_brier is not None else None,
        "oos_naive_brier": round(naive_brier, 4) if naive_brier is not None else None,
        "oos_log_loss": round(log_loss(oos_y, oos_prob), 4) if oos_y else None,
        "top_quartile_win_rate": round(top_q_win, 4) if top_q_win is not None else None,
        "bottom_quartile_win_rate": round(bot_q_win, 4) if bot_q_win is not None else None,
        "top_quartile_avg_ret_pct": round(top_q_ret * 100, 2) if top_q_ret is not None else None,
        "bottom_quartile_avg_ret_pct": round(bot_q_ret * 100, 2) if bot_q_ret is not None else None,
        "verdict": verdict,
        "gate_notes": ready_reasons,
        "folds": fold_reports,
        "top_feature_weights": [{"feature": name, "weight": round(w, 4)} for name, w in ranked_weights[:10]],
        "model_state": {
            "feature_names": final_model.feature_names,
            "medians": final_model.medians,
            "means": final_model.means,
            "stds": final_model.stds,
            "weights": final_model.weights,
            "bias": final_model.bias,
            "l2": l2,
        },
    }


def load_labeled_samples(database_url: str, market: str) -> list[Sample]:
    import psycopg2

    samples: list[Sample] = []
    with psycopg2.connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select f.asof_market_date,
                       f.asset_id::text,
                       f.candidate_status,
                       s.strength_score,
                       f.feature_values,
                       l.binary_target,
                       l.realized_return
                  from public.ml_labels l
                  join public.ml_feature_snapshots f on f.id = l.feature_snapshot_id
                  join public.strong_swing_snapshots s on s.snapshot_id = f.candidate_snapshot_id
                 where l.market = %s
                   and l.binary_target is not null
                 order by f.asof_market_date asc, f.asset_id asc
                """,
                (market,),
            )
            for asof_date, asset_id, status, strength_score, raw_features, binary_target, realized_return in cur.fetchall():
                fv = raw_features if isinstance(raw_features, dict) else json.loads(raw_features or "{}")
                feats: dict[str, float | None] = {name: _to_float(fv.get(name)) for name in NUMERIC_FEATURES}
                feats["strength_score"] = _to_float(strength_score)
                samples.append(
                    Sample(
                        asof_date=asof_date,
                        asset_id=asset_id,
                        candidate_status=str(status),
                        strength_score=float(strength_score),
                        target=int(binary_target),
                        realized_return=float(realized_return or 0.0),
                        features=feats,
                    )
                )
    return samples


def active_features(samples: Sequence[Sample]) -> list[str]:
    """Keep only features that are present in at least 5% of samples with non-zero variance."""
    names: list[str] = []
    threshold = max(1, int(len(samples) * 0.05))
    for name in NUMERIC_FEATURES:
        vals = [s.features[name] for s in samples if s.features.get(name) is not None]
        if len(vals) >= threshold and (max(vals) - min(vals)) > 1e-12:
            names.append(name)
    return names


def main() -> None:
    args = parse_args()
    samples = load_labeled_samples(args.database_url, args.market)
    if not samples:
        print(json.dumps({"market": args.market, "samples": 0, "verdict": "NO_LABELED_DATA"}))
        return
    feats = active_features(samples)
    report = evaluate_walk_forward(
        samples,
        feats,
        n_folds=args.folds,
        purge_sessions=args.purge_sessions,
        l2=args.l2,
    )
    model_state = report.pop("model_state")
    if args.save_artifact:
        artifact = {
            "market": args.market,
            "training_start_date": samples[0].asof_date.isoformat(),
            "training_cutoff": samples[-1].asof_date.isoformat(),
            "metrics": report,
            "model": model_state,
        }
        encoded = json.dumps(artifact, sort_keys=True, indent=2).encode("utf-8")
        sha256 = hashlib.sha256(encoded).hexdigest()
        out_path = Path(args.save_artifact)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(encoded)
        report["artifact_path"] = str(out_path)
        report["artifact_sha256"] = sha256

    print(json.dumps({"market": args.market, **report}, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
