"""Recompute Pro from all billing sources (Stripe, redeem, later Apple).

Feature gates only read ``subscriptionTier``. This module is the single place
that decides the tier from source-specific fields.
"""

from __future__ import annotations

import time
from typing import Any, Optional

from ..users import get_user, save_user
from .tiers import TIER_FREE, TIER_PRO, normalize_persisted_tier

_STRIPE_ACTIVE = frozenset({"active", "trialing"})


def _truthy(v: Any) -> bool:
    return bool(v) is True or v == 1 or str(v).lower() in ("1", "true", "yes")


def stripe_grants_pro(user: dict) -> bool:
    return str(user.get("stripeStatus") or "").lower() in _STRIPE_ACTIVE


def apple_grants_pro(user: dict) -> bool:
    """Placeholder for StoreKit / RevenueCat — unused until Phase 2."""
    return _truthy(user.get("appleActive"))


def redeem_grants_pro(user: dict) -> bool:
    return _truthy(user.get("redeemPro"))


def recompute_entitlement(user_id: str) -> dict:
    """Set ``subscriptionTier`` from Stripe / Apple / redeem flags. Returns user."""
    user = get_user(user_id)
    if not user:
        raise KeyError(f"User not found: {user_id}")

    if stripe_grants_pro(user):
        tier = TIER_PRO
        source = "stripe"
    elif apple_grants_pro(user):
        tier = TIER_PRO
        source = "apple"
    elif redeem_grants_pro(user):
        tier = TIER_PRO
        source = "redeem"
    else:
        tier = TIER_FREE
        source = "none"

    user["subscriptionTier"] = normalize_persisted_tier(tier)
    user["subscriptionSource"] = source
    user["subscriptionUpdatedAt"] = time.time()
    return save_user(user)


def apply_stripe_subscription(
    user_id: str,
    *,
    customer_id: Optional[str],
    subscription_id: Optional[str],
    status: str,
) -> dict:
    """Persist Stripe IDs/status and recompute entitlement."""
    user = get_user(user_id)
    if not user:
        raise KeyError(f"User not found: {user_id}")

    if customer_id:
        user["stripeCustomerId"] = str(customer_id)
    if subscription_id:
        user["stripeSubscriptionId"] = str(subscription_id)
    user["stripeStatus"] = str(status or "").lower() or None
    save_user(user)
    return recompute_entitlement(user_id)


def grant_redeem_pro(user_id: str) -> dict:
    """Mark redeem unlock and recompute (keeps Pro even if Stripe later cancels)."""
    user = get_user(user_id)
    if not user:
        raise KeyError(f"User not found: {user_id}")
    user["redeemPro"] = True
    save_user(user)
    return recompute_entitlement(user_id)


def revoke_to_free(user_id: str, *, clear_stripe: bool = True) -> dict:
    """Force Free for testing — clears redeem/Apple (and local Stripe status by default).

    Does not cancel a Stripe subscription in Stripe; only clears app entitlement flags.
    """
    user = get_user(user_id)
    if not user:
        raise KeyError(f"User not found: {user_id}")
    user["redeemPro"] = False
    user["appleActive"] = False
    if clear_stripe:
        user["stripeStatus"] = None
    save_user(user)
    return recompute_entitlement(user_id)
