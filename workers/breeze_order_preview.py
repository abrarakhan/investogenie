"""Read-only estimate of the broker's charges for a cash order.

Asks Breeze's preview endpoint what an order would cost. It never places,
changes or cancels an order, and it writes nothing to the database.
"""
import json
import sys

import psycopg2
from breeze_market_daemon import database_url, decrypt_credential, env, number
from breeze_account_sync import BrokerError, is_quota_error, response_rows

CHARGES = (
    ("brokerage", "Brokerage"),
    ("stt", "Securities transaction tax"),
    ("stamp_duty", "Stamp duty"),
    ("exchange_turnover_charges", "Exchange turnover charges"),
    ("sebi_charges", "SEBI charges"),
    ("gst", "GST"),
)


def preview_costs(success: dict, price: float, quantity: float) -> dict:
    """Shape the broker's answer for display. The total is the broker's own figure
    when it gives one; otherwise the sum of the parts it itemised."""
    lines = [
        {"key": key, "label": label, "amount": round(amount, 2)}
        for key, label in CHARGES
        if (amount := number(success.get(key))) is not None
    ]
    total = number(success.get("total_brokerage"))
    if total is None:
        if not lines:
            raise RuntimeError("Breeze returned no charges for this order")
        total = sum(line["amount"] for line in lines)
    order_value = price * quantity
    return {
        "orderValue": round(order_value, 2),
        "charges": lines,
        "totalCharges": round(total, 2),
        "chargesPct": round(total / order_value * 100, 3) if order_value > 0 else None,
    }


def main() -> dict:
    from breeze_connect import BreezeConnect

    user_id, asset_id, action = sys.argv[1], sys.argv[2], sys.argv[3].lower()
    price, quantity = float(sys.argv[4]), float(sys.argv[5])
    if action not in ("buy", "sell") or price <= 0 or quantity <= 0 or quantity != int(quantity):
        raise RuntimeError("Invalid order")
    with psycopg2.connect(database_url()) as conn, conn.cursor() as cur:
        cur.execute(
            "select breeze_api_key_encrypted,breeze_api_secret_encrypted,breeze_session_token_encrypted "
            "from public.user_credentials where user_id=%s", (user_id,))
        credential = cur.fetchone()
        if not credential or not all(credential):
            raise RuntimeError("Connect Breeze in Settings first")
        cur.execute(
            "select m.stock_code,m.exchange_code from public.breeze_instrument_map m "
            "join public.assets a on a.id=m.asset_id where a.country='IN' and m.asset_id=%s::uuid", (asset_id,))
        instrument = cur.fetchone()
    if not instrument:
        raise RuntimeError("This stock is not on the Breeze live feed, so its charges cannot be estimated")
    key, secret, token = [decrypt_credential(value, env("CREDENTIAL_ENCRYPTION_KEY") or "") for value in credential]
    breeze = BreezeConnect(api_key=key)
    breeze.generate_session(api_secret=secret, session_token=token)
    try:
        rows = response_rows(breeze.preview_order(
            stock_code=instrument[0], exchange_code=instrument[1], product="cash", order_type="limit",
            price=f"{price:.2f}", action=action, quantity=str(int(quantity)), specialflag="N",
        ))
    except BrokerError as exc:
        if is_quota_error(exc):
            raise RuntimeError("Breeze's daily allowance for this request is spent; try again tomorrow") from exc
        raise RuntimeError(f"Breeze declined the estimate: {exc}") from exc
    if not rows:
        raise RuntimeError("Breeze returned no charges for this order")
    return preview_costs(rows[0], price, quantity)


if __name__ == "__main__":
    try:
        print(json.dumps(main()))
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
        sys.exit(1)
