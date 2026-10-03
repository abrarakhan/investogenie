#!/usr/bin/env python3
"""Fail-closed NSE cash limit-order worker for explicitly enabled users.

The worker never sells, modifies, cancels, or submits market/derivative orders.
Every attempted order is reserved in breeze_order_intents before the broker call,
so restarts cannot duplicate a request.
"""
from __future__ import annotations

import datetime as dt
import json
import math
from decimal import Decimal, ROUND_UP

import psycopg2
from psycopg2.extras import Json

from breeze_account_sync import as_number, response_rows
from breeze_market_daemon import IST, database_url, decrypt_credential, env, is_india_market_session


def round_limit(value: Decimal) -> Decimal:
    return (value / Decimal("0.05")).quantize(Decimal("1"), rounding=ROUND_UP) * Decimal("0.05")


def available_funds(breeze) -> Decimal:
    rows = response_rows(breeze.get_funds())
    # Prefer the broker's spendable cash field. Do not take the maximum across
    # unrelated balance fields; that can mistake collateral or bank balance for
    # executable equity buying power.
    for key in ("cash_limit", "available_balance", "limit_amount"):
        values = []
        for row in rows:
            lowered = {str(k).lower(): v for k, v in row.items()}
            value = as_number(lowered.get(key))
            if value is not None and value >= 0:
                values.append(value)
        if values:
            return min(values)
    raise RuntimeError("Breeze spendable cash could not be verified")


def candidates(conn, user_id: str, strong: bool, adaptive: bool):
    rows = []
    with conn.cursor() as cur:
        if strong:
            cur.execute("""
              with latest as (select max(captured_at) at from public.strong_swing_snapshots where market='IN')
              select 'STRONG_SWING',s.captured_at::text || ':' || s.asset_id::text,s.asset_id,
                     m.stock_code,m.exchange_code,s.confirmation_entry,1::numeric
                from public.strong_swing_snapshots s join latest l on s.captured_at=l.at
                join public.breeze_instrument_map m on m.asset_id=s.asset_id
               where s.market='IN' and s.status='EXECUTION_READY'
                 and s.captured_at >= now()-interval '20 minutes'
               order by s.rank limit 1
            """)
            rows.extend(cur.fetchall())
        if adaptive:
            cur.execute("""
              select 'ADAPTIVE_ALLOCATION',s.id::text || ':' || r.as_of::text || ':' || x.asset_id::text,
                     x.asset_id,m.stock_code,m.exchange_code,q.best_ask,x.weight
                from public.adaptive_allocation_strategies s
                join lateral (select * from public.adaptive_allocation_runs ar where ar.strategy_id=s.id order by as_of desc limit 1) r on true
                cross join lateral (values(s.asset_a_id,r.target_weight_a),(s.asset_b_id,r.target_weight_b)) x(asset_id,weight)
                join public.breeze_instrument_map m on m.asset_id=x.asset_id
                join public.latest_quotes q on q.asset_id=x.asset_id
               where s.user_id=%s and s.market='IN' and s.status='ACTIVE' and x.weight>0
                 and r.as_of >= current_date-interval '7 days'
               order by s.created_at,x.weight desc
            """, (user_id,))
            rows.extend(cur.fetchall())
    return rows


