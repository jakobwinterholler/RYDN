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
POI_RULES: Tuple[Tuple[str, str, str, str], ...] = (
    ("Supermarket", "shop", "supermarket", "resupply"),
    ("Convenience", "shop", "convenience", "resupply"),
    ("Bakery", "shop", "bakery", "resupply"),
    ("Gas station", "amenity", "fuel", "resupply"),
    ("Bike shop", "shop", "bicycle", "service"),
    ("Pharmacy", "amenity", "pharmacy", "service"),
    ("Drinking water", "amenity", "drinking_water", "water"),
    ("Water tap", "man_made", "water_tap", "water"),
    ("Café", "amenity", "cafe", "dining"),
    ("Restaurant", "amenity", "restaurant", "dining"),
    ("Fast food", "amenity", "fast_food", "dining"),
    ("Hotel", "tourism", "hotel", "sleep"),
    ("Hostel", "tourism", "hostel", "sleep"),
    ("Campsite", "tourism", "camp_site", "sleep"),
    ("Shelter", "tourism", "wilderness_hut", "sleep"),
    ("Alpine hut", "tourism", "alpine_hut", "sleep"),
)

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
    for _cat, key, val, _grp in POI_RULES:
        pair = (key, val)
        if pair in seen:
            continue
        seen.add(pair)
        parts.append(f'  node["{key}"="{val}"]({south},{west},{north},{east});')
        parts.append(f'  way["{key}"="{val}"]({south},{west},{north},{east});')
    body = "\n".join(parts)
    return f"[out:json][timeout:90];\n(\n{body}\n);\nout center tags;"


def _category_from_tags(tags: Dict[str, str]) -> Optional[Tuple[str, str]]:
    for cat, key, val, grp in POI_RULES:
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
            "category": category,
            "group": group,
            "lat": round(lat, 5),
            "lon": round(lon, 5),
            "distanceAlongKm": round(along_km, 2),
            "distanceOffRouteM": round(off_m),
            "openingHours": tags.get("opening_hours"),
            "website": tags.get("website") or tags.get("contact:website"),
        }
        if group == "sleep":
            sleep.append(item)
        else:
            pois.append(item)

    pois.sort(key=lambda p: p["distanceAlongKm"])
    sleep.sort(key=lambda p: p["distanceAlongKm"])
    return {"pois": pois, "sleep": sleep, "cache": cache_status, "error": error}
