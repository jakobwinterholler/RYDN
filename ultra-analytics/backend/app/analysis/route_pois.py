"""Overpass POIs near a planned route — resupply, dining, sleep, emergency."""

from __future__ import annotations

import hashlib
import json
import os
import time
from typing import Any, Dict, List, Optional, Sequence, Tuple

import httpx

from ..util.geo import haversine_m

OVERPASS_URLS = (
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
)

# (category, osm_key, osm_value, group)
# Primary planning set — water, markets, fuel (filtered to shops), sleep.
# No hospitals, ATMs, pharmacies, bike shops, or dining dump.
POI_RULES: Tuple[Tuple[str, str, str, str], ...] = (
    ("Supermarket", "shop", "supermarket", "resupply"),
    ("Convenience", "shop", "convenience", "resupply"),
    ("Gas station", "amenity", "fuel", "resupply"),
    ("Drinking water", "amenity", "drinking_water", "water"),
    ("Water tap", "man_made", "water_tap", "water"),
    ("Hotel", "tourism", "hotel", "sleep"),
    ("Hostel", "tourism", "hostel", "sleep"),
    ("Campsite", "tourism", "camp_site", "sleep"),
    ("Shelter", "tourism", "wilderness_hut", "sleep"),
    ("Alpine hut", "tourism", "alpine_hut", "sleep"),
)

# Secondary — kept for full-route analysis / remote-gap context only.
SECONDARY_POI_RULES: Tuple[Tuple[str, str, str, str], ...] = (
    ("Bakery", "shop", "bakery", "resupply"),
    ("Bike shop", "shop", "bicycle", "service"),
    ("Pharmacy", "amenity", "pharmacy", "service"),
    ("Café", "amenity", "cafe", "dining"),
    ("Restaurant", "amenity", "restaurant", "dining"),
    ("Fast food", "amenity", "fast_food", "dining"),
)

ALL_POI_RULES: Tuple[Tuple[str, str, str, str], ...] = POI_RULES + SECONDARY_POI_RULES

# Viewport / Search primary groups — no pharmacy/bike/dining flood.
VIEWPORT_PRIMARY_GROUPS = frozenset({"water", "resupply", "sleep", "fuel", "all"})


def _fuel_has_shop(tags: Dict[str, str]) -> bool:
    """True when a fuel station likely has a shop (not a bare pump)."""
    shop = (tags.get("shop") or "").strip().lower()
    if shop and shop not in ("no", "false", "0"):
        return True
    if (tags.get("convenience") or "").lower() in ("yes", "true", "1"):
        return True
    if (tags.get("fuel:shop") or tags.get("service:shop") or "").lower() in (
        "yes",
        "true",
        "1",
    ):
        return True
    # Brand / name cues for staffed stations with shops
    blob = " ".join(
        str(tags.get(k) or "")
        for k in ("name", "brand", "operator", "amenity")
    ).lower()
    hints = (
        "select",
        "shop",
        "store",
        "express",
        "market",
        "circle k",
        "7-eleven",
        "7 eleven",
        "rewe to go",
        "spar",
        "avec",
        "night & day",
    )
    if any(h in blob for h in hints):
        return True
    # 24/7 fuel almost always has a shop / kiosk in Europe
    hours = (tags.get("opening_hours") or "").lower().replace(" ", "")
    if "24/7" in hours or hours in ("24hours", "24h") or "mo-su24" in hours:
        return True
    return False


def _is_24h_hours(hours: Optional[str]) -> bool:
    if not hours:
        return False
    h = hours.lower().replace(" ", "")
    return "24/7" in h or h in ("24hours", "24h") or "mo-su24" in h


_CACHE_DIR = None  # resolved lazily


def _cache_dir() -> str:
    global _CACHE_DIR
    if _CACHE_DIR is None:
        from ..paths import cache_dir

        _CACHE_DIR = cache_dir("overpass")
    return _CACHE_DIR


def _cache_path(key: str) -> str:
    d = _cache_dir()
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, f"{key}.json")


