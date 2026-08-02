"""Auto-provision Stripe Product, Price, Webhook, Portal, Apple/Google domains.

Operator flow: create a Stripe account → paste ``STRIPE_SECRET_KEY`` → redeploy.
Everything else is created via the API and stored under ``data/stripe_billing.json``.
"""

from __future__ import annotations

import os
from typing import Any, Optional
from urllib.parse import urlparse

from ..config import get_config
from ..util.logging_util import log_event, log_exception
from .store import load_billing_store, save_billing_store

_PRODUCT_META = {"rydn": "pro", "rydn_bootstrap": "1"}
# SaaS personal use — required when Stripe Managed Payments is on.
_PRODUCT_TAX_CODE = "txcd_10103000"
_WEBHOOK_EVENTS = [
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.paid",
    "invoice.payment_failed",
]


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def _secret_key() -> str:
    return _env("STRIPE_SECRET_KEY")


def _amount_cents(interval: str = "month") -> int:
    if interval == "year":
        raw = _env("STRIPE_PRO_YEARLY_AMOUNT_CENTS", "5999")  # €59.99 / year
        default = 5999
    else:
        raw = _env("STRIPE_PRO_AMOUNT_CENTS", "899")  # €8.99 / month
        default = 899
    try:
        n = int(raw)
    except ValueError:
        n = default
    return max(100, n)


def _race_pass_amount_cents() -> int:
    raw = _env("STRIPE_RACE_PASS_AMOUNT_CENTS", "499")  # €4.99 one route
    try:
        n = int(raw)
    except ValueError:
        n = 499
    return max(100, n)


def _currency() -> str:
    return (_env("STRIPE_PRO_CURRENCY", "eur") or "eur").lower()


def _webhook_url() -> str:
    cfg = get_config()
    base = (cfg.api_url or cfg.public_url or "").rstrip("/")
    return f"{base}/api/billing/webhook"


def _domains() -> list[str]:
    cfg = get_config()
    hosts: list[str] = []
    for url in (cfg.app_url, cfg.public_url, cfg.api_url, "https://rydn.bike", "https://www.rydn.bike"):
        if not url:
            continue
        host = urlparse(url).hostname
        if host and host not in hosts and host not in ("localhost", "127.0.0.1"):
            hosts.append(host)
    return hosts


def _stripe_sdk(secret: str):
    import stripe

    stripe.api_key = secret
    return stripe


def _g(obj: Any, key: str, default: Any = None) -> Any:
    """Read a field from a StripeObject or dict (SDK v15+ often has no .get)."""
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(key, default)
    try:
        return obj[key]
    except Exception:  # noqa: BLE001
        pass
    return getattr(obj, key, default)


def _list_data(obj: Any) -> list[Any]:
    data = _g(obj, "data", None)
    if data is None:
        return []
    return list(data)


def bootstrap_stripe(*, force: bool = False) -> dict[str, Any]:
    """Idempotent setup. Returns status dict for logs / health."""
    secret = _secret_key()
    if not secret:
        return {"ok": False, "reason": "no_secret_key"}

    try:
        stripe = _stripe_sdk(secret)
        store = load_billing_store()
        # Manual Pro price overrides — still create Race Pass + webhook.
        env_complete = bool(
            _env("STRIPE_WEBHOOK_SECRET")
            and (_env("STRIPE_PRICE_PRO") or _env("STRIPE_PRICE_PRO_MONTHLY"))
        )
        if env_complete and not force:
            price_monthly = _env("STRIPE_PRICE_PRO") or _env("STRIPE_PRICE_PRO_MONTHLY")
            price_yearly = _env("STRIPE_PRICE_PRO_YEARLY") or store.get("priceProYearly") or ""
            product_id = store.get("productId") or ""
        else:
            product_id = _ensure_product(stripe, store)
            price_monthly = _ensure_price(
                stripe, store, product_id, interval="month", store_key="priceProMonthly"
            )
            price_yearly = _ensure_price(
                stripe, store, product_id, interval="year", store_key="priceProYearly"
            )
        price_id = price_monthly
        race_product_id, race_price_id = _ensure_race_pass(stripe, store)
        webhook_secret = _ensure_webhook(stripe, store)
        _ensure_portal(stripe)
        domains = _ensure_payment_method_domains(stripe)
        store["productId"] = product_id or store.get("productId")
        store["pricePro"] = price_id
        store["priceProMonthly"] = price_monthly
        store["priceProYearly"] = price_yearly
        store["racePassProductId"] = race_product_id
        store["priceRacePass"] = race_price_id
        store["amountMonthlyCents"] = _amount_cents("month")
        store["amountYearlyCents"] = _amount_cents("year")
        store["amountRacePassCents"] = _race_pass_amount_cents()
        store["currency"] = _currency()
        if webhook_secret:
            store["webhookSecret"] = webhook_secret
        store["webhookUrl"] = _webhook_url()
        store["domains"] = domains
        store["mode"] = "live" if secret.startswith("sk_live") else "test"
        save_billing_store(store)
        log_event(
            "billing.bootstrap.ok",
            price=price_id,
            priceYearly=price_yearly,
            priceRacePass=race_price_id,
            product=product_id,
            webhook=bool(store.get("webhookSecret")),
            domains=domains,
        )
        return {
            "ok": True,
            "pricePro": price_id,
            "priceProMonthly": price_monthly,
            "priceProYearly": price_yearly,
            "priceRacePass": race_price_id,
            "productId": product_id,
            "webhookConfigured": bool(store.get("webhookSecret")),
            "domains": domains,
            "source": "auto",
        }
    except Exception as e:  # noqa: BLE001
        log_exception("billing.bootstrap.failed", e)
        return {"ok": False, "reason": str(e)}


