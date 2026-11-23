#!/usr/bin/env python3
"""Label matured Strong Swing ML feature snapshots into public.ml_labels.

Uses the deterministic first-touch policy in pipelines/ml/labeler.py.
Snapshots whose entry or holding window has not yet matured are skipped so
they are labeled cleanly on a later post-close run.
"""

from __future__ import annotations

import argparse
import json
import os
from datetime import date
from decimal import Decimal

from labeler import Bar, LabelOutcome, LabelingPolicy, label_candidate

ENTRY_WINDOW_SESSIONS = 5
ZERO = Decimal("0")
HUNDRED = Decimal("100")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL"), required=False)
    parser.add_argument("--market", choices=("IN", "US"), required=True)
    parser.add_argument("--limit", type=int, default=5000)
    args = parser.parse_args()
    if not args.database_url:
        parser.error("--database-url or DATABASE_URL is required")
    return args


def policy_for_market(market: str, calendar_version: str) -> LabelingPolicy:
    return LabelingPolicy(calendar_version=calendar_version or ("NSE-calendar-v1" if market == "IN" else "NYSE-calendar-v1"))


def derive_atr_and_trail(
    entry: Decimal,
    stop: Decimal,
    trail: Decimal,
    metrics: dict[str, object],
) -> tuple[Decimal, Decimal]:
    atr_pct_raw = metrics.get("atrPct")
    atr = ZERO
    if atr_pct_raw is not None and not isinstance(atr_pct_raw, bool):
        try:
            atr = entry * Decimal(str(atr_pct_raw)) / HUNDRED
        except Exception:
            atr = ZERO
    if atr <= ZERO and entry > stop:
        atr = (entry - stop) / Decimal("1.5")
    trail_distance = entry - trail if entry > trail else atr * Decimal("2")
    if trail_distance <= ZERO and atr > ZERO:
        trail_distance = atr * Decimal("2")
    return atr, trail_distance


def should_defer(result_outcome: LabelOutcome, invalid_reason: str | None, bar_count: int) -> bool:
    """Return True when the snapshot has not had enough future sessions to finalize."""
    if result_outcome == LabelOutcome.INVALID_DATA and invalid_reason == "holding window extends beyond supplied sessions":
        return True
    if result_outcome == LabelOutcome.NOT_ENTERED and bar_count < ENTRY_WINDOW_SESSIONS:
        return True
    return False


def load_unlabeled(cur, market: str, limit: int) -> list[dict[str, object]]:
    cur.execute(
        """
        select f.id::text feature_snapshot_id,
               f.asset_id::text asset_id,
               f.asof_market_date,
               f.calendar_version,
               s.confirmation_entry,
               s.projected_stop,
               s.projected_target,
               s.projected_trail,
               s.expected_days,
               s.metrics
          from public.ml_feature_snapshots f
          join public.strong_swing_snapshots s on s.snapshot_id = f.candidate_snapshot_id
         where f.market = %s
           and not exists (
             select 1 from public.ml_labels l
              where l.feature_snapshot_id = f.id
                and l.label_version = %s
                and l.trailing_policy_version = %s
                and l.entry_fill_policy_version = %s
                and l.calendar_version = f.calendar_version
           )
         order by f.asof_market_date asc, f.id asc
         limit %s
        """,
        (
            market,
            LabelingPolicy.label_version,
            LabelingPolicy.trailing_policy_version,
            LabelingPolicy.entry_fill_policy_version,
            limit,
        ),
    )
    columns = [item.name for item in cur.description]
    return [dict(zip(columns, row)) for row in cur.fetchall()]


def load_forward_bars(cur, asset_id: str, asof_date: date, max_sessions: int) -> list[Bar]:
    cur.execute(
        """
        select date, open, high, low, close
          from public.daily_ohlcv
         where asset_id = %s and date > %s
         order by date asc
         limit %s
        """,
        (asset_id, asof_date, max_sessions),
    )
    return [
        Bar(
            session=row[0],
            open=Decimal(str(row[1])),
            high=Decimal(str(row[2])),
            low=Decimal(str(row[3])),
            close=Decimal(str(row[4])),
        )
        for row in cur.fetchall()
    ]


