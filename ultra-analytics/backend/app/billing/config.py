"""Stripe config — prefer env overrides; fill gaps from auto-bootstrap store.

Minimum to go live: ``STRIPE_SECRET_KEY`` only. Bootstrap creates prices + webhook.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Literal

from .store import get_stored, load_billing_store

BillingInterval = Literal["month", "year"]


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


@dataclass(frozen=True)
class StripeConfig:
    secret_key: str
    webhook_secret: str
    price_pro: str
    price_pro_monthly: str
    price_pro_yearly: str
    price_race_pass: str
    publishable_key: str

    @property
    def configured(self) -> bool:
        return bool(self.secret_key and self.webhook_secret and self.price_pro)

    @property
    def race_pass_configured(self) -> bool:
        return bool(self.secret_key and self.webhook_secret and self.price_race_pass)

    @property
    def can_bootstrap(self) -> bool:
        return bool(self.secret_key)

    def price_for(self, interval: BillingInterval = "month") -> str:
        if interval == "year" and self.price_pro_yearly:
            return self.price_pro_yearly
        return self.price_pro_monthly or self.price_pro


def get_stripe_config() -> StripeConfig:
    secret = _env("STRIPE_SECRET_KEY")
    webhook = _env("STRIPE_WEBHOOK_SECRET") or (get_stored("webhookSecret") or "")
    monthly = (
        _env("STRIPE_PRICE_PRO")
        or _env("STRIPE_PRICE_PRO_MONTHLY")
        or (get_stored("priceProMonthly") or "")
        or (get_stored("pricePro") or "")
    )
    yearly = _env("STRIPE_PRICE_PRO_YEARLY") or (get_stored("priceProYearly") or "")
    race = _env("STRIPE_PRICE_RACE_PASS") or (get_stored("priceRacePass") or "")
    return StripeConfig(
        secret_key=secret,
        webhook_secret=webhook,
        price_pro=monthly,
        price_pro_monthly=monthly,
        price_pro_yearly=yearly,
        price_race_pass=race,
        publishable_key=_env("STRIPE_PUBLISHABLE_KEY"),
    )


def billing_configured() -> bool:
    return get_stripe_config().configured


def pricing_public() -> dict:
    store = load_billing_store()
    currency = (store.get("currency") or _env("STRIPE_PRO_CURRENCY", "eur") or "eur").upper()
    monthly = int(store.get("amountMonthlyCents") or _env("STRIPE_PRO_AMOUNT_CENTS", "899") or 899)
    yearly = int(store.get("amountYearlyCents") or _env("STRIPE_PRO_YEARLY_AMOUNT_CENTS", "5999") or 5999)
    race = int(store.get("amountRacePassCents") or _env("STRIPE_RACE_PASS_AMOUNT_CENTS", "499") or 499)
    return {
        "currency": currency,
        "monthlyCents": monthly,
        "yearlyCents": yearly,
        "racePassCents": race,
        "monthlyLabel": f"{monthly / 100:.2f}".replace(".", ",") + " €",
        "yearlyLabel": f"{yearly / 100:.2f}".replace(".", ",") + " €",
        "racePassLabel": f"{race / 100:.2f}".replace(".", ",") + " €",
    }


def stripe_client():
    """Lazy Stripe SDK client. Needs secret key; full checkout needs configured()."""
    cfg = get_stripe_config()
    if not cfg.secret_key:
        raise RuntimeError("Stripe billing is not configured.")
    if not cfg.configured:
        raise RuntimeError(
            "Stripe is almost ready — restart the app once so billing can finish auto-setup."
        )
    try:
        import stripe
    except ImportError as e:  # noqa: BLE001
        raise RuntimeError("Install the stripe package (pip install stripe).") from e
    stripe.api_key = cfg.secret_key
    return stripe
