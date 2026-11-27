#!/usr/bin/env python3
"""Shared 5-minute Sector Catalyst Thrust scanner and isolated historical replay CLI.

Usage:
  Live checkpoint:   python pipelines/sector_thrust_scan.py --market IN --mode LIVE
  EOD checkpoint:    python pipelines/sector_thrust_scan.py --market IN --mode EOD
  20-session replay: python pipelines/sector_thrust_scan.py --market IN --replay-eod --sessions 20
  Intraday replay:   python pipelines/sector_thrust_scan.py --market IN --replay-intraday --date 2026-11-26
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time as time_mod
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import psycopg2
from psycopg2.extras import execute_values

from strategy_math.sector_themes import TAXONOMY_VERSION, classify_asset, exchange_rank, is_etf_like
from strategy_math.sector_thrust import RULE_VERSION, assess_market_checkpoint

MARKET_CONFIG = {
    "IN": {
        "country": "IN",
        "tz": ZoneInfo("Asia/Kolkata"),
        "open": time(9, 15),
        "close": time(15, 30),
        "start_offset_min": 15,  # begin live scan at 09:30 IST
        "price_floor": 20.0,
        "value_floor": 10_000_000.0,
        "lock_key": 8742101,
    },
    "US": {
        "country": "US",
        "tz": ZoneInfo("America/New_York"),
        "open": time(9, 30),
        "close": time(16, 0),
        "start_offset_min": 15,
        "price_floor": 2.0,
        "value_floor": 1_000_000.0,
        "lock_key": 8742102,
    },
}


def _session_progress(market: str, at_utc: datetime) -> float | None:
    cfg = MARKET_CONFIG[market]
    local = at_utc.astimezone(cfg["tz"])
    opened = cfg["open"]
    closed = cfg["close"]
    open_s = opened.hour * 3600 + opened.minute * 60
    close_s = closed.hour * 3600 + closed.minute * 60
    cur_s = local.hour * 3600 + local.minute * 60 + local.second
    if cur_s < open_s:
        return None
    return max(0.0, min(1.0, (cur_s - open_s) / (close_s - open_s)))


def _load_volume_curve(cur, market: str, before_date: str) -> tuple[str | None, list[list[float]] | None]:
    """Load the newest market_volume_curves row built strictly from sessions before before_date."""
    cur.execute(
        """
        select version, points
          from public.market_volume_curves
         where market = %s
           and sample_through < %s::date
         order by active desc, sample_through desc, generated_at desc
         limit 1
        """,
        (market, before_date),
    )
    row = cur.fetchone()
    if not row:
        return None, None
    return row[0], row[1]


def _load_completed_baselines(cur, country: str, session_date: str, value_floor: float) -> list[dict]:
    """Load frozen prior-session baselines (prevClose, 20D avg traded value, 20D avg vol, 14D ATR%)."""
    cur.execute(
        """
        with recent_bars as (
          select o.asset_id, o.date, o.high, o.low, o.close, o.volume,
                 row_number() over (partition by o.asset_id order by o.date desc) as rn
            from public.daily_ohlcv o
            join public.assets a on a.id = o.asset_id
           where a.country = %s
             and a.is_active = true
             and a.asset_class = 'STOCK'
             and o.date < %s::date
             and o.date >= (%s::date - interval '45 days')
             and o.close is not null and o.close > 0
        ),
        agg as (
          select asset_id,
                 max(close) filter (where rn = 1) as prev_close,
                 avg(close * coalesce(volume, 0)) filter (where rn <= 20) as avg_val_20,
                 avg(coalesce(volume, 0)) filter (where rn <= 20) as avg_vol_20,
                 avg((coalesce(high, close) - coalesce(low, close)) / nullif(close, 0) * 100.0) filter (where rn <= 14) as atr_pct_14,
                 count(*) filter (where rn <= 20) as bar_cnt
            from recent_bars
           where rn <= 20
           group by asset_id
        ),
        etf_flags as (
          select distinct asset_id
            from public.daily_delivery_metrics
           where is_etf = true
             and date >= (%s::date - interval '30 days')
        )
        select a.id::text, a.ticker, a.name, a.exchange, a.sector,
               agg.prev_close, agg.avg_val_20, agg.avg_vol_20, agg.atr_pct_14,
               (ef.asset_id is not null) as is_etf
          from agg
          join public.assets a on a.id = agg.asset_id
          left join etf_flags ef on ef.asset_id = a.id
         where agg.bar_cnt >= 10
           and agg.prev_close > 0
           and agg.avg_val_20 >= %s
        """,
        (country, session_date, session_date, session_date, value_floor),
    )
    out = []
    for r in cur.fetchall():
        out.append({
            "assetId": r[0],
            "ticker": r[1],
            "name": r[2],
            "exchange": r[3],
            "sector": r[4],
            "prevClose": float(r[5]),
            "avgTradedValue20d": float(r[6]),
            "avgVolume20d": float(r[7]) if r[7] is not None else None,
            "atrPct": float(r[8]) if r[8] is not None else 3.0,
            "isEtf": bool(r[9]),
        })
    return out


def _load_recent_articles(cur, market: str, as_of_utc: datetime) -> list[dict]:
    cur.execute(
        """
        select title, source, published_at, url, summary
          from public.news_articles
         where market = %s
           and published_at >= %s - interval '24 hours'
           and published_at <= %s
         order by published_at desc
         limit 150
        """,
        (market, as_of_utc, as_of_utc),
    )
    return [
        {
            "title": r[0],
            "source": r[1],
            "publishedAt": r[2].isoformat() if r[2] else None,
            "url": r[3],
            "summary": r[4],
        }
        for r in cur.fetchall()
    ]


def _persist_run(conn, result: dict, duration_ms: int, baselines: list[dict]) -> int:
    market = result["market"]
    session_date = result["sessionDate"]
    with conn.cursor() as cur:
        # Upsert versioned sector_group_memberships for eligible universe
        mem_rows = []
        seen_tk: dict[str, dict] = {}
        for b in baselines:
            tk = str(b["ticker"]).upper()
            if is_etf_like(tk, b.get("name"), bool(b.get("isEtf"))):
                continue
            prev = seen_tk.get(tk)
            if prev is None or exchange_rank(b.get("exchange")) > exchange_rank(prev.get("exchange")):
                seen_tk[tk] = b
        for tk, b in seen_tk.items():
            cls = classify_asset(market, tk, b.get("name"), b.get("sector"))
            mem_rows.append((
                market, b["assetId"], TAXONOMY_VERSION,
                cls["broadSector"], cls["industryGroup"], cls["tags"], cls["source"],
            ))
        if mem_rows:
            execute_values(
                cur,
                """
                insert into public.sector_group_memberships
                  (market, asset_id, taxonomy_version, broad_sector, industry_group, tags, source)
                values %s
                on conflict (market, asset_id, taxonomy_version) do update set
                  broad_sector = excluded.broad_sector,
                  industry_group = excluded.industry_group,
                  tags = excluded.tags,
                  source = excluded.source,
                  updated_at = now()
                """,
                mem_rows,
                page_size=500,
            )

        cur.execute(
            """
            insert into public.sector_thrust_runs
              (market, session_date, checkpoint_at, mode, rule_version, taxonomy_version,
               curve_version, status, unverified_reason, eligible_universe_count,
               unclassified_count, scan_duration_ms, summary)
            values (%s, %s::date, %s::timestamptz, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
            returning id
            """,
            (
                market, session_date, result["checkpointAt"], result["mode"],
                result["ruleVersion"], result["taxonomyVersion"], result.get("curveVersion"),
                result["status"], result.get("unverifiedReason"),
                result["eligibleUniverseCount"], result["unclassifiedCount"],
                duration_ms, json.dumps(result["summary"]),
            ),
        )
        run_id = int(cur.fetchone()[0])

        for g in result["groups"]:
            cur.execute(
                """
                insert into public.sector_thrust_groups
                  (run_id, market, session_date, group_level, group_key, group_label,
                   parent_sector, status, unverified_reason, eligible_count,
                   price_fresh_count, volume_fresh_count, qualifying_count,
                   median_return_pct, median_rvol, volume_confirmation_route,
                   first_triggered_at, related_news)
                values (%s, %s, %s::date, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::timestamptz, %s::jsonb)
                returning id
                """,
                (
                    run_id, market, session_date, g["groupLevel"], g["groupKey"], g["groupLabel"],
                    g.get("parentSector"), g["status"], g.get("unverifiedReason"),
                    g["eligibleCount"], g["priceFreshCount"], g["volumeFreshCount"],
                    g["qualifyingCount"], g.get("medianReturnPct"), g.get("medianRvol"),
                    g.get("volumeConfirmationRoute"), g.get("firstTriggeredAt"),
                    json.dumps(g.get("relatedNews") or []),
                ),
            )
            group_id = int(cur.fetchone()[0])
            member_rows = []
            for m in (g.get("leaders") or []) + (g.get("catchUp") or []):
                member_rows.append((
                    group_id, m["assetId"], m["ticker"], m["name"], m["role"],
                    m["price"], m["returnPct"], m.get("rvol"), m.get("avgTradedValue20d"),
                    m.get("atrPct"), m.get("atrExtension"), m["firstSeenAt"], m["reason"],
                    m.get("referenceEntry"), m.get("invalidationStop"), m.get("targetZone"),
                ))
            if member_rows:
                execute_values(
                    cur,
                    """
                    insert into public.sector_thrust_members
                      (group_id, asset_id, ticker, name, role, price, return_pct, rvol,
                       avg_traded_value_20d, atr_pct, atr_extension, first_seen_at, reason,
                       reference_entry, invalidation_stop, target_zone)
                    values %s
                    """,
                    member_rows,
                    page_size=200,
                )
    conn.commit()
    return run_id


def run_live_or_eod(conn, market: str, mode: str, session_date_override: str | None = None) -> int:
    cfg = MARKET_CONFIG[market]
    t0 = time_mod.monotonic()
    now_utc = datetime.now(timezone.utc)
    local_now = now_utc.astimezone(cfg["tz"])

    with conn.cursor() as cur:
        cur.execute("select pg_try_advisory_lock(%s)", (cfg["lock_key"],))
        if not cur.fetchone()[0]:
            print(f"[sector-thrust] skipping {market} {mode}; another scan holds lock")
            return 0

    try:
        with conn.cursor() as cur:
            if session_date_override:
                session_date = session_date_override
            elif mode == "EOD":
                cur.execute(
                    """
                    select max(o.date)::text
                      from public.daily_ohlcv o
                      join public.assets a on a.id = o.asset_id
                     where a.country = %s and o.date >= current_date - interval '10 days'
                    """,
                    (cfg["country"],),
                )
                session_date = cur.fetchone()[0] or local_now.date().isoformat()
            else:
                session_date = local_now.date().isoformat()

            baselines = _load_completed_baselines(cur, cfg["country"], session_date, cfg["value_floor"])
            asset_ids = [b["assetId"] for b in baselines]
            curve_ver, curve_pts = _load_volume_curve(cur, market, session_date)
            articles = _load_recent_articles(cur, market, now_utc)

            # Prior session triggers to preserve first_triggered_at across checkpoints
            cur.execute(
                """
                select group_level || ':' || group_key, min(first_triggered_at)
                  from public.sector_thrust_groups
                 where market = %s and session_date = %s::date and first_triggered_at is not null
                 group by 1
                """,
                (market, session_date),
            )
            prior_triggers = {r[0]: r[1].isoformat() for r in cur.fetchall() if r[1]}

            cur.execute(
                """
                select m.asset_id::text, min(m.first_seen_at)
                  from public.sector_thrust_members m
                  join public.sector_thrust_groups g on g.id = m.group_id
                 where g.market = %s and g.session_date = %s::date
                 group by 1
                """,
                (market, session_date),
            )
            prior_seen = {r[0]: r[1].isoformat() for r in cur.fetchall() if r[1]}

            if mode == "EOD":
                cur.execute(
                    """
                    select asset_id::text, close, volume
                      from public.daily_ohlcv
                     where date = %s::date and asset_id = any(%s::uuid[])
                    """,
                    (session_date, asset_ids),
                )
                eod_map = {r[0]: (float(r[1]), float(r[2]) if r[2] is not None else None) for r in cur.fetchall() if r[1]}
                for b in baselines:
                    bar = eod_map.get(b["assetId"])
                    if bar:
                        b["price"] = bar[0]
                        b["priceFresh"] = True
                        b["sessionVolume"] = bar[1]
                        b["volumeFresh"] = bar[1] is not None and bar[1] >= 0
                    else:
                        b["price"] = None
                        b["priceFresh"] = False
                        b["sessionVolume"] = None
                        b["volumeFresh"] = False
                progress = 1.0
            else:
                # Live quotes + provenance-checked session_volume
                cur.execute(
                    """
                    select asset_id::text, price, as_of::text, updated_at,
                           session_volume, session_volume_date::text, session_volume_at
                      from public.latest_quotes
                     where asset_id = any(%s::uuid[])
                    """,
                    (asset_ids,),
                )
                q_map = {r[0]: r[1:] for r in cur.fetchall()}

                # Cumulative volume from intraday_bars for today's session (fresh if max bar_time <= 5 min old)
                cur.execute(
                    """
                    select asset_id::text, sum(volume), max(bar_time)
                      from public.intraday_bars
                     where asset_id = any(%s::uuid[])
                       and (bar_time at time zone %s)::date = %s::date
                     group by asset_id
                    """,
                    (asset_ids, cfg["tz"].key, session_date),
                )
                ib_map = {r[0]: (float(r[1]) if r[1] is not None else None, r[2]) for r in cur.fetchall()}

                fresh_cutoff = now_utc - timedelta(minutes=5)
                for b in baselines:
                    q = q_map.get(b["assetId"])
                    ib = ib_map.get(b["assetId"])
                    if q and q[0] is not None and q[1] == session_date and q[2] and q[2] >= fresh_cutoff:
                        b["price"] = float(q[0])
                        b["priceFresh"] = True
                    else:
                        b["price"] = None
                        b["priceFresh"] = False

                    # Volume is fresh ONLY if provenance date == session_date and observation <= 5 min old
                    vol_val = None
                    vol_fresh = False
                    if q and q[3] is not None and q[4] == session_date and q[5] and q[5] >= fresh_cutoff:
                        vol_val = float(q[3])
                        vol_fresh = True
                    elif ib and ib[0] is not None and ib[1] and ib[1] >= fresh_cutoff:
                        vol_val = ib[0]
                        vol_fresh = True
                    b["sessionVolume"] = vol_val
                    b["volumeFresh"] = vol_fresh
                progress = _session_progress(market, now_utc)

        result = assess_market_checkpoint({
            "market": market,
            "mode": mode,
            "sessionDate": session_date,
            "checkpointAt": now_utc.isoformat(),
            "priceFloor": cfg["price_floor"],
            "tradedValueFloor": cfg["value_floor"],
            "sessionProgress": progress,
            "volumeCurvePoints": curve_pts,
            "curveVersion": curve_ver,
            "priorGroupTriggers": prior_triggers,
            "priorMemberFirstSeen": prior_seen,
            "articles": articles,
            "assets": baselines,
        })
        duration_ms = int((time_mod.monotonic() - t0) * 1000)
        run_id = _persist_run(conn, result, duration_ms, baselines)
        s = result["summary"]
        print(
            f"[sector-thrust] {market} {mode} {session_date} run={run_id} status={result['status']} "
            f"active={s['activeGroups']} faded={s['fadedGroups']} unverified={s['unverifiedGroups']} "
            f"unclassified={result['unclassifiedCount']} ({duration_ms}ms)"
        )
        return 0
    finally:
        with conn.cursor() as cur:
            cur.execute("select pg_advisory_unlock(%s)", (cfg["lock_key"],))
        conn.commit()


def run_eod_replay(conn, market: str, sessions: int) -> int:
    """Isolated 20+ session closing-data replay (read-only) with Catch-Up ATR A/B comparison."""
    cfg = MARKET_CONFIG[market]
    with conn.cursor() as cur:
        cur.execute(
            """
            select o.date::text
              from public.daily_ohlcv o
              join public.assets a on a.id = o.asset_id
             where a.country = %s and a.asset_class = 'STOCK'
             group by o.date
            having count(*) >= 500
             order by o.date desc
             limit %s
            """,
            (cfg["country"], sessions),
        )
        dates = [r[0] for r in cur.fetchall()][::-1]

    print(f"=== SECTOR THRUST EOD REPLAY ({market}, {len(dates)} sessions: {dates[0]} -> {dates[-1]}) ===")
    trigger_counts: dict[str, int] = defaultdict(int)
    catch_up_1atr = 0
    catch_up_wide = 0

    for dt in dates:
        with conn.cursor() as cur:
            baselines = _load_completed_baselines(cur, cfg["country"], dt, cfg["value_floor"])
            asset_ids = [b["assetId"] for b in baselines]
            cur.execute(
                "select asset_id::text, close, volume from public.daily_ohlcv where date = %s::date and asset_id = any(%s::uuid[])",
                (dt, asset_ids),
            )
            eod_map = {r[0]: (float(r[1]), float(r[2]) if r[2] is not None else None) for r in cur.fetchall() if r[1]}
            for b in baselines:
                bar = eod_map.get(b["assetId"])
                b["price"] = bar[0] if bar else None
                b["priceFresh"] = bar is not None
                b["sessionVolume"] = bar[1] if bar else None
                b["volumeFresh"] = bar is not None and bar[1] is not None and bar[1] >= 0

        res_base = assess_market_checkpoint({
            "market": market, "mode": "EOD", "sessionDate": dt,
            "checkpointAt": f"{dt}T10:00:00Z", "priceFloor": cfg["price_floor"],
            "tradedValueFloor": cfg["value_floor"], "assets": baselines,
        })
        res_wide = assess_market_checkpoint({
            "market": market, "mode": "EOD", "sessionDate": dt,
            "checkpointAt": f"{dt}T10:00:00Z", "priceFloor": cfg["price_floor"],
            "tradedValueFloor": cfg["value_floor"], "assets": baselines,
            "catchUpFloorPct": 2.5,
        })
        active = [g for g in res_base["groups"] if g["status"] == "ACTIVE"]
        for g in active:
            trigger_counts[f"{g['groupLevel']}:{g['groupLabel']}"] += 1
            catch_up_1atr += len(g["catchUp"])
        for g in res_wide["groups"]:
            if g["status"] == "ACTIVE":
                catch_up_wide += len(g["catchUp"])

        if active:
            summary_str = ", ".join(
                f"{g['groupLabel']} ({g['qualifyingCount']}/{g['eligibleCount']}, med {g['medianReturnPct']:+.1f}%, {len(g['catchUp'])} catch-up)"
                for g in active[:5]
            )
            print(f"  {dt}: {len(active)} active -> {summary_str}")
        else:
            print(f"  {dt}: 0 active (quiet session)")

    print("\n=== TRIGGER FREQUENCY SUMMARY ===")
    for k, v in sorted(trigger_counts.items(), key=lambda kv: (-kv[1], kv[0])):
        print(f"  {k:38s}: {v}/{len(dates)} sessions")
    print(f"\nCatch-Up Watch A/B (across all active groups): baseline <=1.0 ATR = {catch_up_1atr} | <=max(1 ATR, 2.5%) = {catch_up_wide}")
    return 0


def run_intraday_replay(conn, market: str, target_date: str) -> int:
    """Reconstructed 5-min checkpoint replay over retained intraday_bars (strictly prior volume curve)."""
    cfg = MARKET_CONFIG[market]
    with conn.cursor() as cur:
        baselines = _load_completed_baselines(cur, cfg["country"], target_date, cfg["value_floor"])
        asset_ids = [b["assetId"] for b in baselines]
        curve_ver, curve_pts = _load_volume_curve(cur, market, target_date)
        cur.execute(
            """
            select asset_id::text, bar_time, close, volume
              from public.intraday_bars
             where asset_id = any(%s::uuid[])
               and (bar_time at time zone %s)::date = %s::date
             order by bar_time asc
            """,
            (asset_ids, cfg["tz"].key, target_date),
        )
        bars_by_asset: dict[str, list[tuple[datetime, float, float]]] = defaultdict(list)
        for aid, bt, cl, vol in cur.fetchall():
            if cl is not None:
                bars_by_asset[aid].append((bt, float(cl), float(vol or 0)))

    print(f"=== RECONSTRUCTED INTRADAY REPLAY ({market}, {target_date}, curve={curve_ver}) ===")
    print(f"Eligible liquid assets: {len(baselines)} | Assets with intraday_bars: {len(bars_by_asset)}")
    tz = cfg["tz"]
    day = date.fromisoformat(target_date)
    start_dt = datetime.combine(day, time(9, 30) if market == "IN" else time(9, 45), tzinfo=tz).astimezone(timezone.utc)
    end_dt = datetime.combine(day, cfg["close"], tzinfo=tz).astimezone(timezone.utc)

    first_triggers: dict[str, str] = {}
    cur_dt = start_dt
    while cur_dt <= end_dt:
        fresh_cutoff = cur_dt - timedelta(minutes=5)
        for b in baselines:
            aid = b["assetId"]
            series = bars_by_asset.get(aid)
            if not series:
                b["price"] = None
                b["priceFresh"] = False
                b["sessionVolume"] = None
                b["volumeFresh"] = False
                continue
            cum_vol = 0.0
            last_bt = None
            last_close = None
            for bt, cl, vol in series:
                if bt > cur_dt:
                    break
                cum_vol += vol
                last_bt = bt
                last_close = cl
            fresh = last_bt is not None and last_bt >= fresh_cutoff
            b["price"] = last_close if fresh else None
            b["priceFresh"] = fresh
            b["sessionVolume"] = cum_vol if fresh else None
            b["volumeFresh"] = fresh

        res = assess_market_checkpoint({
            "market": market, "mode": "LIVE", "sessionDate": target_date,
            "checkpointAt": cur_dt.isoformat(), "priceFloor": cfg["price_floor"],
            "tradedValueFloor": cfg["value_floor"],
            "sessionProgress": _session_progress(market, cur_dt),
            "volumeCurvePoints": curve_pts, "curveVersion": curve_ver,
            "priorGroupTriggers": first_triggers, "assets": baselines,
        })
        for g in res["groups"]:
            key = f"{g['groupLevel']}:{g['groupKey']}"
            if g["status"] == "ACTIVE" and key not in first_triggers:
                first_triggers[key] = cur_dt.astimezone(tz).strftime("%H:%M")
                print(
                    f"  [{first_triggers[key]} {tz.key}] FIRST TRIGGER (reconstructed): {g['groupLabel']} "
                    f"({g['qualifyingCount']}/{g['eligibleCount']}, fresh={g['priceFreshCount']}, med={g['medianReturnPct']:+.1f}%)"
                )
        cur_dt += timedelta(minutes=5)

    if not first_triggers:
        print("  No groups met >=70% intraday bar coverage + thrust thresholds (INCONCLUSIVE due to intraday_bars coverage).")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--market", choices=("IN", "US"), default="IN")
    parser.add_argument("--mode", choices=("LIVE", "EOD"), default="LIVE")
    parser.add_argument("--session-date", default=None)
    parser.add_argument("--replay-eod", action="store_true")
    parser.add_argument("--sessions", type=int, default=20)
    parser.add_argument("--replay-intraday", action="store_true")
    parser.add_argument("--date", default=None)
    args = parser.parse_args()

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        raise SystemExit("DATABASE_URL is required")

    with psycopg2.connect(db_url) as conn:
        if args.replay_eod:
            return run_eod_replay(conn, args.market, args.sessions)
        if args.replay_intraday:
            if not args.date:
                raise SystemExit("--date YYYY-MM-DD is required for --replay-intraday")
            return run_intraday_replay(conn, args.market, args.date)
        return run_live_or_eod(conn, args.market, args.mode, args.session_date)


if __name__ == "__main__":
    raise SystemExit(main())
