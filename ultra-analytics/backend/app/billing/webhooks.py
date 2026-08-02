"""Stripe webhook → entitlement updates."""

from __future__ import annotations

from typing import Any, Optional

from ..subscription.entitlement import apply_stripe_subscription
from ..util.logging_util import log_event, log_exception
from .config import get_stripe_config, stripe_client
from .stripe_service import find_user_id_by_customer, user_id_from_stripe_object


def construct_event(payload: bytes, sig_header: str) -> Any:
    cfg = get_stripe_config()
    stripe = stripe_client()
    return stripe.Webhook.construct_event(payload, sig_header, cfg.webhook_secret)


def _resolve_user_id(obj: Any, customer_id: Optional[str] = None) -> Optional[str]:
    uid = user_id_from_stripe_object(obj)
    if uid:
        return uid
    if customer_id:
        return find_user_id_by_customer(str(customer_id))
    if isinstance(obj, dict):
        cust = obj.get("customer")
        if isinstance(cust, str):
            return find_user_id_by_customer(cust)
        if isinstance(cust, dict) and cust.get("id"):
            return find_user_id_by_customer(str(cust["id"]))
    return None


def handle_stripe_event(event: Any) -> dict:
    """Process one Stripe event. Idempotent enough for retries."""
    etype = event["type"] if isinstance(event, dict) else event.type
    data = event["data"]["object"] if isinstance(event, dict) else event.data.object
    if not isinstance(data, dict):
        # StripeObject → dict
        try:
            data = dict(data)
        except Exception:  # noqa: BLE001
            data = data.to_dict() if hasattr(data, "to_dict") else {}

    log_event("billing.webhook", type=etype)

    if etype == "checkout.session.completed":
        return _on_checkout_completed(data)
    if etype in (
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
    ):
        return _on_subscription(data, deleted=etype.endswith("deleted"))
    if etype == "invoice.paid":
        return _on_invoice(data, failed=False)
    if etype == "invoice.payment_failed":
        return _on_invoice(data, failed=True)

    return {"ok": True, "ignored": etype}


def _on_checkout_completed(session: dict) -> dict:
    uid = _resolve_user_id(session)
    if not uid:
        log_event("billing.webhook.no_user", type="checkout.session.completed")
        return {"ok": True, "skipped": "no_user"}

    mode = str(session.get("mode") or "")
    meta = session.get("metadata") or {}
    if not isinstance(meta, dict):
        meta = {}
    product = str(meta.get("product") or "")
    session_id = str(session.get("id") or "")

    # One-time Race Pass
    if mode == "payment" or product == "race_pass":
        from ..subscription.race_pass import grant_race_pass_credit, unlock_route_with_pass

        route_id = meta.get("route_id")
        if route_id:
            try:
                unlock_route_with_pass(
                    uid,
                    str(route_id),
                    checkout_session_id=session_id or None,
                    consume_credit=False,
                )
            except Exception:  # noqa: BLE001
                grant_race_pass_credit(uid, checkout_session_id=session_id or None)
        else:
            grant_race_pass_credit(uid, checkout_session_id=session_id or None)
        customer = session.get("customer")
        customer_id = customer if isinstance(customer, str) else None
        if customer_id:
            from ..users import get_user, save_user

            user = get_user(uid)
            if user and not user.get("stripeCustomerId"):
                user["stripeCustomerId"] = customer_id
                save_user(user)
        return {"ok": True, "userId": uid, "product": "race_pass"}

    customer = session.get("customer")
    customer_id = customer if isinstance(customer, str) else (customer or {}).get("id")
    sub = session.get("subscription")
    sub_id = sub if isinstance(sub, str) else (sub or {}).get("id")
    # Subscription checkout — Pro.
    status = "active"
    apply_stripe_subscription(
        uid,
        customer_id=customer_id,
        subscription_id=sub_id,
        status=status,
    )
    return {"ok": True, "userId": uid, "status": status}


def _on_subscription(sub: dict, *, deleted: bool) -> dict:
    uid = _resolve_user_id(sub)
    if not uid:
        cust = sub.get("customer")
        cid = cust if isinstance(cust, str) else None
        uid = find_user_id_by_customer(cid) if cid else None
    if not uid:
        log_event("billing.webhook.no_user", type="subscription")
        return {"ok": True, "skipped": "no_user"}

    customer = sub.get("customer")
    customer_id = customer if isinstance(customer, str) else None
    status = "canceled" if deleted else str(sub.get("status") or "canceled")
    apply_stripe_subscription(
        uid,
        customer_id=customer_id,
        subscription_id=str(sub.get("id") or "") or None,
        status=status,
    )
    return {"ok": True, "userId": uid, "status": status}


def _on_invoice(invoice: dict, *, failed: bool) -> dict:
    cust = invoice.get("customer")
    customer_id = cust if isinstance(cust, str) else None
    uid = _resolve_user_id(invoice, customer_id)
    if not uid:
        return {"ok": True, "skipped": "no_user"}

    sub = invoice.get("subscription")
    sub_id = sub if isinstance(sub, str) else (sub or {}).get("id") if isinstance(sub, dict) else None

    if failed:
        # Soft: mark past_due; entitlement drops Pro unless redeem/apple still grant it.
        apply_stripe_subscription(
            uid,
            customer_id=customer_id,
            subscription_id=sub_id,
            status="past_due",
        )
        return {"ok": True, "userId": uid, "status": "past_due"}

    apply_stripe_subscription(
        uid,
        customer_id=customer_id,
        subscription_id=sub_id,
        status="active",
    )
    return {"ok": True, "userId": uid, "status": "active"}
