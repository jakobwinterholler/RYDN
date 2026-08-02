"""One-route Race Pass — unlocks Pro planning for a single Planned Route."""

from __future__ import annotations

import time
from typing import Optional

from ..users import get_user, save_user
from .service import get_tier
from .tiers import TIER_PRO


def race_pass_credits(user: Optional[dict]) -> int:
    if not user:
        return 0
    try:
        return max(0, int(user.get("racePassCredits") or 0))
    except (TypeError, ValueError):
        return 0


def has_global_pro(user: Optional[dict]) -> bool:
    return get_tier(user) == TIER_PRO


def route_is_unlocked(route: Optional[dict]) -> bool:
    if not route:
        return False
    unlock = route.get("proUnlock")
    return isinstance(unlock, dict) and bool(unlock.get("source"))


def can_access_route_planning(user: Optional[dict], route: Optional[dict]) -> bool:
    if has_global_pro(user):
        return True
    return route_is_unlocked(route)


def can_import_planned_route(user: Optional[dict]) -> bool:
    if has_global_pro(user):
        return True
    return race_pass_credits(user) > 0


def grant_race_pass_credit(
    user_id: str,
    *,
    qty: int = 1,
    checkout_session_id: Optional[str] = None,
) -> dict:
    user = get_user(user_id)
    if not user:
        raise KeyError(f"User not found: {user_id}")
    hist = list(user.get("racePassPurchases") or [])
    # Webhook retries must not stack credits for the same Checkout session.
    if checkout_session_id:
        for row in hist:
            if isinstance(row, dict) and row.get("checkoutSessionId") == checkout_session_id:
                return user
    user["racePassCredits"] = race_pass_credits(user) + max(1, int(qty))
    hist.append(
        {
            "at": time.time(),
            "qty": max(1, int(qty)),
            "checkoutSessionId": checkout_session_id,
        }
    )
    user["racePassPurchases"] = hist[-50:]
    return save_user(user)


def unlock_route_with_pass(
    uid: str,
    route_id: str,
    *,
    checkout_session_id: Optional[str] = None,
    consume_credit: bool = True,
) -> Optional[dict]:
    """Mark a route as Race Pass unlocked. Optionally consume one credit."""
    from .. import routes_store

    route = routes_store.get_route(uid, route_id)
    if not route:
        return None
    if route_is_unlocked(route) or has_global_pro(get_user(uid)):
        return route

    if consume_credit:
        user = get_user(uid)
        if not user or race_pass_credits(user) < 1:
            raise ValueError("No Race Pass credit available.")
        user["racePassCredits"] = race_pass_credits(user) - 1
        save_user(user)

    return routes_store.set_pro_unlock(
        uid,
        route_id,
        {
            "source": "race_pass",
            "at": time.time(),
            "checkoutSessionId": checkout_session_id,
        },
    )


def apply_pass_after_import(uid: str, route_id: str) -> None:
    """After a Free user imports a GPX, spend one Race Pass on that route."""
    if has_global_pro(get_user(uid)):
        return
    unlock_route_with_pass(uid, route_id, consume_credit=True)
