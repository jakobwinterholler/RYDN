"""Stripe Billing — Checkout, Customer Portal, webhooks.

Feature access stays in ``app.subscription``. This package only talks to Stripe
and calls entitlement helpers.
"""

from .config import billing_configured

__all__ = ["billing_configured"]
