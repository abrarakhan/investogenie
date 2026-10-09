#!/usr/bin/env python3
"""Persist canonical Python-calculated ML features for one scheduler run."""

from __future__ import annotations

import argparse
import json
import os
from decimal import Decimal

import psycopg2
from psycopg2.extras import Json

from features import FeatureBar, build_feature_vector, liquidity_bucket


FEATURE_VERSION = "strong-swing-features-v1"
INCLUSION_POLICY_VERSION = "strong-swing-entry-eligible-v1"
UNIVERSE_VERSION = "strong-swing-candidate-universe-v1"
INCLUDED_STATUSES = {"EXECUTION_READY", "WAIT_FOR_ENTRY"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL"), required=False)
    parser.add_argument("--scheduler-run-id", required=True)
    parser.add_argument("--market", choices=("IN", "US"), required=True)
    parser.add_argument("--market-date", required=True)
    args = parser.parse_args()
    if not args.database_url:
        parser.error("--database-url or DATABASE_URL is required")
    return args


def load_snapshots(cur, scheduler_run_id: str, market: str, market_date: str) -> list[dict[str, object]]:
    cur.execute(
        """
        select snapshot_id::text,asset_id::text,status,metrics,calendar_version,data_cutoff
          from public.strong_swing_snapshots
         where source='scheduled' and scheduler_run_id=%s and market=%s and market_date=%s
           and feature_version=%s
         order by rank,asset_id
        """,
        (scheduler_run_id, market, market_date, FEATURE_VERSION),
    )
    columns = [item.name for item in cur.description]
    return [dict(zip(columns, row)) for row in cur.fetchall()]


def load_bars(cur, asset_id: str, market_date: str) -> list[FeatureBar]:
    cur.execute(
        """
        select open,high,low,close,volume
          from public.daily_ohlcv
         where asset_id=%s and date<=%s
         order by date desc limit 260
        """,
        (asset_id, market_date),
    )
    return [FeatureBar(Decimal(str(row[3])), Decimal(str(row[0])), Decimal(str(row[1])),
                       Decimal(str(row[2])), Decimal(str(row[4]))) for row in reversed(cur.fetchall())]


def collect(conn, scheduler_run_id: str, market: str, market_date: str) -> tuple[int, int, int]:
    written = skipped = invalid = 0
    with conn.cursor() as cur:
        snapshots = load_snapshots(cur, scheduler_run_id, market, market_date)
        for snapshot in snapshots:
            metrics = snapshot["metrics"] if isinstance(snapshot["metrics"], dict) else json.loads(snapshot["metrics"])
            bars = load_bars(cur, str(snapshot["asset_id"]), market_date)
            try:
                features = build_feature_vector(bars, metrics)
            except (ArithmeticError, ValueError):
                invalid += 1
                continue
            average_value = metrics.get("averageTradedValue20")
            average_value_decimal = Decimal(str(average_value)) if average_value is not None else None
            bucket = liquidity_bucket(average_value_decimal)
            eligible = str(snapshot["status"]) in INCLUDED_STATUSES
            cur.execute(
                """
                insert into public.ml_universe_snapshots
                  (market,market_date,universe_version,asset_id,eligible,liquidity_bucket,
                   market_cap_bucket,eligibility_reason)
                values (%s,%s,%s,%s,%s,%s,'UNKNOWN',%s)
                on conflict (market,market_date,universe_version,asset_id) do update set
                  eligible=excluded.eligible,liquidity_bucket=excluded.liquidity_bucket,
                  eligibility_reason=excluded.eligibility_reason
                returning id
                """,
                (market, market_date, UNIVERSE_VERSION, snapshot["asset_id"], eligible, bucket,
                 Json({"candidate_status": snapshot["status"], "market_cap": "unavailable-point-in-time"})),
            )
            universe_id = cur.fetchone()[0]
            cur.execute(
                """
                insert into public.ml_feature_snapshots
                  (candidate_snapshot_id,universe_snapshot_id,market,asset_id,asof_market_date,
                   snapshot_source,candidate_status,feature_version,inclusion_policy_version,
                   calendar_version,data_timestamp,feature_values,eligible_for_training)
                values (%s,%s,%s,%s,%s,'scheduled',%s,%s,%s,%s,%s,%s,%s)
                on conflict (candidate_snapshot_id,feature_version) do nothing
                returning id
                """,
                (snapshot["snapshot_id"], universe_id, market, snapshot["asset_id"], market_date,
                 snapshot["status"], FEATURE_VERSION, INCLUSION_POLICY_VERSION,
                 snapshot["calendar_version"], snapshot["data_cutoff"], Json(features), eligible),
            )
            if cur.fetchone() is None:
                skipped += 1
            else:
                written += 1
    return written, skipped, invalid


def main() -> None:
    args = parse_args()
    with psycopg2.connect(args.database_url) as conn:
        with conn.cursor() as cur:
            cur.execute("select pg_advisory_xact_lock(hashtext(%s))", (f"ml-snapshot:{args.scheduler_run_id}",))
        written, skipped, invalid = collect(conn, args.scheduler_run_id, args.market, args.market_date)
    print(json.dumps({"written": written, "skipped": skipped, "invalid": invalid}, sort_keys=True))
    if invalid:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
