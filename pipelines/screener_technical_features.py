#!/usr/bin/env python3
"""Build point-in-time screener features and forward-return backtest outcomes.

All calculations live in Python.  The web layer only filters stored values and
aggregates outcomes, so current screens and historical tests share one contract.
"""
from __future__ import annotations

import argparse
import os
from datetime import date, timedelta

import numpy as np
import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
from strategy_math.long_term import historical_metrics

FEATURE_VERSION = "technical_v2_change_1d"
FUNDAMENTAL_FEATURE_VERSION = "fundamental_history_v1"
INCREMENTAL_WRITE_DAYS = 120
# 320 calendar days comfortably contains the 200 completed trading sessions
# needed by the longest indicator, including weekends and exchange holidays.
INCREMENTAL_LOOKBACK_DAYS = 320


def history_start_date(today: date, years: int, incremental: bool) -> date:
    """Bound input history without changing any feature formula.

    Incremental runs rewrite only the recent window, so loading five years for
    every active stock needlessly consumes several gigabytes. The retained
    lookback still supplies every row required by the 200-session indicators.
    """
    if incremental:
        return today - timedelta(days=INCREMENTAL_WRITE_DAYS + INCREMENTAL_LOOKBACK_DAYS)
    return today - timedelta(days=max(4, years) * 366 + INCREMENTAL_LOOKBACK_DAYS)


def compute_features(frame: pd.DataFrame) -> pd.DataFrame:
    df = frame.sort_values("date").copy()
    close = pd.to_numeric(df["close"], errors="coerce")
    high = pd.to_numeric(df["high"], errors="coerce")
    low = pd.to_numeric(df["low"], errors="coerce")
    volume = pd.to_numeric(df["volume"], errors="coerce")
    # Point-in-time close-to-close change. pct_change uses only the previous
    # completed row; fill_method=None prevents missing closes being filled.
    df["change_pct_1d"] = close.pct_change(1, fill_method=None) * 100.0
    for window in (20, 50, 100, 150, 200):
        df[f"sma_{window}"] = close.rolling(window, min_periods=window).mean()
    for span in (20, 50):
        df[f"ema_{span}"] = close.ewm(span=span, adjust=False, min_periods=span).mean()
    for window in (20, 50, 100, 150, 200):
        df[f"distance_sma_{window}_pct"] = (close / df[f"sma_{window}"] - 1.0) * 100.0
    for span in (20, 50):
        df[f"distance_ema_{span}_pct"] = (close / df[f"ema_{span}"] - 1.0) * 100.0
    for fast, slow in ((20, 50), (20, 100), (20, 150), (20, 200), (50, 100),
                       (50, 150), (50, 200), (100, 150), (100, 200), (150, 200)):
        df[f"sma_{fast}_vs_{slow}_pct"] = (df[f"sma_{fast}"] / df[f"sma_{slow}"] - 1.0) * 100.0

    delta = close.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / 14, adjust=False, min_periods=14).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / 14, adjust=False, min_periods=14).mean()
    rs = gain / loss.replace(0, np.nan)
    df["rsi_14"] = 100 - 100 / (1 + rs)
    prev_close = close.shift(1)
    true_range = pd.concat([(high - low), (high - prev_close).abs(), (low - prev_close).abs()], axis=1).max(axis=1)
    atr = true_range.ewm(alpha=1 / 14, adjust=False, min_periods=14).mean()
    df["atr_pct_14"] = atr / close * 100.0
    df["volume_ratio_20"] = volume / volume.rolling(20, min_periods=20).mean()
    for sessions in (5, 20, 63):
        df[f"return_{sessions}d"] = close.pct_change(sessions, fill_method=None) * 100.0
    for sessions in (5, 20, 60):
        df[f"forward_return_{sessions}d"] = (close.shift(-sessions) / close - 1.0) * 100.0
    df["close"] = close
    return df.replace([np.inf, -np.inf], np.nan)


COLUMNS = [
    "close", "change_pct_1d", "sma_20", "sma_50", "sma_100", "sma_150", "sma_200", "ema_20", "ema_50",
    "distance_sma_20_pct", "distance_sma_50_pct", "distance_sma_100_pct", "distance_sma_150_pct",
    "distance_sma_200_pct", "distance_ema_20_pct", "distance_ema_50_pct",
    "sma_20_vs_50_pct", "sma_20_vs_100_pct", "sma_20_vs_150_pct", "sma_20_vs_200_pct",
    "sma_50_vs_100_pct", "sma_50_vs_150_pct", "sma_50_vs_200_pct", "sma_100_vs_150_pct",
    "sma_100_vs_200_pct", "sma_150_vs_200_pct", "rsi_14", "atr_pct_14", "volume_ratio_20",
    "return_5d", "return_20d", "return_63d", "forward_return_5d", "forward_return_20d",
    "forward_return_60d",
]


def db_value(value):
    return None if pd.isna(value) else float(value)