def _ensure_product_tax_code(stripe: Any, product_id: str) -> None:
    """Managed Payments rejects Checkout without an eligible product tax_code."""
    try:
        p = stripe.Product.retrieve(product_id)
        code = _g(p, "tax_code")
        if isinstance(code, dict):
            code = code.get("id")
        code = str(code or "")
        if code.startswith("txcd_"):
            return
        stripe.Product.modify(product_id, tax_code=_PRODUCT_TAX_CODE)
    except Exception as e:  # noqa: BLE001
        log_event("billing.bootstrap.tax_code_skip", product=product_id, error=str(e)[:200])


def _ensure_product(stripe: Any, store: dict) -> str:
    existing = store.get("productId") or _env("STRIPE_PRODUCT_PRO")
    if existing:
        try:
            p = stripe.Product.retrieve(str(existing))
            if p and not _g(p, "deleted", False):
                pid = str(_g(p, "id"))
                _ensure_product_tax_code(stripe, pid)
                return pid
        except Exception:  # noqa: BLE001
            pass

    try:
        found = stripe.Product.search(query="metadata['rydn']:'pro'", limit=1)
        data = _list_data(found)
        if data:
            pid = str(_g(data[0], "id"))
            _ensure_product_tax_code(stripe, pid)
            return pid
    except Exception:  # noqa: BLE001
        pass

    try:
        prods = stripe.Product.list(active=True, limit=100)
        for p in _list_data(prods):
            meta = _g(p, "metadata") or {}
            if _g(meta, "rydn") == "pro" or (isinstance(meta, dict) and meta.get("rydn") == "pro"):
                pid = str(_g(p, "id"))
                _ensure_product_tax_code(stripe, pid)
                return pid
    except Exception:  # noqa: BLE001
        pass

    created = stripe.Product.create(
        name="RYDN Pro",
        description="Planning, Verify, Ride mode, and GPX export.",
        metadata=_PRODUCT_META,
        tax_code=_PRODUCT_TAX_CODE,
    )
    return str(_g(created, "id"))


def _ensure_price(
    stripe: Any,
    store: dict,
    product_id: str,
    *,
    interval: str,
    store_key: str,
) -> str:
    if interval == "year":
        env_price = _env("STRIPE_PRICE_PRO_YEARLY")
    else:
        env_price = _env("STRIPE_PRICE_PRO") or _env("STRIPE_PRICE_PRO_MONTHLY")
    if env_price:
        return env_price

    existing = store.get(store_key) or (store.get("pricePro") if interval == "month" else None)
    amount = _amount_cents(interval)
    currency = _currency()

    def _price_matches(pr: Any) -> bool:
        rec = _g(pr, "recurring") or {}
        rec_interval = _g(rec, "interval") if not isinstance(rec, dict) else rec.get("interval")
        # Inclusive so Checkout total equals the sticker price (VAT inside 8,99 / 59,99).
        behavior = str(_g(pr, "tax_behavior") or "")
        return bool(
            pr
            and _g(pr, "active")
            and int(_g(pr, "unit_amount") or 0) == amount
            and str(_g(pr, "currency") or "") == currency
            and str(rec_interval or "") == interval
            and behavior == "inclusive"
        )

    if existing:
        try:
            pr = stripe.Price.retrieve(str(existing))
            if _price_matches(pr):
                return str(_g(pr, "id"))
        except Exception:  # noqa: BLE001
            pass

    prices = stripe.Price.list(product=product_id, active=True, limit=40)
    for pr in _list_data(prices):
        if _price_matches(pr):
            return str(_g(pr, "id"))

    created = stripe.Price.create(
        product=product_id,
        unit_amount=amount,
        currency=currency,
        recurring={"interval": interval},
        tax_behavior="inclusive",
        metadata={**_PRODUCT_META, "interval": interval, "tax": "inclusive"},
    )
    return str(_g(created, "id"))


