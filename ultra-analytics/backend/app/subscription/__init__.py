"""Subscription tiers, feature gates, and redeem codes.

Tier lives on the user record (``subscriptionTier``). Feature access always
goes through ``can_access`` / ``require_feature``. Stripe Billing lives in
``app.billing`` and updates entitlement via ``recompute_entitlement``.
"""

from .features import FEATURES, PRO_FEATURES, can_access
from .service import get_tier, set_subscription_tier
from .tiers import TIERS, TIER_FREE, TIER_GUEST, TIER_PRO, normalize_tier

__all__ = [
    "FEATURES",
    "PRO_FEATURES",
    "TIERS",
    "TIER_FREE",
    "TIER_GUEST",
    "TIER_PRO",
    "can_access",
    "get_tier",
    "normalize_tier",
    "set_subscription_tier",
]