def compute_fundamental_features(reports: pd.DataFrame) -> list[tuple]:
    """Calculate current multi-year metrics from stored annual reports.

    This reuses the Python Long-Term calculation authority so the screener and
    Long-Term pages cannot disagree about CAGR or profitability history.
    """
    payload = []
    if reports.empty:
        return payload
    for asset_id, group in reports.groupby("asset_id", sort=False):
        ordered = group.sort_values("period_end_date", ascending=False)
        points = [
            {
                "period": str(row.period_end_date),
                "revenue": db_value(row.revenue),
                "netProfit": db_value(row.net_profit),
                "roce": db_value(row.roce),
                "operatingCashFlow": db_value(row.operating_cash_flow),
                "freeCashFlow": db_value(row.free_cash_flow),
            }
            for row in ordered.itertuples(index=False)
        ]
        metrics = historical_metrics(points)
        latest = ordered.iloc[0]
        positive = metrics["positiveProfitYearsRatio"]
        payload.append((
            asset_id,
            latest["period_end_date"],
            db_value(latest["net_profit"]),
            metrics["revenueCagr3y"], metrics["revenueCagr5y"],
            metrics["profitCagr3y"], metrics["profitCagr5y"],
            None if positive is None else positive * 100.0,
            metrics["medianRoce5y"], metrics["medianCashConversion5y"],
            metrics["medianFcfMargin5y"],
            metrics["historyYears"], FUNDAMENTAL_FEATURE_VERSION,
        ))
    return payload