def execute_account(conn, row) -> None:
    from breeze_connect import BreezeConnect
    (user_id, api_key_enc, api_secret_enc, session_enc, strong, adaptive,
     daily_budget, max_order, max_orders, buffer_bps) = row
    master = env("CREDENTIAL_ENCRYPTION_KEY")
    if not master:
        raise RuntimeError("CREDENTIAL_ENCRYPTION_KEY is not configured")
    with conn.cursor() as cur:
        cur.execute("""select count(*)::int,coalesce(sum(estimated_value),0)
          from public.breeze_order_intents where user_id=%s and trade_date=current_date
          and status in ('PENDING','SUBMITTED')""", (user_id,))
        count, spent = cur.fetchone()
    remaining = Decimal(str(daily_budget)) - Decimal(str(spent))
    slots = int(max_orders) - int(count)
    if remaining <= 0 or slots <= 0:
        return
    breeze = BreezeConnect(api_key=decrypt_credential(api_key_enc, master))
    breeze.generate_session(api_secret=decrypt_credential(api_secret_enc, master), session_token=decrypt_credential(session_enc, master))
    funds = available_funds(breeze)
    today = dt.datetime.now(IST).date()
    for source, source_ref, asset_id, stock_code, exchange, raw_price, weight in candidates(conn, user_id, strong, adaptive):
        if slots <= 0 or remaining <= 0:
            break
        with conn.cursor() as cur:
            cur.execute("""select best_ask,best_bid,upper_circuit,updated_at,source from public.latest_quotes where asset_id=%s""", (asset_id,))
            quote = cur.fetchone()
        if not quote or quote[4] != "BREEZE_LIVE" or not quote[3] or dt.datetime.now(dt.timezone.utc)-quote[3] > dt.timedelta(minutes=5):
            continue
        ask, bid, upper = map(lambda v: Decimal(str(v)) if v is not None else None, quote[:3])
        if not ask or ask <= 0 or (bid and (ask-bid)/ask > Decimal("0.01")):
            continue
        if source == "STRONG_SWING" and raw_price and ask > Decimal(str(raw_price)) * (Decimal("1") + Decimal(str(buffer_bps))/Decimal("10000")):
            continue
        price = round_limit(ask * (Decimal("1") + Decimal(str(buffer_bps))/Decimal("10000")))
        if upper and price > upper:
            continue
        allocation = min(remaining, Decimal(str(max_order)))
        if source == "ADAPTIVE_ALLOCATION":
            allocation *= Decimal(str(weight))
        quantity = math.floor(allocation / price)
        estimated = price * quantity
        if quantity < 1 or estimated > funds:
            continue
        intent_id = None
        with conn.cursor() as cur:
            cur.execute("""insert into public.breeze_order_intents
              (user_id,source,source_ref,trade_date,asset_id,stock_code,exchange_code,quantity,limit_price,estimated_value,status)
              values(%s,%s,%s,%s,%s,%s,'NSE',%s,%s,%s,'PENDING') on conflict do nothing returning id""",
              (user_id,source,source_ref,today,asset_id,stock_code,quantity,price,estimated))
            saved = cur.fetchone()
            intent_id = saved[0] if saved else None
        conn.commit()
        if not intent_id:
            continue
        try:
            response = breeze.place_order(stock_code=stock_code, exchange_code="NSE", product="cash",
                action="buy", order_type="limit", stoploss="", quantity=str(quantity), price=str(price), validity="day")
            error = response.get("Error") if isinstance(response, dict) else "Unexpected Breeze response"
            success = response.get("Success") if isinstance(response, dict) else None
            order_id = success.get("order_id") if isinstance(success, dict) else None
            status = "SUBMITTED" if order_id and not error else "REJECTED"
            with conn.cursor() as cur:
                cur.execute("""update public.breeze_order_intents set status=%s,broker_order_id=%s,
                  broker_response=%s,error=%s,updated_at=now() where id=%s""",
                  (status,order_id,Json(response),str(error) if error else None,intent_id))
            conn.commit()
            if status == "SUBMITTED":
                remaining -= estimated; funds -= estimated; slots -= 1
        except Exception as exc:
            conn.rollback()
            with conn.cursor() as cur:
                cur.execute("update public.breeze_order_intents set status='ERROR',error=%s,updated_at=now() where id=%s", (str(exc),intent_id))
            conn.commit()


def main() -> int:
    now = dt.datetime.now(IST)
    if not is_india_market_session(now, now):
        print("[breeze-auto-buy] market closed; skipping", flush=True); return 0
    with psycopg2.connect(database_url()) as conn, conn.cursor() as cur:
        cur.execute("""select s.user_id::text,c.breeze_api_key_encrypted,c.breeze_api_secret_encrypted,
          c.breeze_session_token_encrypted,s.strong_swing_enabled,s.adaptive_allocation_enabled,
          s.daily_budget,s.max_order_value,s.max_orders_per_day,s.limit_buffer_bps
          from public.breeze_auto_buy_settings s join public.user_credentials c on c.user_id=s.user_id
          where s.enabled and s.acknowledged_at is not null and c.breeze_session_token_encrypted is not null""")
        accounts = cur.fetchall()
        for account in accounts:
            execute_account(conn, account)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
