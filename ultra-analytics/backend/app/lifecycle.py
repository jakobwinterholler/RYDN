"""Ride lifecycle — the spine of Plan → Ride → Review.

Every ride in Ultra moves through these states:

    Draft → Planning → Ready → In Progress → Completed → Reviewed

Planning-side rides (upcoming routes, drafts, checklists) live in the early
states. Completed rides (Strava imports, uploads, finished events) live in the
later ones. The Home UI is organized around that split even when not every
state has a dedicated screen yet.

Keep this module as the single source of truth for status values and for
deriving which product area a ride belongs to.
"""

from __future__ import annotations

from typing import Optional

# Ordered lifecycle. Do not rename without a migration plan.
STATUSES = (
    "draft",
    "planning",
    "ready",
    "in_progress",
    "completed",
    "reviewed",
)

# Product areas on Home / nav.
AREA_PLANNING = "planning"
AREA_COMPLETED = "completed"

_PLANNING_STATUSES = frozenset({"draft", "planning", "ready", "in_progress"})


def normalize_status(raw: Optional[str], *, analyzed: bool = False) -> str:
    """Map any stored / inferred value onto a canonical lifecycle status."""
    if raw and raw in STATUSES:
        return raw
    # Imported / finished activities default into the completed half of the funnel.
    return "reviewed" if analyzed else "completed"


def area_for_status(status: str) -> str:
    if status in _PLANNING_STATUSES:
        return AREA_PLANNING
    return AREA_COMPLETED


def enrich_summary(summary: dict) -> dict:
    """Attach lifecycle fields to a ride summary dict (mutates a shallow copy)."""
    out = dict(summary)
    analyzed = bool(out.get("analyzed"))
    status = normalize_status(out.get("status"), analyzed=analyzed)
    out["status"] = status
    out["area"] = area_for_status(status)
    return out