def write_midway_columns(cur, since: str | None) -> int:
    """Fill the mid-way evidence columns on the screener's point-in-time rows.

    Done as two set-based statements rather than inside the pandas feature pass. The
    inputs live in other tables and the work is a join plus one window function, which
    Postgres does far more cheaply than a per-row Python loop -- and on a two-CPU host
    this job shares its CPUs with page rendering.

    Delivery is matched per session so a historical row keeps the delivery that session
    actually had; backfilling today's figure across history would make every backtest of
    these filters wrong in the same flattering direction.
    """
    bounds = ("and d.date >= %s::date", (since,)) if since else ("", ())
    cur.execute(
        f"""
        with delivery as (
          select m.asset_id, m.date, m.deliv_pct, m.deliv_qty,
                 avg(m.deliv_qty) over (
                   partition by m.asset_id order by m.date
                   rows between 20 preceding and 1 preceding
                 ) baseline
            from public.daily_delivery_metrics m
           where not m.is_etf
        )
        update public.screener_technical_daily d
           set deliv_pct = delivery.deliv_pct,
               rel_deliv_20d = case
                 when delivery.baseline is null or delivery.baseline <= 0 then null
                 else round((delivery.deliv_qty / delivery.baseline)::numeric, 2) end
          from delivery
         where delivery.asset_id = d.asset_id and delivery.date = d.date {bounds[0]}
        """,
        bounds[1],
    )
    delivery_rows = cur.rowcount
    # One session of relative performance against the index. change_pct_1d is already on
    # the row, so this only needs the benchmark's own move for the same date.
    cur.execute(
        f"""
        with benchmark as (
          select o.date,
                 (o.close / nullif(lag(o.close) over (order by o.date), 0) - 1) * 100 change_pct
            from public.daily_ohlcv o
           where o.asset_id in (
             select id from public.assets where country='IN' and ticker in ('NIFTY','NIFTY 50')
           )
        )
        update public.screener_technical_daily d
           set nifty_alpha_1d = round((d.change_pct_1d - benchmark.change_pct)::numeric, 2)
          from benchmark
         where benchmark.date = d.date and d.change_pct_1d is not null
           and benchmark.change_pct is not null {bounds[0]}
        """,
        bounds[1],
    )
    alpha_rows = cur.rowcount
    # The variant and catalyst are the scan's verdict, not a feature of the bar, so they
    # are carried over rather than recomputed; a second implementation would drift.
    cur.execute(
        f"""
        update public.screener_technical_daily d
           set setup_variant = t.setup_variant,
               catalyst_tag = t.catalyst_tag,
               days_since_results = t.days_since_results,
               ibs_close = t.ibs_close,
               tod_rvol = t.tod_rvol
          from public.trend_continuation_signals t
         where t.asset_id = d.asset_id and t.asof_market_date = d.date {bounds[0]}
        """,
        bounds[1],
    )
    return delivery_rows + alpha_rows + cur.rowcount


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--market", choices=("IN", "US"))
    parser.add_argument("--years", type=int, default=5)
    parser.add_argument("--incremental", action="store_true", help="Rewrite only the recent 120 calendar days")
    parser.add_argument("--bootstrap", action="store_true", help="Full load when empty, otherwise incremental")
    args = parser.parse_args()
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL is required")
    conn = psycopg2.connect(database_url)
    try:
        incremental = args.incremental
        if args.bootstrap:
            with conn.cursor() as cur:
                # A feature-version change must rebuild the complete requested
                # history once. Otherwise a newly added column would only be
                # populated in the 120-day incremental rewrite window and a
                # three-year backtest would silently omit most observations.
                cur.execute("""select exists(select 1 from public.screener_technical_daily d
                    join public.assets a on a.id=d.asset_id
                    where (%s is null or a.country=%s)
                      and d.feature_version=%s
                      and d.change_pct_1d is not null)""",
                            (args.market, args.market, FEATURE_VERSION))
                incremental = bool(cur.fetchone()[0])
        today = date.today()
        write_since = today - timedelta(days=INCREMENTAL_WRITE_DAYS) if incremental else None
        since = history_start_date(today, args.years, incremental)
        with conn.cursor() as cur:
            cur.execute(
                """select o.asset_id::text,o.date,o.open,o.high,o.low,o.close,o.volume
                     from public.daily_ohlcv o join public.assets a on a.id=o.asset_id
                    where a.asset_class='STOCK' and a.is_active and o.date >= %s
                      and (%s is null or a.country=%s)
                    order by o.asset_id,o.date""",
                (since, args.market, args.market),
            )
            rows = cur.fetchall()
        raw = pd.DataFrame(rows, columns=["asset_id", "date", "open", "high", "low", "close", "volume"])
        with conn.cursor() as cur:
            cur.execute(
                """select f.asset_id::text,f.period_end_date,f.revenue,f.net_profit,f.roce,
                          cf.operating_cash_flow,cf.free_cash_flow
                     from public.asset_financial_reports f join public.assets a on a.id=f.asset_id
                     left join public.asset_cash_flow_statements cf
                       on cf.asset_id=f.asset_id and cf.period_end_date=f.period_end_date
                      and cf.report_type=f.report_type
                    where f.report_type='ANNUAL' and a.asset_class='STOCK' and a.is_active
                      and (%s is null or a.country=%s)
                    order by f.asset_id,f.period_end_date desc""",
                (args.market, args.market),
            )
            report_rows = cur.fetchall()
        reports = pd.DataFrame(
            report_rows,
            columns=["asset_id", "period_end_date", "revenue", "net_profit", "roce",
                     "operating_cash_flow", "free_cash_flow"],
        )
        fundamental_payload = compute_fundamental_features(reports)
        with conn.cursor() as cur:
            if args.market:
                cur.execute("""delete from public.screener_technical_daily d using public.assets a
                    where a.id=d.asset_id and a.country=%s and (%s::date is null or d.date >= %s::date)""",
                            (args.market, write_since, write_since))
            else:
                if write_since:
                    cur.execute("delete from public.screener_technical_daily where date >= %s", (write_since,))
                else:
                    cur.execute("truncate public.screener_technical_daily")
            cols = ",".join(["asset_id", "date", *COLUMNS, "feature_version"])
            insert_sql = f"insert into public.screener_technical_daily ({cols}) values %s"
            payload = []
            written = 0
            for asset_id, group in raw.groupby("asset_id", sort=False):
                computed = compute_features(group)
                if write_since:
                    computed = computed[computed["date"] >= write_since]
                for row in computed.itertuples(index=False):
                    values = [db_value(getattr(row, col)) for col in COLUMNS]
                    payload.append((asset_id, row.date, *values, FEATURE_VERSION))
                if len(payload) >= 50_000:
                    execute_values(cur, insert_sql, payload, page_size=5000)
                    written += len(payload)
                    payload.clear()
            if payload:
                execute_values(cur, insert_sql, payload, page_size=5000)
                written += len(payload)
            if fundamental_payload:
                execute_values(
                    cur,
                    """insert into public.screener_fundamental_latest
                         (asset_id,report_date,net_profit,revenue_cagr_3y,revenue_cagr_5y,
                          profit_cagr_3y,profit_cagr_5y,positive_profit_years_pct,
                          median_roce_5y,median_cash_conversion_5y,median_fcf_margin_5y,
                          history_years,feature_version) values %s
                       on conflict(asset_id) do update set
                         report_date=excluded.report_date,net_profit=excluded.net_profit,
                         revenue_cagr_3y=excluded.revenue_cagr_3y,revenue_cagr_5y=excluded.revenue_cagr_5y,
                         profit_cagr_3y=excluded.profit_cagr_3y,profit_cagr_5y=excluded.profit_cagr_5y,
                         positive_profit_years_pct=excluded.positive_profit_years_pct,
                         median_roce_5y=excluded.median_roce_5y,
                         median_cash_conversion_5y=excluded.median_cash_conversion_5y,
                         median_fcf_margin_5y=excluded.median_fcf_margin_5y,
                         history_years=excluded.history_years,feature_version=excluded.feature_version,
                         refreshed_at=now()""",
                    fundamental_payload,
                    page_size=2000,
                )
            # India-only inputs; the statements are no-ops elsewhere because the joins
            # find nothing, so there is no need to branch on market here.
            midway = write_midway_columns(cur, write_since)
        conn.commit()
        print(f"[screener-features] wrote {written} rows, {midway} mid-way column updates "
              f"({args.market or 'ALL'}, {'incremental' if incremental else 'full'})")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