def run(conn, market: str, limit: int = 5000) -> dict[str, int]:
    from psycopg2.extras import Json

    counts = {"labeled": 0, "deferred": 0, "skipped": 0}
    tick_size = Decimal("0.05") if market == "IN" else Decimal("0.01")

    with conn.cursor() as cur:
        rows = load_unlabeled(cur, market, limit)
        for row in rows:
            asof_date: date = row["asof_market_date"]
            entry = Decimal(str(row["confirmation_entry"]))
            stop = Decimal(str(row["projected_stop"]))
            target = Decimal(str(row["projected_target"]))
            trail = Decimal(str(row["projected_trail"]))
            holding_sessions = max(5, min(40, int(row["expected_days"] or 15)))
            metrics = row["metrics"] if isinstance(row["metrics"], dict) else json.loads(row["metrics"] or "{}")
            atr, trail_distance = derive_atr_and_trail(entry, stop, trail, metrics)
            policy = policy_for_market(market, str(row["calendar_version"]))

            bars = load_forward_bars(cur, str(row["asset_id"]), asof_date, holding_sessions + ENTRY_WINDOW_SESSIONS)
            if not bars:
                counts["deferred"] += 1
                continue

            result = label_candidate(
                bars,
                expected_sessions=[bar.session for bar in bars],
                confirmation_entry=entry,
                initial_stop=stop,
                target=target,
                projected_trail=trail,
                trailing_distance=trail_distance,
                atr=atr,
                holding_sessions=holding_sessions,
                tick_size=tick_size,
                policy=policy,
            )

            if should_defer(result.outcome, result.invalid_reason, len(bars)):
                counts["deferred"] += 1
                continue

            cur.execute(
                """
                insert into public.ml_labels (
                  feature_snapshot_id, market, asset_id, asof_market_date,
                  outcome, binary_target, realized_return,
                  max_favorable_excursion, max_adverse_excursion, sessions_to_outcome,
                  entry_session, entry_price, exit_session, exit_price,
                  entry_used, initial_stop_used, target_used, trailing_distance_used,
                  charges_bps, slippage_bps_per_side,
                  entry_fill_policy_version, trailing_policy_version, label_version, calendar_version,
                  invalid_reason, path_json
                )
                values (
                  %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s
                )
                on conflict (feature_snapshot_id, label_version, trailing_policy_version, entry_fill_policy_version, calendar_version)
                do nothing
                returning id
                """,
                (
                    row["feature_snapshot_id"], market, row["asset_id"], asof_date,
                    result.outcome.value, result.binary_target, result.realized_return,
                    result.max_favorable_excursion, result.max_adverse_excursion, result.sessions_to_outcome,
                    result.entry_session, result.entry_price, result.exit_session, result.exit_price,
                    entry, stop, target, trail_distance,
                    policy.charges_bps_round_trip, policy.slippage_bps_per_side,
                    policy.entry_fill_policy_version, policy.trailing_policy_version,
                    policy.label_version, policy.calendar_version,
                    result.invalid_reason, Json(result.serializable()),
                ),
            )
            if cur.fetchone() is None:
                counts["skipped"] += 1
            else:
                counts["labeled"] += 1
    return counts


def main() -> None:
    import psycopg2

    args = parse_args()
    with psycopg2.connect(args.database_url) as conn:
        with conn.cursor() as cur:
            cur.execute("select pg_advisory_xact_lock(hashtext(%s))", (f"ml-labeler:{args.market}",))
        counts = run(conn, args.market, args.limit)
    print(json.dumps({"market": args.market, **counts}, sort_keys=True))


if __name__ == "__main__":
    main()
