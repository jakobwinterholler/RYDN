"""Create Checkout / Portal sessions and sync Stripe customers."""

from __future__ import annotations

from typing import Any, Optional

from ..config import get_config
from ..users import get_user, save_user
from .config import get_stripe_config, stripe_client


def _ensure_customer(user: dict) -> str:
    """Return Stripe customer id, creating one if needed."""
    existing = user.get("stripeCustomerId")
    if isinstance(existing, str) and existing.startswith("cus_"):
        return existing

    stripe = stripe_client()
    customer = stripe.Customer.create(
        email=user.get("email") or None,
        name=user.get("name") or None,
        metadata={"rydn_user_id": user["id"]},
    )
    cid = str(customer["id"])
    user["stripeCustomerId"] = cid
    save_user(user)
    return cid


def create_checkout_session(user_id: str, *, interval: str = "month") -> dict[str, str]:
    """Hosted Checkout for RYDN Pro. Returns ``{ url }``."""
    cfg = get_stripe_config()
    app_cfg = get_config()
    user = get_user(user_id)
    if not user:
        raise KeyError(f"User not found: {user_id}")

    interval_norm = "year" if str(interval).lower() in ("year", "yearly", "annual") else "month"
    price_id = cfg.price_for(interval_norm)  # type: ignore[arg-type]
    if not price_id:
        raise RuntimeError("No Stripe price configured for that plan.")

    stripe = stripe_client()
    customer_id = _ensure_customer(user)
    success = f"{app_cfg.app_url}/?space=you&billing=success"
    cancel = f"{app_cfg.app_url}/?space=you&billing=cancel"

    # Ensure product has a tax_code (Stripe Managed Payments requires it).
    try:
        from .bootstrap import _ensure_product_tax_code, _g

        price = stripe.Price.retrieve(price_id)
        product_id = _g(price, "product")
        if isinstance(product_id, dict):
            product_id = product_id.get("id")
        if product_id:
            _ensure_product_tax_code(stripe, str(product_id))
    except Exception:  # noqa: BLE001
        pass

    session = stripe.checkout.Session.create(
        mode="subscription",
        customer=customer_id,
        client_reference_id=user_id,
        line_items=[{"price": price_id, "quantity": 1}],
        success_url=success,
        cancel_url=cancel,
        allow_promotion_codes=True,
        # Prices are tax_behavior=inclusive — customer pays the sticker amount.
        automatic_tax={"enabled": True},
        metadata={"rydn_user_id": user_id, "interval": interval_norm},
        subscription_data={"metadata": {"rydn_user_id": user_id, "interval": interval_norm}},
    )
    url = session["url"] if "url" in session else getattr(session, "url", None)
    if not url:
        raise RuntimeError("Stripe did not return a checkout URL.")
    return {"url": str(url)}


def create_race_pass_checkout(user_id: str, *, route_id: Optional[str] = None) -> dict[str, str]:
    """One-time Race Pass Checkout (€4.99 inclusive). Returns ``{ url }``."""
    cfg = get_stripe_config()
    if not cfg.race_pass_configured:
        raise RuntimeError("Race Pass is not configured yet.")
    app_cfg = get_config()
    user = get_user(user_id)
    if not user:
        raise KeyError(f"User not found: {user_id}")

    stripe = stripe_client()
    customer_id = _ensure_customer(user)
    success = f"{app_cfg.app_url}/?space=library&billing=race_pass_success"
    cancel = f"{app_cfg.app_url}/?space=library&billing=cancel"
    meta = {"rydn_user_id": user_id, "product": "race_pass"}
    if route_id:
        meta["route_id"] = str(route_id)

    session = stripe.checkout.Session.create(
        mode="payment",
        customer=customer_id,
        client_reference_id=user_id,
        line_items=[{"price": cfg.price_race_pass, "quantity": 1}],
        success_url=success,
        cancel_url=cancel,
        automatic_tax={"enabled": True},
        metadata=meta,
    )
    url = session["url"] if "url" in session else getattr(session, "url", None)
    if not url:
        raise RuntimeError("Stripe did not return a checkout URL.")
    return {"url": str(url)}


def create_portal_session(user_id: str) -> dict[str, str]:
    """Customer Portal for cancel / update card. Returns ``{ url }``."""
    app_cfg = get_config()
    user = get_user(user_id)
    if not user:
        raise KeyError(f"User not found: {user_id}")
    customer_id = user.get("stripeCustomerId")
    if not isinstance(customer_id, str) or not customer_id.startswith("cus_"):
        raise ValueError("No Stripe billing account yet. Upgrade to Pro first.")

    stripe = stripe_client()
    session = stripe.billing_portal.Session.create(
        customer=customer_id,
        return_url=f"{app_cfg.app_url}/?space=you",
    )
    url = session.get("url")
    if not url:
        raise RuntimeError("Stripe did not return a portal URL.")
    return {"url": str(url)}


def user_id_from_stripe_object(obj: Any) -> Optional[str]:
    """Best-effort extract RYDN user id from Stripe objects / metadata."""
    if not obj:
        return None
    if isinstance(obj, dict):
        meta = obj.get("metadata") or {}
        if isinstance(meta, dict):
            uid = meta.get("rydn_user_id") or meta.get("user_id")
            if uid:
                return str(uid)
        ref = obj.get("client_reference_id")
        if ref:
            return str(ref)
        # Nested subscription on checkout session
        sub = obj.get("subscription")
        if isinstance(sub, dict):
            return user_id_from_stripe_object(sub)
    return None


def find_user_id_by_customer(customer_id: str) -> Optional[str]:
    from ..users import find_user_id_by_stripe_customer

    return find_user_id_by_stripe_customer(customer_id)