def _ensure_race_pass(stripe: Any, store: dict) -> tuple[str, str]:
    """One-time Race Pass product + inclusive €4.99 price."""
    env_price = _env("STRIPE_PRICE_RACE_PASS")
    amount = _race_pass_amount_cents()
    currency = _currency()
    meta = {"rydn": "race_pass", "rydn_bootstrap": "1"}

    product_id = store.get("racePassProductId") or _env("STRIPE_PRODUCT_RACE_PASS")
    if product_id:
        try:
            p = stripe.Product.retrieve(str(product_id))
            if p and not _g(p, "deleted", False):
                product_id = str(_g(p, "id"))
            else:
                product_id = None
        except Exception:  # noqa: BLE001
            product_id = None
    if not product_id:
        try:
            found = stripe.Product.search(query="metadata['rydn']:'race_pass'", limit=1)
            data = _list_data(found)
            if data:
                product_id = str(_g(data[0], "id"))
        except Exception:  # noqa: BLE001
            pass
    if not product_id:
        created = stripe.Product.create(
            name="RYDN Race Pass",
            description="Unlock Planning, Verify, Ride mode, and GPX for one planned route.",
            metadata=meta,
            tax_code=_PRODUCT_TAX_CODE,
        )
        product_id = str(_g(created, "id"))
    _ensure_product_tax_code(stripe, product_id)

    if env_price:
        return product_id, env_price

    existing = store.get("priceRacePass")
    if existing:
        try:
            pr = stripe.Price.retrieve(str(existing))
            if (
                pr
                and _g(pr, "active")
                and int(_g(pr, "unit_amount") or 0) == amount
                and str(_g(pr, "currency") or "") == currency
                and str(_g(pr, "tax_behavior") or "") == "inclusive"
                and not _g(pr, "recurring")
            ):
                return product_id, str(_g(pr, "id"))
        except Exception:  # noqa: BLE001
            pass

    for pr in _list_data(stripe.Price.list(product=product_id, active=True, limit=40)):
        if (
            int(_g(pr, "unit_amount") or 0) == amount
            and str(_g(pr, "currency") or "") == currency
            and str(_g(pr, "tax_behavior") or "") == "inclusive"
            and not _g(pr, "recurring")
        ):
            return product_id, str(_g(pr, "id"))

    created_price = stripe.Price.create(
        product=product_id,
        unit_amount=amount,
        currency=currency,
        tax_behavior="inclusive",
        metadata=meta,
    )
    return product_id, str(_g(created_price, "id"))


def _ensure_webhook(stripe: Any, store: dict) -> Optional[str]:
    env_secret = _env("STRIPE_WEBHOOK_SECRET")
    if env_secret:
        return env_secret

    url = _webhook_url()
    stored = store.get("webhookSecret")
    stored_id = store.get("webhookEndpointId")

    if stored and stored_id:
        try:
            ep = stripe.WebhookEndpoint.retrieve(str(stored_id))
            if ep and str(_g(ep, "url") or "") == url and _g(ep, "status") != "disabled":
                return str(stored)
        except Exception:  # noqa: BLE001
            pass

    try:
        for ep in _list_data(stripe.WebhookEndpoint.list(limit=100)):
            if str(_g(ep, "url") or "") != url:
                continue
            existing_id = str(_g(ep, "id"))
            meta = _g(ep, "metadata") or {}
            meta_flag = _g(meta, "rydn_bootstrap") if not isinstance(meta, dict) else meta.get("rydn_bootstrap")
            if stored and meta_flag == "1":
                store["webhookEndpointId"] = existing_id
                return str(stored)
            if meta_flag == "1":
                try:
                    stripe.WebhookEndpoint.delete(existing_id)
                except Exception:  # noqa: BLE001
                    pass
            break
    except Exception:  # noqa: BLE001
        pass

    created = stripe.WebhookEndpoint.create(
        url=url,
        enabled_events=_WEBHOOK_EVENTS,
        description="RYDN Pro billing (auto)",
        metadata={"rydn_bootstrap": "1"},
    )
    secret = _g(created, "secret")
    store["webhookEndpointId"] = str(_g(created, "id"))
    if secret:
        return str(secret)
    return str(stored) if stored else None


def _ensure_portal(stripe: Any) -> None:
    """Best-effort Customer Portal config (cancel + payment method update)."""
    try:
        configs = stripe.billing_portal.Configuration.list(limit=5)
        if _list_data(configs):
            return
        stripe.billing_portal.Configuration.create(
            business_profile={"headline": "RYDN Pro"},
            features={
                "customer_update": {"enabled": True, "allowed_updates": ["email"]},
                "invoice_history": {"enabled": True},
                "payment_method_update": {"enabled": True},
                "subscription_cancel": {"enabled": True, "mode": "at_period_end"},
            },
        )
    except Exception as e:  # noqa: BLE001
        log_event("billing.bootstrap.portal_skip", error=str(e)[:200])


def _ensure_payment_method_domains(stripe: Any) -> list[str]:
    """Register domains for Apple Pay / Google Pay (Payment Method Domains API)."""
    done: list[str] = []
    for host in _domains():
        try:
            listed = stripe.PaymentMethodDomain.list(domain_name=host, limit=5)
            rows = _list_data(listed)
            if rows:
                done.append(host)
                for row in rows:
                    if not _g(row, "enabled"):
                        try:
                            stripe.PaymentMethodDomain.update(_g(row, "id"), enabled=True)
                        except Exception:  # noqa: BLE001
                            pass
                continue
            created = stripe.PaymentMethodDomain.create(domain_name=host, enabled=True)
            if created:
                done.append(host)
        except Exception as e:  # noqa: BLE001
            log_event("billing.bootstrap.domain_skip", domain=host, error=str(e)[:200])
    return done
