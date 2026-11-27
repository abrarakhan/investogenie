#!/usr/bin/env python3
"""Shared scheduled Python job for Phase 1 Trade Breach History & Recovery Context.

Evaluates OPEN trades across users, stamps immutable first verified stop-breach records
on swing_trade_ledger, and persists recovery context into swing_trade_recovery_state
so Web and Mobile render stored results without per-page recalculation.
"""
from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import psycopg2

from strategy_math.trade_recovery import assess_trade_recovery

LOCK_KEYS = {"IN": 8742201, "US": 8742202}
TZS = {"IN": ZoneInfo("Asia/Kolkata"), "US": ZoneInfo("America/New_York")}


def run_monitor(conn, market: str, mode: str) -> int:
    lock_key = LOCK_KEYS[market]
    tz = TZS[market]
    now_utc = datetime.now(timezone.utc)
    today_local = now_utc.astimezone(tz).date().isoformat()
    fresh_cutoff = now_utc - timedelta(minutes=5)

    with conn.cursor() as cur:
        cur.execute("select pg_try_advisory_lock(%s)", (lock_key,))
        if not cur.fetchone()[0]:
            print(f"[trade-recovery] skipping {market} {mode}; lock held")
            return 0

    try:
        with conn.cursor() as cur:
            # Load all open trades for this market alongside quotes, 2-session close, and latest Sector Thrust membership
            cur.execute(
                """
                with latest_thrust_run as (
                  select id from public.sector_thrust_runs
                   where market = %s and mode in ('LIVE', 'EOD')
                   order by session_date desc, checkpoint_at desc
                   limit 1
                ),
                thrust_by_asset as (
                  select distinct on (m.asset_id)
                         m.asset_id,
                         g.group_label || ' (' || g.status || ')' as thrust_label,
                         g.related_news
                    from public.sector_thrust_members m
                    join public.sector_thrust_groups g on g.id = m.group_id
                    join latest_thrust_run r on r.id = g.run_id
                   where g.status in ('ACTIVE', 'FADED')
                   order by m.asset_id,
                     case g.status when 'ACTIVE' then 0 else 1 end asc,
                     case g.group_level when 'INDUSTRY' then 0 else 1 end asc
                )
                select l.id::text, l.user_id::text, l.asset_id::text, a.ticker, l.currency,
                       l.buy_price, l.projected_stop, l.bought_on::text, l.expected_holding_days,
                       l.first_stop_breached_at,
                       q.price, q.as_of::text, q.source, q.updated_at,
                       td.volume_ratio_20, td.return_20d,
                       path.two_session_close,
                       tb.thrust_label, tb.related_news,
                       rs.first_detected_at
                  from public.swing_trade_ledger l
                  join public.assets a on a.id = l.asset_id
                  left join public.latest_quotes q on q.asset_id = l.asset_id
                  left join lateral (
                    select volume_ratio_20, return_20d
                      from public.screener_technical_daily
                     where asset_id = l.asset_id
                     order by date desc limit 1
                  ) td on true
                  left join lateral (
                    select max(close) filter (where rn = 2) as two_session_close
                      from (
                        select d.close, row_number() over (order by d.date desc) as rn
                          from public.daily_ohlcv d
                         where d.asset_id = l.asset_id
                           and d.date < coalesce(q.as_of, current_date)
                         order by d.date desc
                         limit 2
                      ) c
                  ) path on true
                  left join thrust_by_asset tb on tb.asset_id = l.asset_id
                  left join public.swing_trade_recovery_state rs on rs.trade_id = l.id
                 where l.market = %s and l.status = 'OPEN'
                """,
                (market, market),
            )
            rows = cur.fetchall()

        breaches_recorded = 0
        recoveries_active = 0
        with conn.cursor() as cur:
            for r in rows:
                (
                    trade_id, user_id, asset_id, ticker, currency,
                    buy_price, projected_stop, bought_on, exp_days,
                    first_breach_at,
                    q_price, q_as_of, q_source, q_updated_at,
                    vol_ratio, ret_20d,
                    two_sess_close,
                    thrust_label, thrust_news,
                    prior_detected_at,
                ) = r

                if mode == "LIVE" and market == "IN":
                    quote_verified = (
                        q_price is not None
                        and q_source == "BREEZE_LIVE"
                        and q_as_of == today_local
                        and q_updated_at is not None
                        and q_updated_at >= fresh_cutoff
                    )
                else:
                    quote_verified = q_price is not None and q_as_of is not None

                # Approximate window expiry below entry (conservative calendar days check for recovery eligibility)
                window_expired_below = False
                if bought_on and exp_days and buy_price is not None and q_price is not None:
                    days_elapsed = (now_utc.astimezone(tz).date() - datetime.fromisoformat(bought_on).date()).days
                    if days_elapsed > int(exp_days) + 3 and float(q_price) < float(buy_price):
                        window_expired_below = True

                res = assess_trade_recovery({
                    "market": market,
                    "currency": currency,
                    "buyPrice": float(buy_price) if buy_price is not None else None,
                    "frozenStop": float(projected_stop) if projected_stop is not None else None,
                    "price": float(q_price) if q_price is not None else None,
                    "twoSessionClose": float(two_sess_close) if two_sess_close is not None else None,
                    "quoteVerified": quote_verified,
                    "quoteSource": q_source,
                    "quoteAt": q_updated_at.isoformat() if q_updated_at else None,
                    "evaluatedAt": now_utc.isoformat(),
                    "firstStopBreachedAt": first_breach_at.isoformat() if first_breach_at else None,
                    "windowExpiredBelowEntry": window_expired_below,
                    "volumePace": float(vol_ratio) if vol_ratio is not None else None,
                    "relativeStrength20d": float(ret_20d) if ret_20d is not None else None,
                    "sectorThrustGroup": thrust_label,
                    "relatedNews": thrust_news if isinstance(thrust_news, list) else [],
                    "priorFirstDetectedAt": prior_detected_at.isoformat() if prior_detected_at else None,
                })

                if res["recordBreach"]:
                    rb = res["recordBreach"]
                    cur.execute(
                        """
                        update public.swing_trade_ledger
                           set first_stop_breached_at = %s::timestamptz,
                               first_stop_breach_price = %s,
                               first_stop_breach_source = %s
                         where id = %s::uuid
                           and first_stop_breached_at is null
                        """,
                        (rb["breachedAt"], rb["price"], rb["source"], trade_id),
                    )
                    breaches_recorded += cur.rowcount

                if res["recoveryStatus"] in ("REBOUND_DETECTED", "STOP_RECLAIMED"):
                    recoveries_active += 1

                cur.execute(
                    """
                    insert into public.swing_trade_recovery_state
                      (trade_id, user_id, market, asset_id, recovery_status, headline,
                       move_2d_pct, volume_pace, relative_strength_20d, sector_thrust_group,
                       related_news, quote_price, quote_source, quote_at, first_detected_at, evaluated_at)
                    values (%s::uuid, %s::uuid, %s, %s::uuid, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s::timestamptz, %s::timestamptz, now())
                    on conflict (trade_id) do update set
                      recovery_status = excluded.recovery_status,
                      headline = excluded.headline,
                      move_2d_pct = excluded.move_2d_pct,
                      volume_pace = excluded.volume_pace,
                      relative_strength_20d = excluded.relative_strength_20d,
                      sector_thrust_group = excluded.sector_thrust_group,
                      related_news = excluded.related_news,
                      quote_price = excluded.quote_price,
                      quote_source = excluded.quote_source,
                      quote_at = excluded.quote_at,
                      first_detected_at = coalesce(public.swing_trade_recovery_state.first_detected_at, excluded.first_detected_at),
                      evaluated_at = now()
                    """,
                    (
                        trade_id, user_id, market, asset_id, res["recoveryStatus"], res["headline"],
                        res["move2dPct"], res["volumePace"], res["relativeStrength20d"],
                        res["sectorThrustGroup"], json.dumps(res["relatedNews"]),
                        res["quotePrice"], res["quoteSource"], res["quoteAt"], res["firstDetectedAt"],
                    ),
                )
        conn.commit()
        print(
            f"[trade-recovery] {market} {mode}: open_trades={len(rows)} "
            f"new_breaches={breaches_recorded} active_recoveries={recoveries_active}"
        )
        return 0
    finally:
        try:
            conn.rollback()
        except Exception:
            pass
        with conn.cursor() as cur:
            cur.execute("select pg_advisory_unlock(%s)", (lock_key,))
        conn.commit()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--market", choices=("IN", "US"), default="IN")
    parser.add_argument("--mode", choices=("LIVE", "EOD"), default="LIVE")
    args = parser.parse_args()
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        raise SystemExit("DATABASE_URL is required")
    with psycopg2.connect(db_url) as conn:
        return run_monitor(conn, args.market, args.mode)


if __name__ == "__main__":
    raise SystemExit(main())