def _bbox(track: Sequence[Sequence[Any]], pad_deg: float = 0.08) -> Tuple[float, float, float, float]:
    lats = [float(r[0]) for r in track if len(r) >= 2]
    lons = [float(r[1]) for r in track if len(r) >= 2]
    return (
        min(lats) - pad_deg,
        min(lons) - pad_deg,
        max(lats) + pad_deg,
        max(lons) + pad_deg,
    )


def _build_query(south: float, west: float, north: float, east: float) -> str:
    parts = []
    seen = set()
    for _cat, key, val, _grp in ALL_POI_RULES:
        pair = (key, val)
        if pair in seen:
            continue
        seen.add(pair)
        parts.append(f'  node["{key}"="{val}"]({south},{west},{north},{east});')
        parts.append(f'  way["{key}"="{val}"]({south},{west},{north},{east});')
    body = "\n".join(parts)
    return f"[out:json][timeout:90];\n(\n{body}\n);\nout center tags;"


def _category_from_tags(tags: Dict[str, str]) -> Optional[Tuple[str, str]]:
    for cat, key, val, grp in ALL_POI_RULES:
        if tags.get(key) == val:
            return cat, grp
    return None


def _element_ll(el: dict) -> Optional[Tuple[float, float]]:
    if "lat" in el and "lon" in el:
        return float(el["lat"]), float(el["lon"])
    center = el.get("center") or {}
    if "lat" in center and "lon" in center:
        return float(center["lat"]), float(center["lon"])
    return None


def _project_onto_track(
    lat: float, lon: float, track: Sequence[Sequence[Any]], sample_step: int = 4
) -> Tuple[float, float]:
    """Return (distance_along_km, off_route_m)."""
    best_d = float("inf")
    best_km = 0.0
    n = len(track)
    for i in range(0, n, max(1, sample_step)):
        row = track[i]
        if len(row) < 2:
            continue
        d = haversine_m(lat, lon, float(row[0]), float(row[1]))
        if d < best_d:
            best_d = d
            best_km = float(row[3]) if len(row) > 3 else 0.0
    # Refine around best coarse index
    return best_km, best_d


def _fetch_elements(query: str) -> List[dict]:
    last_err: Optional[Exception] = None
    for url in OVERPASS_URLS:
        for attempt in range(3):
            try:
                with httpx.Client(timeout=120.0) as client:
                    res = client.post(url, data={"data": query})
                if res.status_code in (429, 504):
                    time.sleep(2 * (attempt + 1))
                    continue
                res.raise_for_status()
                return list((res.json() or {}).get("elements") or [])
            except Exception as exc:  # noqa: BLE001
                last_err = exc
                time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"Overpass unavailable: {last_err}")


