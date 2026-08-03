"""Central feature → tier map. Keep in sync with frontend ``subscription/features.ts``."""

from __future__ import annotations

from .tiers import TIER_PRO, normalize_tier

# Stable feature ids used by gates (API deps + UI).
FEATURE_PLANNING = "planning"
FEATURE_VERIFY = "verify"
FEATURE_RIDE_MODE = "rideMode"
FEATURE_GPX_EXPORT = "gpxExport"

# Free-tier product areas (documented; no gate — auth alone is enough):
# library, analytics, certificates, ultras, rideHistory

PRO_FEATURES = frozenset(
    {
        FEATURE_PLANNING,
        FEATURE_VERIFY,
        FEATURE_RIDE_MODE,
        FEATURE_GPX_EXPORT,
    }
)

FEATURES = frozenset(PRO_FEATURES)


def can_access(tier: object, feature: str) -> bool:
    """Return True when ``tier`` may use ``feature``.

    Guest (or missing) never passes Pro features. Free never passes Pro.
    Unknown features default to False (fail closed).
    """
    t = normalize_tier(tier, default="guest")
    if feature not in FEATURES:
        return False
    if feature in PRO_FEATURES:
        return t == TIER_PRO
    return t in ("free", "pro")
