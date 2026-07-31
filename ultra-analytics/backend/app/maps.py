"""Google Maps Platform proxies — API key stays server-side.

Browsers cannot call Street View Metadata (CORS). Clients hit these endpoints;
the backend attaches ``GOOGLE_MAPS_API_KEY`` when calling Google.

``GET /api/maps/js-config`` returns the key only to signed-in users so the Maps
JavaScript API is not baked into the Vite bundle. Restrict the key by HTTP
referrer in Google Cloud Console (rydn.bike). Enable Maps JavaScript API and
Street View (Metadata / Static as needed).
"""

from __future__ import annotations

from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, Query

from .auth import current_user
from .config import get_config
from .util.logging_util import log_event

router = APIRouter(prefix="/api/maps", tags=["maps"])

_STREET_VIEW_META = "https://maps.googleapis.com/maps/api/streetview/metadata"
_DEFAULT_RADIUS_M = 100


def _unknown_payload() -> dict[str, Any]:
    return {
        "status": "UNKNOWN",
        "available": True,
        "location": None,
        "pano_id": None,
    }


async def fetch_street_view_metadata(
    lat: float,
    lon: float,
    *,
    radius: int = _DEFAULT_RADIUS_M,
    source: Optional[str] = None,
) -> dict[str, Any]:
    """Call Google Street View Metadata. Never returns the API key."""
    cfg = get_config()
    key = cfg.google_maps_api_key
    if not key:
        return _unknown_payload()

    params: dict[str, str] = {
        "location": f"{lat},{lon}",
        "radius": str(max(1, min(radius, 500))),
        "key": key,
    }
    if source in ("outdoor", "default"):
        # Google only documents ``outdoor``; ``default`` means omit source.
        if source == "outdoor":
            params["source"] = "outdoor"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(_STREET_VIEW_META, params=params)
    except httpx.HTTPError as exc:
        log_event("maps.streetview_metadata_error", error=type(exc).__name__)
        return _unknown_payload()

    if not resp.is_success:
        log_event("maps.streetview_metadata_http", status=resp.status_code)
        return _unknown_payload()

    try:
        data = resp.json()
    except ValueError:
        return _unknown_payload()

    status = str(data.get("status") or "UNKNOWN")
    if status == "OK":
        loc = data.get("location") or {}
        lat_v = loc.get("lat")
        lng_v = loc.get("lng")
        pano = data.get("pano_id")
        return {
            "status": "OK",
            "available": True,
            "location": (
                {"lat": float(lat_v), "lng": float(lng_v)}
                if lat_v is not None and lng_v is not None
                else None
            ),
            "pano_id": str(pano).strip() if isinstance(pano, str) and pano.strip() else None,
        }
    if status == "ZERO_RESULTS":
        return {
            "status": "ZERO_RESULTS",
            "available": False,
            "location": None,
            "pano_id": None,
        }
    # REQUEST_DENIED / OVER_QUERY_LIMIT / etc. — degrade gracefully
    log_event("maps.streetview_metadata_status", status=status)
    return _unknown_payload()


@router.get("/streetview/metadata")
async def streetview_metadata(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    radius: int = Query(_DEFAULT_RADIUS_M, ge=1, le=500),
    source: Optional[str] = Query(None, pattern="^(outdoor|default)$"),
) -> dict[str, Any]:
    """Proxy Street View Metadata so the browser never sees the API key."""
    return await fetch_street_view_metadata(lat, lon, radius=radius, source=source)


@router.get("/js-config")
def maps_js_config(user: dict = Depends(current_user)) -> dict[str, Any]:
    """Return Maps JS API key for lazy client load (auth required).

    The key is never committed or baked into the frontend build. Callers must
    load the Maps JavaScript API only after an explicit user action (e.g.
    "Load Street View"). Configure HTTP referrer restrictions in GCP.
    """
    del user  # auth gate only
    cfg = get_config()
    key = cfg.google_maps_api_key
    if not key:
        return {"apiKey": None, "configured": False}
    return {"apiKey": key, "configured": True}


@router.get("/status")
def maps_status() -> dict[str, Any]:
    """Whether Maps Platform is configured (never exposes the key)."""
    cfg = get_config()
    return {
        "googleMapsConfigured": bool(cfg.google_maps_api_key),
    }
