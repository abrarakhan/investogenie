"""Read-only, bounded quote refresh for an authenticated user's visible assets."""
import datetime as dt
import json
import sys
import time

import psycopg2
from breeze_market_daemon import database_url, decrypt_credential, env, integer, number, IST
from breeze_account_sync import response_rows


def execution_fields(row):
    """Normalize the execution fields exposed by Breeze's cash REST quote."""
    return {
        "best_bid": number(row.get("best_bid_price")),
        "best_ask": number(row.get("best_offer_price")),
        "bid_quantity": integer(row.get("best_bid_quantity")),
        "ask_quantity": integer(row.get("best_offer_quantity")),
        "lower_circuit": number(row.get("lower_circuit")),
        "upper_circuit": number(row.get("upper_circuit")),
    }


def materially_changed(previous, current, tolerance=1e-9):
    """Compare displayed/execution fields, deliberately excluding freshness."""
    if previous is None:
        return True
    for old, new in zip(previous, current):
        if old is None or new is None:
            if old is not None or new is not None:
                return True
            continue
        try:
            if abs(float(old) - float(new)) > tolerance:
                return True
        except (TypeError, ValueError):
            if old != new:
                return True
    return False


# The live worker rewrites a subscribed stock's quote every few seconds. Asking
# Breeze again for those spends the daily request allowance and trips its
# per-minute limit, so only stocks the feed is not carrying are fetched here.
FEED_FRESH_SECONDS = 90


def same_session(previous_as_of, stamp):
    """Whether the stored quote belongs to the same market day as a new tick.

    latest_quotes.as_of is a DATE; a datetime is accepted too so the comparison
    cannot break on the column's type again.
    """
    if previous_as_of is None:
        return False
    day = previous_as_of.date() if isinstance(previous_as_of, dt.datetime) else previous_as_of
    return day == stamp.date()


def main():
    user_id = sys.argv[1]
    ids = json.loads(sys.argv[2])[:50]
    updated = 0
    changed = 0
    live = 0
    errors = []
    with psycopg2.connect(database_url()) as conn:
        with conn.cursor() as cur:
            cur.execute("select breeze_api_key_encrypted,breeze_api_secret_encrypted,breeze_session_token_encrypted from public.user_credentials where user_id=%s", (user_id,))
            credential = cur.fetchone()
            if not credential or not all(credential):
                raise RuntimeError("Connect Breeze in Settings first")
            key, secret, token = [decrypt_credential(value, env("CREDENTIAL_ENCRYPTION_KEY") or "") for value in credential]
            cur.execute(
                """select m.asset_id::text,m.stock_code,m.exchange_code,
                          coalesce(q.source='BREEZE_LIVE'
                                   and q.updated_at > now() - make_interval(secs => %s), false)
                     from public.breeze_instrument_map m
                     join public.assets a on a.id=m.asset_id
                     left join public.latest_quotes q on q.asset_id=m.asset_id
                    where a.country='IN' and m.asset_id=any(%s::uuid[])""",
                (FEED_FRESH_SECONDS, ids),
            )
            mapped = cur.fetchall()
        assets = [row[:3] for row in mapped if not row[3]]
        live = len(mapped) - len(assets)
        if not assets:
            print(json.dumps({"updated": 0, "changed": 0, "live": live, "unmapped": len(ids)-len(mapped), "errors": []}))
            return
        # Imported late: the SDK downloads the security master on import.
        from breeze_connect import BreezeConnect
        breeze = BreezeConnect(api_key=key)
        breeze.generate_session(api_secret=secret, session_token=token)
        for asset_id, code, exchange in assets:
            try:
                rows = response_rows(breeze.get_quotes(stock_code=code, exchange_code=exchange, product_type="cash"))
                row = next((r for r in rows if r.get("exchange_code") == exchange and float(r.get("ltp") or 0) > 0), None)
                if not row:
                    raise RuntimeError("No valid cash quote returned")
                stamp = dt.datetime.strptime(row["ltt"], "%d-%b-%Y %H:%M:%S").replace(tzinfo=IST)
                execution = execution_fields(row)
                with conn.cursor() as cur:
                    cur.execute(
                        """select price,change_pct,best_bid,best_ask,
                                  lower_circuit,upper_circuit,as_of
                             from public.latest_quotes where asset_id=%s""",
                        (asset_id,),
                    )
                    previous = cur.fetchone()
                    effective_lower = execution["lower_circuit"]
                    effective_upper = execution["upper_circuit"]
                    if previous is not None and same_session(previous[6], stamp):
                        if effective_lower is None:
                            effective_lower = previous[4]
                        if effective_upper is None:
                            effective_upper = previous[5]
                    current = (
                        row["ltp"], row.get("ltp_percent_change"),
                        execution["best_bid"], execution["best_ask"],
                        effective_lower, effective_upper,
                    )
                    cur.execute("""insert into public.latest_quotes(
                        asset_id,price,change_pct,currency,as_of,source,updated_at,
                        best_bid,best_ask,bid_quantity,ask_quantity,lower_circuit,upper_circuit)
                      values(%s,%s,%s,'INR',%s,'BREEZE_LIVE',now(),%s,%s,%s,%s,%s,%s)
                      on conflict(asset_id) do update set price=excluded.price,change_pct=excluded.change_pct,
                      as_of=excluded.as_of,source=excluded.source,updated_at=now(),
                      best_bid=excluded.best_bid,best_ask=excluded.best_ask,
                      bid_quantity=excluded.bid_quantity,ask_quantity=excluded.ask_quantity,
                      lower_circuit=case
                        when excluded.lower_circuit is not null then excluded.lower_circuit
                        when public.latest_quotes.as_of::date=excluded.as_of::date then public.latest_quotes.lower_circuit
                        else null end,
                      upper_circuit=case
                        when excluded.upper_circuit is not null then excluded.upper_circuit
                        when public.latest_quotes.as_of::date=excluded.as_of::date then public.latest_quotes.upper_circuit
                        else null end
                      where public.latest_quotes.as_of <= excluded.as_of""",
                      (
                          asset_id,row["ltp"],row.get("ltp_percent_change"),stamp,
                          execution["best_bid"],execution["best_ask"],
                          execution["bid_quantity"],execution["ask_quantity"],
                          execution["lower_circuit"],execution["upper_circuit"],
                      ))
                    updated += cur.rowcount
                    if cur.rowcount and materially_changed(previous, current):
                        changed += 1
                conn.commit()
            except Exception as exc:
                conn.rollback()
                errors.append(f"{code}: {exc}")
            time.sleep(0.7)
    print(json.dumps({"updated": updated, "changed": changed, "live": live, "unmapped": len(ids)-len(mapped), "errors": errors}))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"updated": 0, "changed": 0, "errors": [str(exc)]}))
        sys.exit(1)
