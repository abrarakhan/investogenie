#!/usr/bin/env python3
"""Shared scheduled Python job for Trade Breach History, Recovery Context & Strategy Rechecks.

Evaluates OPEN trades across users:
- Resolves expected trading session date from the shared exchange calendar (lib/market-calendar.mjs).
- Enforces live quote-age and session verification before stamping immutable breach history
  (including the stop level in force).
- Uses the exact ledger trading-session expiry rule (sessions_held > expected_holding_days).
- Aligns stock and benchmark dates when computing 20-day relative strength.
- Validates fresh setups against current-session recency (<=15m in LIVE), engine gates, and
  tight entry/stop bounds; downgrades stale/extended same-day signals to RECENT_SIGNAL.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import psycopg2

from strategy_math.trade_recovery import (
    assess_trade_recovery,
    evaluate_fresh_setup,
    is_quote_verified_for_breach,
    is_window_expired,
)

LOCK_KEYS = {"IN": 8742201, "US": 8742202}
TZS = {"IN": ZoneInfo("Asia/Kolkata"), "US": ZoneInfo("America/New_York")}
BENCHMARK_TICKERS = {"IN": ("NIFTYBEES", "^NSEI", "NIFTY"), "US": ("SPY", "^GSPC")}
REPO_ROOT = Path(__file__).resolve().parent.parent


def _local_iso_date(ts: datetime | None, tz: ZoneInfo) -> str | None:
    if ts is None:
        return None
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return ts.astimezone(tz).date().isoformat()


def resolve_expected_session_date(market: str, now_utc: datetime) -> str:
    """Resolve expected trading session date via the shared exchange calendar (lib/market-calendar.mjs)."""
    cal_path = REPO_ROOT / "lib" / "market-calendar.mjs"
    if cal_path.exists():
        try:
            script = (
                f"import {{ latestExpectedSessionDate }} from {json.dumps(str(cal_path))};"
                f"process.stdout.write(latestExpectedSessionDate({json.dumps(market)}));"
            )
            out = subprocess.check_output(
                ["node", "--input-type=module", "-e", script],
                cwd=str(REPO_ROOT),
                timeout=5,
                text=True,
            ).strip()
            if len(out) == 10 and out[4] == "-" and out[7] == "-":
                return out
        except Exception:
            pass
    # Conservative weekday fallback if Node calendar is unavailable
    d = now_utc.astimezone(TZS[market]).date()
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d.isoformat()


def run_monitor(conn, market: str, mode: str) -> int:
    lock_key = LOCK_KEYS[market]
    tz = TZS[market]
    now_utc = datetime.now(timezone.utc)
    expected_session_date = resolve_expected_session_date(market, now_utc)

    with conn.cursor() as cur:
        cur.execute("select pg_try_advisory_lock(%s)", (lock_key,))
        if not cur.fetchone()[0]:
            print(f"[trade-recovery] skipping {market} {mode}; lock held")
            return 0

    try:
        with conn.cursor() as cur:
            bench_tickers = list(BENCHMARK_TICKERS[market])
            # Load all open trades for this market alongside quotes, 2-session close,
            # exact trading-session count held since bought_on, date-aligned benchmark 20D return,
            # and latest Sector Thrust membership.
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
                ),
                benchmark_asset as (
                  select id
                    from public.assets
                   where country = %s
                     and ticker = any(%s)
                   order by array_position(%s::text[], ticker)
                   limit 1
                )
                select l.id::text, l.user_id::text, l.asset_id::text, a.ticker, l.currency,
                       l.buy_price, l.projected_stop, l.bought_on::text, l.expected_holding_days,
                       l.first_stop_breached_at,
                       q.price, q.as_of::text, q.source, q.updated_at,
                       td.volume_ratio_20, td.return_20d, btd.return_20d as bench_return_20d,
                       path.two_session_close,
                       held.sessions_held,
                       tb.thrust_label, tb.related_news,
                       rs.first_detected_at, rs.fresh_setup_first_qualified_at
                  from public.swing_trade_ledger l
                  join public.assets a on a.id = l.asset_id
                  left join public.latest_quotes q on q.asset_id = l.asset_id
                  left join lateral (
                    select date, volume_ratio_20, return_20d
                      from public.screener_technical_daily
                     where asset_id = l.asset_id
                     order by date desc limit 1
                  ) td on true
                  left join lateral (
                    select b.return_20d
                      from public.screener_technical_daily b
                      join benchmark_asset ba on ba.id = b.asset_id
                     where b.date = td.date
                       and b.return_20d is not null
                     limit 1
                  ) btd on true
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
                  left join lateral (
                    select count(distinct d.date)::int as sessions_held
                      from public.daily_ohlcv d
                     where d.asset_id = l.asset_id
                       and d.date > l.bought_on
                       and d.date <= coalesce(q.as_of, current_date)
                  ) held on true
                  left join thrust_by_asset tb on tb.asset_id = l.asset_id
                  left join public.swing_trade_recovery_state rs on rs.trade_id = l.id
                 where l.market = %s and l.status = 'OPEN'
                """,
                (market, market, bench_tickers, bench_tickers, market),
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
                    vol_ratio, ret_20d, bench_ret_20d,
                    two_sess_close,
                    sessions_held,
                    thrust_label, thrust_news,
                    prior_detected_at, prior_fresh_qual_at,
                ) = r

                quote_verified = is_quote_verified_for_breach(
                    market=market,
                    mode=mode,
                    price=float(q_price) if q_price is not None else None,
                    quote_as_of=q_as_of,
                    quote_source=q_source,
                    quote_updated_at=q_updated_at,
                    expected_session_date=expected_session_date,
                    now_utc=now_utc,
                )

                window_expired_below = is_window_expired(
                    sessions_held=int(sessions_held) if sessions_held is not None else None,
                    expected_holding_days=int(exp_days) if exp_days is not None else None,
                    price=float(q_price) if q_price is not None else None,
                    buy_price=float(buy_price) if buy_price is not None else None,
                )

                # Date-aligned 20D relative strength vs benchmark (None if benchmark missing on stock's date)
                rs_20d = (
                    (float(ret_20d) - float(bench_ret_20d))
                    if (ret_20d is not None and bench_ret_20d is not None)
                    else None
                )

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
                    "relativeStrength20d": rs_20d,
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
                               first_stop_breach_stop_level = %s,
                               first_stop_breach_source = %s
                         where id = %s::uuid
                           and first_stop_breached_at is null
                        """,
                        (rb["breachedAt"], rb["price"], rb["stopLevel"], rb["source"], trade_id),
                    )
                    breaches_recorded += cur.rowcount

                if res["recoveryStatus"] in ("REBOUND_DETECTED", "STOP_RECLAIMED"):
                    recoveries_active += 1

                # Phase 2: Automated strategy recheck (recency + engine gates + tight entry/stop check)
                strong_ctx = None
                trend_ctx = None
                mom_ctx = None
                swing_ctx = None
                if res["recoveryStatus"] in ("REBOUND_DETECTED", "STOP_RECLAIMED"):
                    cur.execute(
                        """
                        with latest_ss as (select max(captured_at) as ts from public.strong_swing_snapshots where market = %s)
                        select status, strength_score, confirmation_entry, projected_stop, projected_target, gates, captured_at
                          from public.strong_swing_snapshots
                         where market = %s and asset_id = %s::uuid and captured_at = (select ts from latest_ss)
                         limit 1
                        """,
                        (market, market, asset_id),
                    )
                    sr = cur.fetchone()
                    if sr:
                        strong_ctx = {
                            "status": sr[0],
                            "strengthScore": float(sr[1]) if sr[1] is not None else None,
                            "entry": float(sr[2]) if sr[2] is not None else None,
                            "stop": float(sr[3]) if sr[3] is not None else None,
                            "target": float(sr[4]) if sr[4] is not None else None,
                            "gates": sr[5],
                            "signalDate": _local_iso_date(sr[6], tz),
                            "signalAt": sr[6].isoformat() if sr[6] else None,
                        }
                    if market == "IN":
                        cur.execute(
                            """
                            select status, setup_variant, score, entry, stop, target, asof_market_date::text, computed_at
                              from public.trend_continuation_signals
                             where market = 'IN' and asset_id = %s::uuid
                             order by asof_market_date desc, computed_at desc
                             limit 1
                            """,
                            (asset_id,),
                        )
                        tr = cur.fetchone()
                        if tr:
                            trend_ctx = {
                                "status": tr[0],
                                "setupVariant": tr[1],
                                "score": float(tr[2]) if tr[2] is not None else None,
                                "entry": float(tr[3]) if tr[3] is not None else None,
                                "stop": float(tr[4]) if tr[4] is not None else None,
                                "target": float(tr[5]) if tr[5] is not None else None,
                                "signalDate": tr[6],
                                "signalAt": tr[7].isoformat() if tr[7] else None,
                            }
                    cur.execute(
                        """
                        select status, ready, observed_at
                          from public.candidate_signal_observations
                         where user_id = %s::uuid and market = %s and asset_id = %s::uuid
                           and engine = 'MOMENTUM_IGNITION_V2'
                         order by observed_at desc
                         limit 1
                        """,
                        (user_id, market, asset_id),
                    )
                    mr = cur.fetchone()
                    if mr:
                        mom_ctx = {
                            "status": mr[0],
                            "ready": bool(mr[1]),
                            "signalDate": _local_iso_date(mr[2], tz),
                            "signalAt": mr[2].isoformat() if mr[2] else None,
                        }
                    cur.execute(
                        """
                        select verdict, score, last_close, as_of::text
                          from public.swing_signals
                         where asset_id = %s::uuid
                         order by as_of desc
                         limit 1
                        """,
                        (asset_id,),
                    )
                    swr = cur.fetchone()
                    if swr:
                        swing_ctx = {
                            "verdict": swr[0],
                            "score": float(swr[1]) if swr[1] is not None else None,
                            "entry": float(swr[2]) if swr[2] is not None else None,
                            "signalDate": swr[3],
                        }

                fs = evaluate_fresh_setup({
                    "market": market,
                    "mode": mode,
                    "recoveryStatus": res["recoveryStatus"],
                    "evaluatedAt": now_utc.isoformat(),
                    "expectedSessionDate": expected_session_date,
                    "quoteVerified": quote_verified,
                    "currentPrice": float(q_price) if q_price is not None else None,
                    "priorFreshSetupFirstQualifiedAt": prior_fresh_qual_at.isoformat() if prior_fresh_qual_at else None,
                    "strongSwing": strong_ctx,
                    "trendContinuation": trend_ctx,
                    "momentumV2": mom_ctx,
                    "swingBreakout": swing_ctx,
                })

                cur.execute("select set_config('app.current_user_id', %s, true)", (user_id,))
                cur.execute(
                    """
                    insert into public.swing_trade_recovery_state
                      (trade_id, user_id, market, asset_id, recovery_status, headline,
                       move_2d_pct, volume_pace, relative_strength_20d, sector_thrust_group,
                       related_news, quote_price, quote_source, quote_at, first_detected_at,
                       fresh_setup_status, fresh_setup_engine, fresh_setup_label,
                       fresh_setup_entry, fresh_setup_stop, fresh_setup_target,
                       fresh_setup_route, fresh_setup_blocker, fresh_setup_first_qualified_at,
                       fresh_setup_checked_at, evaluated_at)
                    values (%s::uuid, %s::uuid, %s, %s::uuid, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s::timestamptz, %s::timestamptz,
                            %s, %s, %s, %s, %s, %s, %s, %s, %s::timestamptz, now(), now())
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
                      fresh_setup_status = excluded.fresh_setup_status,
                      fresh_setup_engine = excluded.fresh_setup_engine,
                      fresh_setup_label = excluded.fresh_setup_label,
                      fresh_setup_entry = excluded.fresh_setup_entry,
                      fresh_setup_stop = excluded.fresh_setup_stop,
                      fresh_setup_target = excluded.fresh_setup_target,
                      fresh_setup_route = excluded.fresh_setup_route,
                      fresh_setup_blocker = excluded.fresh_setup_blocker,
                      fresh_setup_first_qualified_at = coalesce(public.swing_trade_recovery_state.fresh_setup_first_qualified_at, excluded.fresh_setup_first_qualified_at),
                      fresh_setup_checked_at = now(),
                      evaluated_at = now()
                    """,
                    (
                        trade_id, user_id, market, asset_id, res["recoveryStatus"], res["headline"],
                        res["move2dPct"], res["volumePace"], res["relativeStrength20d"],
                        res["sectorThrustGroup"], json.dumps(res["relatedNews"]),
                        res["quotePrice"], res["quoteSource"], res["quoteAt"], res["firstDetectedAt"],
                        fs["freshSetupStatus"], fs["freshSetupEngine"], fs["freshSetupLabel"],
                        fs["freshSetupEntry"], fs["freshSetupStop"], fs["freshSetupTarget"],
                        fs["freshSetupRoute"], fs["freshSetupBlocker"], fs["freshSetupFirstQualifiedAt"],
                    ),
                )
        conn.commit()
        print(
            f"[trade-recovery] {market} {mode} (session={expected_session_date}): "
            f"open_trades={len(rows)} new_breaches={breaches_recorded} active_recoveries={recoveries_active}"
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
