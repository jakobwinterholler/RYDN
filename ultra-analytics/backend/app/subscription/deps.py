"""FastAPI dependencies that enforce Pro / Race Pass gates."""

from __future__ import annotations

from fastapi import Depends, HTTPException

from ..auth import current_user
from .. import routes_store
from .features import can_access
from .race_pass import can_access_route_planning, can_import_planned_route
from .service import get_tier

MSG_PRO_REQUIRED = (
    "This is a Pro feature. Upgrade to Pro, or buy a Race Pass for one route."
)
MSG_RACE_PASS_REQUIRED = (
    "Importing a planned GPX needs Pro or a Race Pass (€4.99 for one route)."
)


def require_feature(feature: str):
    """Dependency factory: authenticated user who can access ``feature`` globally."""

    def _dep(user: dict = Depends(current_user)) -> dict:
        if not can_access(get_tier(user), feature):
            raise HTTPException(status_code=403, detail=MSG_PRO_REQUIRED)
        return user

    return _dep


def require_can_import_route(user: dict = Depends(current_user)) -> dict:
    """Pro subscription OR an unused Race Pass credit."""
    if not can_import_planned_route(user):
        raise HTTPException(status_code=403, detail=MSG_RACE_PASS_REQUIRED)
    return user


def require_route_planning_access(route_id: str, user: dict = Depends(current_user)) -> dict:
    """Pro subscription OR this specific route was unlocked with a Race Pass."""
    route = routes_store.get_route(user["id"], route_id)
    if not route:
        raise HTTPException(status_code=404, detail="Route not found.")
    if not can_access_route_planning(user, route):
        raise HTTPException(status_code=403, detail=MSG_PRO_REQUIRED)
    return user