def fetch_route_pois(
    track: Sequence[Sequence[Any]],
    *,
    force_refresh: bool = False,
    max_off_route_m: float = 600.0,
) -> Dict[str, Any]:
    """POIs projected onto the route. Cached by bbox hash."""
    if len(track) < 2:
        return {"pois": [], "sleep": [], "cache": "skipped", "error": None}

    south, west, north, east = _bbox(track)
    cache_key = hashlib.sha1(
        f"{south:.3f},{west:.3f},{north:.3f},{east:.3f}".encode()
    ).hexdigest()[:16]
    path = _cache_path(cache_key)
    cache_status = "miss"
    elements: List[dict] = []

    if not force_refresh and os.path.isfile(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                elements = json.load(f)
            cache_status = "hit"
        except (OSError, json.JSONDecodeError):
            elements = []

    error = None
    if cache_status == "miss":
        try:
            elements = _fetch_elements(_build_query(south, west, north, east))
            with open(path, "w", encoding="utf-8") as f:
                json.dump(elements, f)
        except Exception as exc:  # noqa: BLE001
            error = str(exc)
            elements = []

    # Coarse sample for projection speed
    step = max(1, len(track) // 800)
    pois: List[Dict[str, Any]] = []
    sleep: List[Dict[str, Any]] = []
    seen: set[Tuple[str, int]] = set()

    for el in elements:
        tags = el.get("tags") or {}
        if not isinstance(tags, dict):
            continue
        cat_grp = _category_from_tags(tags)
        if not cat_grp:
            continue
        category, group = cat_grp
        ll = _element_ll(el)
        if not ll:
            continue
        lat, lon = ll
        osm_type = el.get("type") or "node"
        osm_id = int(el.get("id") or 0)
        key = (osm_type, osm_id)
        if key in seen:
            continue
        seen.add(key)

        along_km, off_m = _project_onto_track(lat, lon, track, sample_step=step)
        if off_m > max_off_route_m and group != "sleep":
            continue
        if off_m > 1500:  # sleep can be a bit further off
            continue

        item = {
            "osmId": osm_id,
            "osmType": osm_type,
            "name": tags.get("name") or tags.get("brand") or tags.get("operator") or None,
            "brand": tags.get("brand"),
            "operator": tags.get("operator"),
            "category": category,
            "group": group,
            "lat": round(lat, 5),
            "lon": round(lon, 5),
            "distanceAlongKm": round(along_km, 2),
            "distanceOffRouteM": round(off_m),
            "openingHours": tags.get("opening_hours"),
            "website": tags.get("website") or tags.get("contact:website"),
        }
        if category == "Gas station":
            has_shop = _fuel_has_shop(tags)
            is24 = _is_24h_hours(tags.get("opening_hours"))
            item["hasShop"] = has_shop
            item["is24h"] = is24
            if has_shop and is24:
                item["category"] = "24h Shop"
            elif has_shop:
                item["category"] = "Fuel shop"
            else:
                # Bare pumps stay tagged but are demoted in scoring / skipped in Search
                item["category"] = "Gas station"
        if group == "sleep":
            sleep.append(item)
        else:
            pois.append(item)

    pois.sort(key=lambda p: p["distanceAlongKm"])
    sleep.sort(key=lambda p: p["distanceAlongKm"])
    return {"pois": pois, "sleep": sleep, "cache": cache_status, "error": error}


# Groups accepted by viewport search (maps to POI_RULES.group or special filters).
VIEWPORT_GROUPS = ("water", "resupply", "dining", "service", "sleep", "fuel", "all")


def _build_viewport_query(
    south: float,
    west: float,
    north: float,
    east: float,
    group: Optional[str] = None,
) -> str:
    """Tighter Overpass query for a map viewport — primary planning categories only."""
    parts = []
    seen = set()
    for cat, key, val, grp in POI_RULES:
        if group and group not in ("all", None, ""):
            if group == "fuel" and cat != "Gas station":
                continue
            if group == "water" and grp != "water":
                continue
            if group == "resupply" and cat not in ("Supermarket", "Convenience"):
                continue
            if group == "sleep" and grp != "sleep":
                continue
            if group in ("dining", "service"):
                # Secondary groups not in primary POI_RULES — empty intentional
                continue
        pair = (key, val)
        if pair in seen:
            continue
        seen.add(pair)
        parts.append(f'  node["{key}"="{val}"]({south},{west},{north},{east});')
        parts.append(f'  way["{key}"="{val}"]({south},{west},{north},{east});')
    body = "\n".join(parts) if parts else '  node["amenity"="drinking_water"](0,0,0,0);'
    return f"[out:json][timeout:45];\n(\n{body}\n);\nout center tags;"


def fetch_viewport_pois(
    south: float,
    west: float,
    north: float,
    east: float,
    *,
    group: Optional[str] = None,
    max_results: int = 400,
    track: Optional[Sequence[Sequence[Any]]] = None,
    exclude_ids: Optional[Sequence[str]] = None,
    limit: int = 15,
    max_off_route_m: float = 900.0,
) -> Dict[str, Any]:
    """POIs for a visible map bbox — scored batch for Search-this-area.

    Returns the next ~`limit` candidates sorted by resupply score, skipping
    `exclude_ids` (already-seen / verified). Projects onto `track` when given
    so off-route distance and along-route km are real.
    """
    from .route_stops import rank_candidates

    # Clamp absurdly large viewports (whole-continent pans).
    if north - south > 2.5 or east - west > 2.5:
        return {
            "pois": [],
            "cache": "skipped",
            "error": "Zoom in closer to search this area.",
            "truncated": False,
            "hasMore": False,
            "batchSize": limit,
            "excludedCount": len(exclude_ids or []),
        }

    g = (group or "all").strip().lower()
    # Zoom-aware soft cap: wide span → fewer markers for readability
    span = max(north - south, abs(east - west))
    if span > 1.2:
        limit = min(limit, 5)
    elif span > 0.55:
        limit = min(limit, 8)
    elif span > 0.22:
        limit = min(limit, 12)

    cache_key = hashlib.sha1(
        f"vp3:{south:.3f},{west:.3f},{north:.3f},{east:.3f}:{g}".encode()
    ).hexdigest()[:16]
    path = _cache_path(cache_key)
    cache_status = "miss"
    elements: List[dict] = []

    if os.path.isfile(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                elements = json.load(f)
            cache_status = "hit"
        except (OSError, json.JSONDecodeError):
            elements = []

    error = None
    if cache_status == "miss":
        try:
            elements = _fetch_elements(_build_viewport_query(south, west, north, east, g))
            with open(path, "w", encoding="utf-8") as f:
                json.dump(elements, f)
        except Exception as exc:  # noqa: BLE001
            error = str(exc)
            elements = []

    step = max(1, len(track) // 800) if track and len(track) >= 2 else 4
    pois: List[Dict[str, Any]] = []
    seen: set[Tuple[str, int]] = set()
    for el in elements:
        tags = el.get("tags") or {}
        if not isinstance(tags, dict):
            continue
        cat_grp = _category_from_tags(tags)
        if not cat_grp:
            continue
        category, grp = cat_grp

        # Drop secondary categories from Search (pharmacy / bike / dining)
        if category in ("Pharmacy", "Bike shop", "Café", "Restaurant", "Fast food", "Bakery"):
            continue

        hours = tags.get("opening_hours")
        is24 = _is_24h_hours(hours)
        has_shop = False
        out_cat = category

        if category == "Gas station":
            has_shop = _fuel_has_shop(tags)
            if not has_shop:
                continue  # bare pumps out of primary Search
            out_cat = "24h Shop" if is24 else "Fuel shop"
            # Fuel QA wants 24h shops; "all" accepts any fuel shop
            if g == "fuel" and not is24:
                # Still include strong shop stations; prefer 24h via scoring
                pass

        if g == "fuel" and category != "Gas station":
            continue
        if g == "water" and grp != "water":
            continue
        if g == "resupply" and category not in ("Supermarket", "Convenience"):
            continue
        if g == "sleep" and grp != "sleep":
            continue
        if g in ("dining", "service"):
            continue

        ll = _element_ll(el)
        if not ll:
            continue
        lat, lon = ll
        osm_type = el.get("type") or "node"
        osm_id = int(el.get("id") or 0)
        key = (osm_type, osm_id)
        if key in seen:
            continue
        seen.add(key)

        along_km = 0.0
        off_m = 0.0
        if track and len(track) >= 2:
            along_km, off_m = _project_onto_track(lat, lon, track, sample_step=step)
            if grp != "sleep" and off_m > max_off_route_m:
                continue
            if grp == "sleep" and off_m > 1500:
                continue

        pois.append(
            {
                "id": f"area-{osm_type}-{osm_id}",
                "osmId": osm_id,
                "osmType": osm_type,
                "name": tags.get("name") or tags.get("brand") or tags.get("operator") or None,
                "brand": tags.get("brand"),
                "operator": tags.get("operator"),
                "category": out_cat,
                "group": grp,
                "lat": round(lat, 5),
                "lon": round(lon, 5),
                "distanceAlongKm": round(along_km, 2),
                "distanceOffRouteM": round(off_m),
                "openingHours": hours,
                "website": tags.get("website") or tags.get("contact:website"),
                "is24h": is24,
                "hasShop": has_shop if category == "Gas station" else None,
                "reviewStatus": "unreviewed",
                "googleMapsUrl": f"https://www.google.com/maps/search/?api=1&query={lat},{lon}",
            }
        )
        if len(pois) >= max_results:
            break

    batch, has_more = rank_candidates(pois, exclude_ids=exclude_ids, limit=limit)
    return {
        "pois": batch,
        "cache": cache_status,
        "error": error,
        "truncated": len(elements) > max_results,
        "hasMore": has_more,
        "batchSize": limit,
        "candidateCount": len(pois),
        "excludedCount": len(exclude_ids or []),
    }
