"""Cancel or change one of the signed-in user's own open NSE cash orders.

Runs only when that user asks for it in the app and confirms. It never places a
new order. Before acting it re-reads the order from the broker (the app's stored
copy can be minutes old), refuses anything that is not an open NSE cash order,
and records the attempt before calling the broker.
"""
import json
import sys
from decimal import Decimal, InvalidOperation

import psycopg2
from psycopg2.extras import Json

from breeze_account_sync import BrokerError, as_number, response_rows
from breeze_market_daemon import database_url, decrypt_credential, env

OPEN_STATUSES = {"ordered", "requested", "queued", "partially executed"}
TICK = Decimal("0.05")
PRIVATE_KEYS = {"user_remark"}


def text(order: dict, key: str) -> str:
    return str(order.get(key) or "").strip()


def filled_quantity(order: dict) -> Decimal:
    quantity = as_number(order.get("quantity")) or Decimal(0)
    pending = as_number(order.get("pending_quantity"))
    cancelled = as_number(order.get("cancelled_quantity")) or Decimal(0)
    return Decimal(0) if pending is None else max(Decimal(0), quantity - pending - cancelled)


def problems(order: dict, action: str, price: Decimal | None, quantity: Decimal | None) -> list[str]:
    """Why this request must be refused; empty when it may go to the broker."""
    found: list[str] = []
    if text(order, "exchange_code").upper() != "NSE" or text(order, "expiry_date") or text(order, "right").lower() not in ("", "others"):
        found.append("Only NSE cash orders can be changed here.")
    if text(order, "status").lower() not in OPEN_STATUSES:
        found.append(f"This order is no longer open (broker status: {text(order, 'status') or 'unknown'}).")
    if action == "CANCEL" or found:
        return found
    if text(order, "order_type").lower() != "limit":
        found.append("Only limit orders can be changed here.")
    if price is None or price <= 0 or price % TICK != 0:
        found.append("The price must be a positive multiple of ₹0.05.")
    if quantity is None or quantity < 1 or quantity != quantity.to_integral_value():
        found.append("The quantity must be a whole number of shares.")
    elif quantity <= filled_quantity(order):
        found.append(f"The quantity must be more than the {filled_quantity(order):f} shares already filled.")
    if not found and price == as_number(order.get("price")) and quantity == as_number(order.get("quantity")):
        found.append("Nothing would change: the price and quantity match the order.")
    return found


def parse_decimal(value: str) -> Decimal | None:
    try:
        return Decimal(value)
    except (InvalidOperation, ValueError):
        return None


def main() -> dict:
    from breeze_connect import BreezeConnect

    if env("BREEZE_ORDER_ACTIONS_DISABLED") == "1":
        raise RuntimeError("Order changes from the app are switched off")
    user_id, action, order_id = sys.argv[1], sys.argv[2].upper(), sys.argv[3].strip()
    if action not in ("CANCEL", "MODIFY") or not order_id:
        raise RuntimeError("Invalid request")
    price = parse_decimal(sys.argv[4]) if action == "MODIFY" else None
    quantity = parse_decimal(sys.argv[5]) if action == "MODIFY" else None

    with psycopg2.connect(database_url()) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "select breeze_api_key_encrypted,breeze_api_secret_encrypted,breeze_session_token_encrypted "
                "from public.user_credentials where user_id=%s", (user_id,))
            credential = cur.fetchone()
        if not credential or not all(credential):
            raise RuntimeError("Connect Breeze in Settings first")
        key, secret, token = [decrypt_credential(value, env("CREDENTIAL_ENCRYPTION_KEY") or "") for value in credential]
        breeze = BreezeConnect(api_key=key)
        breeze.generate_session(api_secret=secret, session_token=token)

        # The broker only returns orders of the session's own account, so finding it proves ownership.
        try:
            rows = response_rows(breeze.get_order_detail(exchange_code="NSE", order_id=order_id))
        except BrokerError as exc:
            raise RuntimeError(f"Breeze could not find this order: {exc}") from exc
        order = next((row for row in rows if text(row, "order_id") == order_id), None)
        if order is None:
            raise RuntimeError("Breeze could not find this order in your account")
        refused = problems(order, action, price, quantity)
        if refused:
            raise RuntimeError(" ".join(refused))

        requested = None if action == "CANCEL" else {"price": f"{price:.2f}", "quantity": f"{quantity:f}"}
        with conn.cursor() as cur:
            cur.execute(
                """insert into public.breeze_order_actions
                     (user_id,action,order_id,exchange_code,stock_code,order_before,requested,status)
                   values (%s,%s,%s,'NSE',%s,%s,%s,'PENDING') returning id""",
                (user_id, action, order_id, text(order, "stock_code") or None,
                 Json({k: v for k, v in order.items() if k not in PRIVATE_KEYS}),
                 Json(requested) if requested else None),
            )
            audit_id = cur.fetchone()[0]
        conn.commit()

        error = None
        response = None
        try:
            if action == "CANCEL":
                response = breeze.cancel_order(exchange_code="NSE", order_id=order_id)
            else:
                response = breeze.modify_order(
                    order_id=order_id, exchange_code="NSE", order_type="limit", stoploss="",
                    quantity=str(int(quantity)), price=f"{price:.2f}",
                    validity=text(order, "validity").lower() or "day", disclosed_quantity="", validity_date="",
                )
            if not isinstance(response, dict):
                error = "Breeze gave no answer; check the order in ICICI Direct before trying again"
            elif response.get("Error"):
                error = str(response.get("Error"))
        except Exception as exc:  # the request may or may not have reached the exchange
            error = f"{exc}. Check the order in ICICI Direct before trying again"
        status = "DONE" if error is None else "REJECTED" if isinstance(response, dict) else "ERROR"
        with conn.cursor() as cur:
            cur.execute(
                "update public.breeze_order_actions set status=%s,broker_response=%s,error=%s,updated_at=now() where id=%s",
                (status, Json(response) if isinstance(response, dict) else None, error, audit_id),
            )
        conn.commit()
    if error:
        raise RuntimeError(f"Breeze did not accept the request: {error}")
    return {"ok": True, "action": action, "orderId": order_id}


if __name__ == "__main__":
    try:
        print(json.dumps(main()))
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
        sys.exit(1)
