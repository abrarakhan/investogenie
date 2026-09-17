"""Read-only, bounded quote refresh for an authenticated user's visible assets."""
import datetime as dt
import json
import sys
import time

import psycopg2
from breeze_connect import BreezeConnect
from breeze_market_daemon import database_url, decrypt_credential, env, IST
from breeze_account_sync import response_rows


def main():
    user_id = sys.argv[1]
    ids = json.loads(sys.argv[2])[:50]
    updated = 0
    errors = []
    with psycopg2.connect(database_url()) as conn:
        with conn.cursor() as cur:
            cur.execute("select breeze_api_key_encrypted,breeze_api_secret_encrypted,breeze_session_token_encrypted from public.user_credentials where user_id=%s", (user_id,))
            credential = cur.fetchone()
            if not credential or not all(credential):
                raise RuntimeError("Connect Breeze in Settings first")
            key, secret, token = [decrypt_credential(value, env("CREDENTIAL_ENCRYPTION_KEY") or "") for value in credential]
            cur.execute("select m.asset_id::text,m.stock_code,m.exchange_code from public.breeze_instrument_map m join public.assets a on a.id=m.asset_id where a.country='IN' and m.asset_id=any(%s::uuid[])", (ids,))
            assets = cur.fetchall()
        breeze = BreezeConnect(api_key=key)
        breeze.generate_session(api_secret=secret, session_token=token)
        for asset_id, code, exchange in assets:
            try:
                rows = response_rows(breeze.get_quotes(stock_code=code, exchange_code=exchange, product_type="cash"))
                row = next((r for r in rows if r.get("exchange_code") == exchange and float(r.get("ltp") or 0) > 0), None)
                if not row:
                    raise RuntimeError("No valid cash quote returned")
                stamp = dt.datetime.strptime(row["ltt"], "%d-%b-%Y %H:%M:%S").replace(tzinfo=IST)
                with conn.cursor() as cur:
                    cur.execute("""insert into public.latest_quotes(asset_id,price,change_pct,currency,as_of,source,updated_at)
                      values(%s,%s,%s,'INR',%s,'BREEZE_LIVE',now())
                      on conflict(asset_id) do update set price=excluded.price,change_pct=excluded.change_pct,
                      as_of=excluded.as_of,source=excluded.source,updated_at=now()
                      where public.latest_quotes.as_of <= excluded.as_of""",
                      (asset_id,row["ltp"],row.get("ltp_percent_change"),stamp))
                    updated += cur.rowcount
                conn.commit()
            except Exception as exc:
                conn.rollback()
                errors.append(f"{code}: {exc}")
            time.sleep(0.7)
    print(json.dumps({"updated": updated, "unmapped": len(ids)-len(assets), "errors": errors}))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"updated": 0, "errors": [str(exc)]}))
        sys.exit(1)
