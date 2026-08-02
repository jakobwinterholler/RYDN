"""Account subscription tiers — single vocabulary for backend + API."""

from __future__ import annotations

# guest = unauthenticated (no user record). free/pro = logged-in accounts.
TIER_GUEST = "guest"
TIER_FREE = "free"
TIER_PRO = "pro"

TIERS = frozenset({TIER_GUEST, TIER_FREE, TIER_PRO})
# Persisted on user records; guest is never stored.
PERSISTED_TIERS = frozenset({TIER_FREE, TIER_PRO})


def normalize_tier(raw: object, *, default: str = TIER_FREE) -> str:
    """Coerce stored/API values to a known tier. Unknown → default (free)."""
    if raw is None:
        return default
    value = str(raw).strip().lower()
    if value in TIERS:
        return value
    return default


def normalize_persisted_tier(raw: object) -> str:
    """Tier for a logged-in user record — never guest."""
    tier = normalize_tier(raw, default=TIER_FREE)
    if tier == TIER_GUEST:
        return TIER_FREE
    return tier
