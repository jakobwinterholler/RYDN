"""Overpass POIs near a planned route — resupply, dining, sleep, emergency.

Search-this-area (Option A):
  Corridor projected POIs are preloaded on analysis and cached per track.
  Viewport search filters that cache spatially — no Overpass on the hot path.
  Overpass only runs when the viewport is outside the corridor (cold fill).
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from typing import Any, Dict, List, Optional, Sequence, Tuple

import httpx

from ..util.geo import haversine_m
from . import poi_corridor

log = logging.getLogger("rydn.search")

# Prefer mirrors that respond; kumi.systems often hangs (120s×retries) and
# blocks Search-this-area until later mirrors are tried.
OVERPASS_URLS = (
    "https://overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
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


def _parse_hotel_stars(tags: Dict[str, Any]) -> Optional[int]:
    """OSM hotel classification stars (1–5), if tagged. Not guest review ratings."""
    raw = tags.get("stars") or tags.get("stars:hotel") or tags.get("hotel:stars")
    if raw is None:
        return None
    try:
        # Accept "3", "3.0", "3*" — ignore free-text / ranges.
        text = str(raw).strip().replace("*", "").replace("★", "")
        if not text or "/" in text or "-" in text:
            return None
        n = float(text)
    except (TypeError, ValueError):
        return None
    if not (1.0 <= n <= 5.0):
        return None
    return max(1, min(5, int(round(n))))


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


def _fetch_elements(
    query: str,
    *,
    total_timeout_s: float = 25.0,
    connect_timeout_s: float = 8.0,
    max_attempts: int = 2,
    max_mirrors: Optional[int] = None,
) -> List[dict]:
    """POST to Overpass mirrors, respecting a hard wall-clock budget.

    Critical: never stack full per-mirror timeouts (3×3.5s ≈ 10s) past the
    client Search abort (5s). Deadline is absolute across mirrors/attempts.
    """
    last_err: Optional[Exception] = None
    deadline = time.perf_counter() + max(0.5, total_timeout_s)
    mirrors = OVERPASS_URLS[: max(1, max_mirrors)] if max_mirrors else OVERPASS_URLS
    for url in mirrors:
        for attempt in range(max_attempts):
            remaining = deadline - time.perf_counter()
            if remaining < 0.6:
                break
            timeout = httpx.Timeout(
                remaining,
                connect=min(connect_timeout_s, max(0.4, remaining * 0.4)),
            )
            try:
                with httpx.Client(timeout=timeout) as client:
                    res = client.post(url, data={"data": query})
                if res.status_code in (429, 504):
                    time.sleep(min(0.35, max(0.0, deadline - time.perf_counter())))
                    continue
                res.raise_for_status()
                return list((res.json() or {}).get("elements") or [])
            except Exception as exc:  # noqa: BLE001
                last_err = exc
                time.sleep(min(0.25, max(0.0, deadline - time.perf_counter())))
    raise RuntimeError(f"Overpass unavailable: {last_err}")


def _elements_to_projected(
    elements: List[dict],
    track: Sequence[Sequence[Any]],
    *,
    max_off_route_m: float,
    primary_only: bool = False,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Project OSM elements onto track → (pois, sleep)."""
    step = max(1, len(track) // 800) if track and len(track) >= 2 else 4
    pois: List[Dict[str, Any]] = []
    sleep: List[Dict[str, Any]] = []
    seen: set[Tuple[str, int]] = set()
    rules = POI_RULES if primary_only else ALL_POI_RULES

    for el in elements:
        tags = el.get("tags") or {}
        if not isinstance(tags, dict):
            continue
        cat_grp = None
        for cat, key, val, grp in rules:
            if tags.get(key) == val:
                cat_grp = (cat, grp)
                break
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

        along_km, off_m = poi_corridor.nearest_off_route_m(
            lat, lon, track, sample_step=step
        )
        if off_m > max_off_route_m and group != "sleep":
            continue
        if off_m > max(1500.0, max_off_route_m) and group == "sleep":
            continue
        if off_m > 1500 and group == "sleep" and max_off_route_m <= 500:
            # Legacy analysis sleep cap
            pass

        hours = tags.get("opening_hours")
        is24 = _is_24h_hours(hours)
        has_shop = False
        out_cat = category
        if category == "Gas station":
            has_shop = _fuel_has_shop(tags)
            if has_shop and is24:
                out_cat = "24h Shop"
            elif has_shop:
                out_cat = "Fuel shop"
            else:
                out_cat = "Gas station"

        item = {
            "id": f"area-{osm_type}-{osm_id}",
            "osmId": osm_id,
            "osmType": osm_type,
            "name": tags.get("name") or tags.get("brand") or tags.get("operator") or None,
            "brand": tags.get("brand"),
            "operator": tags.get("operator"),
            "category": out_cat,
            "group": group,
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
        if group == "sleep":
            hotel_stars = _parse_hotel_stars(tags)
            if hotel_stars is not None:
                item["hotelStars"] = hotel_stars
            sleep.append(item)
        else:
            pois.append(item)

    pois.sort(key=lambda p: p["distanceAlongKm"])
    sleep.sort(key=lambda p: p["distanceAlongKm"])
    return pois, sleep


def fetch_route_pois(
    track: Sequence[Sequence[Any]],
    *,
    force_refresh: bool = False,
    max_off_route_m: float = 500.0,
) -> Dict[str, Any]:
    """POIs projected onto the route. Cached by track fingerprint (projected).

    Also writes the Search corridor cache (primary categories, wider pad) so
    Search-this-area never needs Overpass on the hot path.
    """
    if len(track) < 2:
        return {"pois": [], "sleep": [], "cache": "skipped", "error": None}

    t0 = time.perf_counter()
    fp = poi_corridor.track_fingerprint(track)
    # Analysis keeps a tighter off-route filter; Search corridor is wider.
    analysis_key = f"analysis:{fp}:{int(max_off_route_m)}"
    analysis_path = os.path.join(poi_corridor._cache_root(), f"{hashlib.sha1(analysis_key.encode()).hexdigest()[:16]}.analysis.json")

    if not force_refresh and os.path.isfile(analysis_path):
        try:
            with open(analysis_path, "r", encoding="utf-8") as f:
                cached = json.load(f)
            if isinstance(cached.get("pois"), list):
                # Prefer existing Search corridor; if missing, rebuild from raw OSM cache.
                existing = poi_corridor.get_memory_corridor(fp) or poi_corridor.load_corridor_cache(fp)
                if existing:
                    poi_corridor.put_memory_corridor(existing)
                else:
                    # Re-project from raw Overpass cache at corridor width (no network).
                    south, west, north, east = _bbox(track)
                    raw_key = hashlib.sha1(
                        f"{south:.3f},{west:.3f},{north:.3f},{east:.3f}".encode()
                    ).hexdigest()[:16]
                    raw_path = _cache_path(raw_key)
                    if os.path.isfile(raw_path):
                        try:
                            with open(raw_path, "r", encoding="utf-8") as rf:
                                raw_elems = json.load(rf)
                            pad = poi_corridor.corridor_pad_m()
                            wp, ws = _elements_to_projected(
                                raw_elems,
                                track,
                                max_off_route_m=pad,
                                primary_only=False,
                            )
                            _ensure_search_corridor_from_projected(track, wp, ws, force=True)
                        except (OSError, json.JSONDecodeError, TypeError):
                            _ensure_search_corridor_from_projected(
                                track,
                                cached.get("pois") or [],
                                cached.get("sleep") or [],
                                force=False,
                            )
                    else:
                        _ensure_search_corridor_from_projected(
                            track,
                            cached.get("pois") or [],
                            cached.get("sleep") or [],
                            force=False,
                        )
                log.info(
                    "poi_analysis cache=hit fingerprint=%s pois=%d sleep=%d ms=%.0f",
                    fp,
                    len(cached.get("pois") or []),
                    len(cached.get("sleep") or []),
                    (time.perf_counter() - t0) * 1000,
                )
                return {
                    "pois": cached["pois"],
                    "sleep": cached.get("sleep") or [],
                    "cache": "hit",
                    "error": None,
                }
        except (OSError, json.JSONDecodeError, TypeError):
            pass

    # Raw Overpass element cache (bbox) — avoid re-download when projecting.
    south, west, north, east = _bbox(track)
    raw_key = hashlib.sha1(
        f"{south:.3f},{west:.3f},{north:.3f},{east:.3f}".encode()
    ).hexdigest()[:16]
    raw_path = _cache_path(raw_key)
    cache_status = "miss"
    elements: List[dict] = []

    if not force_refresh and os.path.isfile(raw_path):
        try:
            with open(raw_path, "r", encoding="utf-8") as f:
                elements = json.load(f)
            cache_status = "hit"
        except (OSError, json.JSONDecodeError):
            elements = []

    error = None
    t_op = None
    if cache_status == "miss" or force_refresh:
        try:
            t_op0 = time.perf_counter()
            elements = _fetch_elements(_build_query(south, west, north, east))
            t_op = (time.perf_counter() - t_op0) * 1000
            with open(raw_path, "w", encoding="utf-8") as f:
                json.dump(elements, f)
            cache_status = "miss"
        except Exception as exc:  # noqa: BLE001
            error = str(exc)
            elements = []

    t_proj0 = time.perf_counter()
    # Project once at Search corridor width; analysis keeps a tighter subset.
    pad = poi_corridor.corridor_pad_m()
    wide_pois, wide_sleep = _elements_to_projected(
        elements,
        track,
        max_off_route_m=max(pad, max_off_route_m),
        primary_only=False,
    )
    pois = [
        p
        for p in wide_pois
        if float(p.get("distanceOffRouteM") or 0) <= max_off_route_m
        or (p.get("group") == "sleep")
    ]
    # Sleep cap for analysis remains 1500 m.
    sleep = [s for s in wide_sleep if float(s.get("distanceOffRouteM") or 0) <= 1500]
    # Non-sleep analysis also drops sleep-group bleed from wide_pois filter above
    pois = [p for p in pois if p.get("group") != "sleep"]
    t_proj = (time.perf_counter() - t_proj0) * 1000

    try:
        with open(analysis_path, "w", encoding="utf-8") as f:
            json.dump({"pois": pois, "sleep": sleep, "fingerprint": fp}, f)
    except OSError:
        pass

    _ensure_search_corridor_from_projected(track, wide_pois, wide_sleep, force=True)

    log.info(
        "poi_analysis cache=%s fingerprint=%s pois=%d sleep=%d overpass_ms=%s project_ms=%.0f total_ms=%.0f err=%s",
        cache_status,
        fp,
        len(pois),
        len(sleep),
        f"{t_op:.0f}" if t_op is not None else "-",
        t_proj,
        (time.perf_counter() - t0) * 1000,
        error,
    )
    return {"pois": pois, "sleep": sleep, "cache": cache_status, "error": error}


def _ensure_search_corridor_from_projected(
    track: Sequence[Sequence[Any]],
    pois: Sequence[Dict[str, Any]],
    sleep: Sequence[Dict[str, Any]],
    *,
    force: bool = False,
) -> Dict[str, Any]:
    """Persist primary Search corridor (wider pad) from already-projected POIs."""
    fp = poi_corridor.track_fingerprint(track)
    pad = poi_corridor.corridor_pad_m()
    existing = None if force else (
        poi_corridor.get_memory_corridor(fp) or poi_corridor.load_corridor_cache(fp)
    )
    if existing and int(existing.get("schema") or 0) >= poi_corridor.CACHE_SCHEMA:
        poi_corridor.put_memory_corridor(existing)
        return existing

    # Primary-only for Search; keep POIs within corridor pad (sleep slightly farther).
    primary_cats = {r[0] for r in POI_RULES}
    # Gas station rules map to renamed categories
    primary_out = {"24h Shop", "Fuel shop", "Gas station"} | primary_cats
    combined: List[Dict[str, Any]] = []
    seen: set[Tuple[str, int]] = set()
    for p in list(pois) + list(sleep):
        cat = p.get("category") or ""
        grp = p.get("group") or ""
        # Map original gas → already renamed in projector
        if cat not in primary_out and grp not in ("water", "sleep", "resupply"):
            continue
        if cat in ("Pharmacy", "Bike shop", "Café", "Restaurant", "Fast food"):
            continue
        # Bakery is Markets-eligible (snacks) — keep in Search corridor.
        off = float(p.get("distanceOffRouteM") or 9999)
        if grp == "sleep":
            if off > max(1500.0, pad):
                continue
        else:
            if off > pad:
                continue
        # Drop bare pumps from Search corridor
        if cat == "Gas station" and not p.get("hasShop"):
            continue
        key = (str(p.get("osmType") or "node"), int(p.get("osmId") or 0))
        if key in seen:
            continue
        seen.add(key)
        item = dict(p)
        if not str(item.get("id") or "").startswith("area-"):
            item["id"] = f"area-{key[0]}-{key[1]}"
        combined.append(item)

    bb = poi_corridor.corridor_bbox(track, pad)
    data = {
        "schema": poi_corridor.CACHE_SCHEMA,
        "fingerprint": fp,
        "corridorPadM": pad,
        "bbox": list(bb),
        "builtAt": time.time(),
        "pois": combined,
    }
    try:
        poi_corridor.save_corridor_cache(data)
    except OSError:
        pass
    poi_corridor.put_memory_corridor(data)
    return data


def _analysis_cache_path(fingerprint: str, max_off_route_m: float) -> str:
    analysis_key = f"analysis:{fingerprint}:{int(max_off_route_m)}"
    return os.path.join(
        poi_corridor._cache_root(),
        f"{hashlib.sha1(analysis_key.encode()).hexdigest()[:16]}.analysis.json",
    )


def _load_analysis_poi_bundle(
    fingerprint: str,
) -> Optional[Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]]:
    """Load projected analysis POIs from disk (no network).

    Tries common off-route pads, then any *.analysis.json whose fingerprint matches.
    """
    for off in (500, 3000, 800, 1000, 1500):
        path = _analysis_cache_path(fingerprint, float(off))
        if not os.path.isfile(path):
            continue
        try:
            with open(path, "r", encoding="utf-8") as f:
                cached = json.load(f)
            pois = cached.get("pois")
            if isinstance(pois, list) and pois:
                sleep = cached.get("sleep") if isinstance(cached.get("sleep"), list) else []
                return pois, sleep
        except (OSError, json.JSONDecodeError, TypeError):
            continue
    # Fingerprint match across any analysis cache files (pad may differ).
    root = poi_corridor._cache_root()
    try:
        names = os.listdir(root)
    except OSError:
        names = []
    for name in names:
        if not name.endswith(".analysis.json"):
            continue
        path = os.path.join(root, name)
        try:
            with open(path, "r", encoding="utf-8") as f:
                cached = json.load(f)
            if cached.get("fingerprint") != fingerprint:
                continue
            pois = cached.get("pois")
            if isinstance(pois, list) and pois:
                sleep = cached.get("sleep") if isinstance(cached.get("sleep"), list) else []
                return pois, sleep
        except (OSError, json.JSONDecodeError, TypeError):
            continue
    return None


def hydrate_corridor_from_analysis(
    track: Sequence[Sequence[Any]],
) -> Optional[Dict[str, Any]]:
    """Build Search corridor from analysis POI cache — disk only, no Overpass.

    Prod often has analysis cache from route open but an empty Search corridor
    (volume cold / preload still running / Overpass timed out). Hydrating here
    keeps Search under the client 5s abort.
    """
    if len(track) < 2:
        return None
    fp = poi_corridor.track_fingerprint(track)
    mem = poi_corridor.get_memory_corridor(fp)
    if mem and (mem.get("pois") or []):
        return mem
    disk = poi_corridor.load_corridor_cache(fp)
    if disk and (disk.get("pois") or []):
        poi_corridor.put_memory_corridor(disk)
        return disk
    bundle = _load_analysis_poi_bundle(fp)
    if not bundle:
        return None
    pois, sleep = bundle
    t0 = time.perf_counter()
    corridor = _ensure_search_corridor_from_projected(track, pois, sleep, force=True)
    log.info(
        "search cache=analysis-hydrate fingerprint=%s corridor_pois=%d ms=%.0f",
        fp,
        len(corridor.get("pois") or []),
        (time.perf_counter() - t0) * 1000,
    )
    return corridor


def ensure_search_corridor(
    track: Sequence[Sequence[Any]],
    *,
    force_refresh: bool = False,
    build_if_missing: bool = True,
) -> Dict[str, Any]:
    """Load or build the Search corridor cache for a track.

    Prefer disk/memory hit. On miss, hydrate from analysis cache (no network).
    Only when build_if_missing=True do we call Overpass via fetch_route_pois.
    Search requests pass build_if_missing=False — they must stay under the
    client 5s abort; Overpass fill stays budgeted inside fetch_viewport_pois.
    """
    empty = {
        "schema": poi_corridor.CACHE_SCHEMA,
        "fingerprint": "empty",
        "corridorPadM": poi_corridor.corridor_pad_m(),
        "bbox": [0, 0, 0, 0],
        "pois": [],
    }
    if len(track) < 2:
        return empty

    fp = poi_corridor.track_fingerprint(track)
    if not force_refresh:
        mem = poi_corridor.get_memory_corridor(fp)
        if mem and (mem.get("pois") or []):
            return mem
        disk = poi_corridor.load_corridor_cache(fp)
        if disk and (disk.get("pois") or []):
            poi_corridor.put_memory_corridor(disk)
            return disk
        # Local hydrate from analysis — instant vs Overpass; safe for Search.
        hydrated = hydrate_corridor_from_analysis(track)
        if hydrated and (hydrated.get("pois") or []):
            return hydrated
        if not build_if_missing:
            return {**empty, "fingerprint": fp}

    # Build via fetch_route_pois (writes both analysis + search caches)
    pad = poi_corridor.corridor_pad_m()
    bundle = fetch_route_pois(track, force_refresh=force_refresh, max_off_route_m=pad)
    mem = poi_corridor.get_memory_corridor(fp) or poi_corridor.load_corridor_cache(fp)
    if mem:
        return mem
    # Fallback empty shell
    return _ensure_search_corridor_from_projected(
        track, bundle.get("pois") or [], bundle.get("sleep") or [], force=True
    )


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
    return f"[out:json][timeout:20];\n(\n{body}\n);\nout center tags;"


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
    max_off_route_m: float = 500.0,
    allow_overpass: bool = True,
    overpass_budget_s: float = 3.5,
) -> Dict[str, Any]:
    """POIs for a visible map bbox — corridor cache first, Overpass only as fill.

    Hot path (viewport ∩ corridor): spatial filter + rank, typically <50 ms.
    Cold path (outside corridor / empty cache): short Overpass attempt, then merge.
    """
    t0 = time.perf_counter()
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
            "timings": {
                "totalMs": round((time.perf_counter() - t0) * 1000, 2),
                "serverMs": 0,
                "overpassMs": None,
                "spatialFilterMs": 0,
            },
            "stats": {"cache": "skipped", "returned": 0},
        }

    g = (group or "all").strip().lower()
    track = track or []

    # --- Option A hot path: corridor projected cache (+ analysis hydrate) ---
    t_cache0 = time.perf_counter()
    corridor = None
    hydrated_from_analysis = False
    if len(track) >= 2:
        fp = poi_corridor.track_fingerprint(track)
        corridor = poi_corridor.get_memory_corridor(fp) or poi_corridor.load_corridor_cache(fp)
        if corridor and (corridor.get("pois") or []):
            poi_corridor.put_memory_corridor(corridor)
        else:
            # Prod cold: Search corridor missing but analysis POIs exist from route open.
            # Hydrate locally (~40ms) — never wait on Overpass for the hot path.
            hydrated = hydrate_corridor_from_analysis(track)
            if hydrated and (hydrated.get("pois") or []):
                corridor = hydrated
                hydrated_from_analysis = True
    t_cache_ms = (time.perf_counter() - t_cache0) * 1000.0

    viewport = (south, west, north, east)
    if corridor and corridor.get("pois") is not None:
        cbox = corridor.get("bbox") or [0, 0, 0, 0]
        corridor_box = (float(cbox[0]), float(cbox[1]), float(cbox[2]), float(cbox[3]))
        if poi_corridor.bbox_intersects(viewport, corridor_box):
            result = poi_corridor.query_viewport(
                corridor,
                south=south,
                west=west,
                north=north,
                east=east,
                group=g,
                limit=limit,
                exclude_ids=exclude_ids,
            )
            if hydrated_from_analysis:
                result["cache"] = "analysis-hydrate"
                if isinstance(result.get("stats"), dict):
                    result["stats"]["cache"] = "analysis-hydrate"
            timings = dict(result.get("timings") or {})
            timings["cacheLookupMs"] = round(t_cache_ms, 3)
            timings["totalMs"] = round((time.perf_counter() - t0) * 1000, 2)
            timings["serverMs"] = timings["totalMs"]
            result["timings"] = timings
            log.info(
                "search cache=%s group=%s candidates=%s returned=%s total_ms=%.1f spatial_ms=%s",
                result.get("cache"),
                g,
                result.get("candidateCount"),
                len(result.get("pois") or []),
                timings["totalMs"],
                timings.get("spatialFilterMs"),
            )
            # Warm/hydrated corridor answered (including true empty group in viewport).
            # Only fall through when the corridor itself is empty/broken.
            if (result.get("candidateCount") or 0) > 0 or len(corridor.get("pois") or []) > 0:
                return result
            # Empty corridor blob — fall through to quick Overpass fill below.
            log.info("search cache=corridor-empty group=%s — trying viewport Overpass fill", g)

    # --- Cold path: viewport outside corridor or no corridor yet ---
    if not allow_overpass:
        return {
            "pois": [],
            "cache": "miss",
            "error": "Search corridor not ready.",
            "truncated": False,
            "hasMore": False,
            "batchSize": limit,
            "candidateCount": 0,
            "excludedCount": len(exclude_ids or []),
            "timings": {
                "totalMs": round((time.perf_counter() - t0) * 1000, 2),
                "serverMs": round((time.perf_counter() - t0) * 1000, 2),
                "cacheLookupMs": round(t_cache_ms, 3),
                "overpassMs": None,
                "spatialFilterMs": 0,
            },
            "stats": {"cache": "miss", "returned": 0},
        }

    # Prefer building corridor if we have a track and no cache yet (one-time cost).
    # But Search must respect the budget — if corridor build would take forever,
    # fall back to a tight viewport Overpass with short timeout.
    overpass_ms = None
    error = None
    elements: List[dict] = []
    cache_status = "miss"

    # Viewport tile disk cache (legacy) — still useful for outside-corridor fills
    cache_key = hashlib.sha1(
        f"vp3:{south:.3f},{west:.3f},{north:.3f},{east:.3f}:{g}".encode()
    ).hexdigest()[:16]
    path = _cache_path(cache_key)
    if os.path.isfile(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                elements = json.load(f)
            cache_status = "hit"
        except (OSError, json.JSONDecodeError):
            elements = []

    if cache_status == "miss":
        t_op0 = time.perf_counter()
        # Keep wall clock under client SEARCH_TIMEOUT_MS (5s): one mirror, hard deadline.
        budget = min(3.0, max(1.2, overpass_budget_s))
        try:
            elements = _fetch_elements(
                _build_viewport_query(south, west, north, east, g),
                total_timeout_s=budget,
                connect_timeout_s=min(1.5, budget),
                max_attempts=1,
                max_mirrors=1,
            )
            overpass_ms = (time.perf_counter() - t_op0) * 1000
            with open(path, "w", encoding="utf-8") as f:
                json.dump(elements, f)
        except Exception as exc:  # noqa: BLE001
            error = str(exc)
            overpass_ms = (time.perf_counter() - t_op0) * 1000
            elements = []

    t_proj0 = time.perf_counter()
    if track and len(track) >= 2:
        pad = poi_corridor.corridor_pad_m()
        pois, sleep = _elements_to_projected(
            elements,
            track,
            max_off_route_m=max(pad, max_off_route_m),
            primary_only=True,
        )
        projected = pois + sleep
    else:
        # No track — keep elements as lightweight POIs without projection
        projected = []
        for el in elements[:max_results]:
            tags = el.get("tags") or {}
            cat_grp = _category_from_tags(tags)
            if not cat_grp:
                continue
            category, grp = cat_grp
            ll = _element_ll(el)
            if not ll:
                continue
            lat, lon = ll
            osm_type = el.get("type") or "node"
            osm_id = int(el.get("id") or 0)
            hours = tags.get("opening_hours")
            is24 = _is_24h_hours(hours)
            has_shop = _fuel_has_shop(tags) if category == "Gas station" else False
            out_cat = category
            if category == "Gas station":
                if not has_shop:
                    continue
                out_cat = "24h Shop" if is24 else "Fuel shop"
            projected.append(
                {
                    "id": f"area-{osm_type}-{osm_id}",
                    "osmId": osm_id,
                    "osmType": osm_type,
                    "name": tags.get("name") or tags.get("brand") or tags.get("operator"),
                    "category": out_cat,
                    "group": grp,
                    "lat": round(lat, 5),
                    "lon": round(lon, 5),
                    "distanceAlongKm": 0.0,
                    "distanceOffRouteM": 0,
                    "openingHours": hours,
                    "is24h": is24,
                    "hasShop": has_shop if category == "Gas station" else None,
                    "googleMapsUrl": f"https://www.google.com/maps/search/?api=1&query={lat},{lon}",
                }
            )
    t_proj_ms = (time.perf_counter() - t_proj0) * 1000

    # Merge into corridor cache when we have a track
    if track and len(track) >= 2 and projected:
        fp = poi_corridor.track_fingerprint(track)
        base = (
            poi_corridor.get_memory_corridor(fp)
            or poi_corridor.load_corridor_cache(fp)
            or {
                "schema": poi_corridor.CACHE_SCHEMA,
                "fingerprint": fp,
                "corridorPadM": poi_corridor.corridor_pad_m(),
                "bbox": list(poi_corridor.corridor_bbox(track, poi_corridor.corridor_pad_m())),
                "pois": [],
            }
        )
        merged = poi_corridor.merge_pois_into_corridor(base, projected)
        try:
            poi_corridor.save_corridor_cache(merged)
        except OSError:
            pass
        poi_corridor.put_memory_corridor(merged)
        corridor = merged
    elif corridor is None and track and len(track) >= 2:
        corridor = {
            "schema": poi_corridor.CACHE_SCHEMA,
            "fingerprint": poi_corridor.track_fingerprint(track),
            "corridorPadM": poi_corridor.corridor_pad_m(),
            "bbox": list(poi_corridor.corridor_bbox(track, poi_corridor.corridor_pad_m())),
            "pois": projected,
        }

    if corridor and corridor.get("pois") is not None:
        result = poi_corridor.query_viewport(
            corridor,
            south=south,
            west=west,
            north=north,
            east=east,
            group=g,
            limit=limit,
            exclude_ids=exclude_ids,
        )
    else:
        from .route_stops import rank_candidates

        grouped = poi_corridor.filter_group(projected, g)
        batch, has_more = rank_candidates(grouped, exclude_ids=exclude_ids, limit=limit)
        result = {
            "pois": batch,
            "cache": cache_status,
            "error": error,
            "truncated": False,
            "hasMore": has_more,
            "batchSize": limit,
            "candidateCount": len(grouped),
            "excludedCount": len(exclude_ids or []),
        }

    total_ms = (time.perf_counter() - t0) * 1000
    timings = dict(result.get("timings") or {})
    timings.update(
        {
            "totalMs": round(total_ms, 2),
            "serverMs": round(total_ms, 2),
            "cacheLookupMs": round(t_cache_ms, 3),
            "overpassMs": round(overpass_ms, 1) if overpass_ms is not None else None,
            "projectMs": round(t_proj_ms, 2),
        }
    )
    result["timings"] = timings
    result["cache"] = "corridor-miss" if cache_status == "miss" else "viewport-hit"
    if error and result.get("pois"):
        result["error"] = None  # partial OK — never fail when results exist
    elif error and not result.get("pois"):
        # Overpass timeout/unavailable with zero hits: settle as empty, not hard fail.
        # Client 5s abort + stacked mirror timeouts previously toasted "Search failed".
        result["error"] = None
        result["cache"] = "overpass-miss"
    result["stats"] = {
        "cache": result["cache"],
        "corridorPois": len((corridor or {}).get("pois") or []),
        "candidates": result.get("candidateCount"),
        "returned": len(result.get("pois") or []),
    }
    log.info(
        "search cache=%s group=%s returned=%s overpass_ms=%s total_ms=%.1f err=%s",
        result["cache"],
        g,
        len(result.get("pois") or []),
        timings.get("overpassMs"),
        total_ms,
        result.get("error"),
    )
    return result
