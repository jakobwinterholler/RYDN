"""Subscription mutations — the Stripe/redeem hook point."""

from __future__ import annotations

import time
from typing import Optional

from ..users import get_user, save_user
from .tiers import PERSISTED_TIERS, TIER_FREE, normalize_persisted_tier


def get_tier(user: Optional[dict]) -> str:
    """Tier for a user dict, or free if absent/malformed. Guest is not a user."""
    if not user:
        return TIER_FREE
    return normalize_persisted_tier(user.get("subscriptionTier"))


def set_subscription_tier(
    user_id: str,
    tier: str,
    *,
    source: str = "admin",
) -> dict:
    """Set ``subscriptionTier`` on the user record.

    ``source`` is for audit / future billing (``redeem`` | ``stripe`` | ``admin`` | …).
    Gating code must only read the tier — never the source.
    """
    normalized = normalize_persisted_tier(tier)
    if normalized not in PERSISTED_TIERS:
        raise ValueError(f"Invalid subscription tier: {tier!r}")

    user = get_user(user_id)
    if not user:
        raise KeyError(f"User not found: {user_id}")

    user["subscriptionTier"] = normalized
    user["subscriptionSource"] = str(source or "admin")
    user["subscriptionUpdatedAt"] = time.time()
    return save_user(user)
