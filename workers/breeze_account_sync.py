#!/usr/bin/env python3
"""Read-only Breeze broker account reconciliation.

Fetches funds, demat holdings, positions, orders and trades. It never invokes
an order mutation endpoint and never changes the InvestoGenie trade ledger.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import sys
from decimal import Decimal, InvalidOperation
from typing import Any, Callable

import psycopg2
from psycopg2.extras import Json, execute_values

from breeze_market_daemon import database_url, decrypt_credential, env


INVESTOGENIE_ACTIVITY_START = dt.datetime(2026, 8, 1, tzinfo=dt.timezone.utc)


def as_number(*values: Any) -> Decimal | None:
    for value in values:
        if value in (None, "", "--", "-"):
            continue
        try:
            return Decimal(str(value).replace(",", ""))
        except InvalidOperation:
            continue
    return None


def first(record: dict[str, Any], *names: str) -> Any:
    lowered = {str(key).lower(): value for key, value in record.items()}
    return next((lowered[name.lower()] for name in names if name.lower() in lowered), None)


def response_rows(response: Any) -> list[dict[str, Any]]:
    if not isinstance(response, dict):
        raise RuntimeError("Breeze returned a non-object response")
    error = response.get("Error") or response.get("error")
    if error:
        if "no data found" in str(error).lower():
            return []
        raise RuntimeError(str(error))
    success = response.get("Success", response.get("success"))
    if success is None:
        return []
    if isinstance(success, list):
        return [row for row in success if isinstance(row, dict)]
    if isinstance(success, dict):
        return [success]
    raise RuntimeError("Breeze response has an unexpected Success payload")


def load_accounts(conn) -> list[tuple[str, str, str, str]]:
    master_key = env("CREDENTIAL_ENCRYPTION_KEY")
    if not master_key:
        raise RuntimeError("CREDENTIAL_ENCRYPTION_KEY is not configured")
    with conn.cursor() as cur:
        cur.execute(
            """
            select user_id::text,breeze_api_key_encrypted,breeze_api_secret_encrypted,
                   breeze_session_token_encrypted
              from public.user_credentials
             where breeze_api_key_encrypted is not null
               and breeze_api_secret_encrypted is not null
               and breeze_session_token_encrypted is not null
            """
        )
        rows = cur.fetchall()
    return [
        (user_id, decrypt_credential(api_key, master_key),
         decrypt_credential(api_secret, master_key), decrypt_credential(session_token, master_key))
        for user_id, api_key, api_secret, session_token in rows
    ]


def external_key(kind: str, row: dict[str, Any], index: int) -> str:
    candidates = {
        "HOLDING": ("isin", "stock_code", "stockcode"),
        "POSITION": ("segment", "stock_code", "expiry_date", "strike_price", "right", "product_type"),
        "ORDER": ("order_id", "order_reference", "orderreference"),
        "TRADE": ("trade_id", "order_id", "order_reference"),
        "FUNDS": ("segment", "account_type", "bank_account"),
    }[kind]
    parts = [str(first(row, name)).strip() for name in candidates if first(row, name) not in (None, "")]
    if parts:
        return "|".join(parts)
    digest = hashlib.sha256(json.dumps(row, sort_keys=True, default=str).encode()).hexdigest()[:20]
    return f"{kind.lower()}-{index}-{digest}"


def replace_snapshot(conn, user_id: str, kind: str, rows: list[dict[str, Any]]) -> None:
    captured_at = dt.datetime.now(dt.timezone.utc)
    payload = []
    seen: dict[str, int] = {}
    for index, row in enumerate(rows):
        key = external_key(kind, row, index)
        seen[key] = seen.get(key, 0) + 1
        if seen[key] > 1:
            key = f"{key}|{seen[key]}"
        payload.append((
            user_id, kind, key,
            first(row, "exchange_code", "exchange"),
            first(row, "stock_code", "stockcode", "symbol"),
            first(row, "order_id", "order_reference"),
            first(row, "action", "order_flow"),
            first(row, "status", "order_status"),
            as_number(first(row, "quantity", "current_quantity", "available_quantity")),
            as_number(first(row, "average_price", "average_cost", "price")),
            as_number(first(row, "current_market_price", "ltp", "market_price")),
            as_number(first(row, "amount", "available_balance", "total_bank_balance", "limit_amount")),
            Json(row), captured_at,
        ))
    with conn.cursor() as cur:
        cur.execute(
            "delete from public.breeze_broker_snapshots where user_id=%s and snapshot_type=%s",
            (user_id, kind),
        )
        if payload:
            execute_values(
                cur,
                """
                insert into public.breeze_broker_snapshots
                  (user_id,snapshot_type,external_key,exchange_code,stock_code,order_id,
                   action,status,quantity,average_price,market_price,amount,raw_data,captured_at)
                values %s
                """,
                payload,
                page_size=250,
            )


def sync_account(conn, user_id: str, api_key: str, api_secret: str, session_token: str) -> None:
    from breeze_connect import BreezeConnect

    with conn.cursor() as cur:
        cur.execute(
            "insert into public.breeze_broker_syncs (user_id,status) values (%s,'RUNNING') returning id",
            (user_id,),
        )
        sync_id = cur.fetchone()[0]
    conn.commit()

    breeze = BreezeConnect(api_key=api_key)
    errors: list[str] = []
    counts = {kind: 0 for kind in ("HOLDING", "POSITION", "ORDER", "TRADE", "FUNDS")}
    try:
        breeze.generate_session(api_secret=api_secret, session_token=session_token)
        now = dt.datetime.now(dt.timezone.utc)
        start = INVESTOGENIE_ACTIVITY_START
        from_date = start.isoformat(timespec="milliseconds").replace("+00:00", "Z")
        to_date = now.isoformat(timespec="milliseconds").replace("+00:00", "Z")
        jobs: list[tuple[str, Callable[[], Any]]] = [
            ("FUNDS", breeze.get_funds),
            ("HOLDING", breeze.get_demat_holdings),
            ("POSITION", breeze.get_portfolio_positions),
        ]
        for exchange in ("NSE", "NFO"):
            jobs.extend([
                ("ORDER", lambda exchange=exchange: breeze.get_order_list(exchange, from_date, to_date)),
                ("TRADE", lambda exchange=exchange: breeze.get_trade_list(from_date, to_date, exchange)),
            ])

        collected: dict[str, list[dict[str, Any]]] = {kind: [] for kind in counts}
        successful: set[str] = set()
        for kind, fetch in jobs:
            try:
                collected[kind].extend(response_rows(fetch()))
                successful.add(kind)
            except Exception as exc:
                errors.append(f"{kind}: {exc}")

        for kind in successful:
            replace_snapshot(conn, user_id, kind, collected[kind])
            counts[kind] = len(collected[kind])
        status = "SUCCESS" if not errors else ("PARTIAL" if successful else "FAILED")
        with conn.cursor() as cur:
            cur.execute(
                """
                update public.breeze_broker_syncs set status=%s,holdings_count=%s,
                  positions_count=%s,orders_count=%s,trades_count=%s,error=%s,finished_at=now()
                where id=%s
                """,
                (status, counts["HOLDING"], counts["POSITION"], counts["ORDER"],
                 counts["TRADE"], "; ".join(errors) or None, sync_id),
            )
        conn.commit()
        print(
            f"[breeze-account] {user_id} {status.lower()} holdings={counts['HOLDING']} "
            f"positions={counts['POSITION']} orders={counts['ORDER']} trades={counts['TRADE']}",
            flush=True,
        )
    except Exception as exc:
        conn.rollback()
        with conn.cursor() as cur:
            cur.execute(
                "update public.breeze_broker_syncs set status='FAILED',error=%s,finished_at=now() where id=%s",
                (str(exc), sync_id),
            )
        conn.commit()
        print(f"[breeze-account] {user_id} failed: {exc}", file=sys.stderr, flush=True)


def main() -> int:
    with psycopg2.connect(database_url()) as conn:
        accounts = load_accounts(conn)
        if not accounts:
            print("[breeze-account] no configured Breeze accounts; skipping", flush=True)
            return 0
        for account in accounts:
            sync_account(conn, *account)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
