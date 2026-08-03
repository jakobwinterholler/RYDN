"""Planned Routes — separate from completed Rides.

Routes are planning objects (imported GPX courses). They must never appear in
the Ride Library, Ultra membership, analytics totals, or achievements.
"""

from __future__ import annotations

import json
import os
import shutil
import time
import uuid
from typing import Any, Callable, Dict, List, Optional

from .analysis.route_analysis import analyze_planned_route
from .analysis.route_elevation import ensure_analysis_track, track_has_elevation
from .parsing.route_gpx import downsample_latlon, downsample_track, parse_route_gpx
from .paths import users_dir

_USERS_DIR = users_dir()
PREPARATION_DEFAULTS = {
    "routeUnderstood": False,
    "stopsVerified": False,
    "keyClimbsReviewed": False,
    "stagesPlanned": False,
    "notes": "",
}

REVIEW_STATUSES = ("verified", "rejected", "skipped", "unreviewed")



def _routes_dir(uid: str) -> str:
    return os.path.join(_USERS_DIR, uid, "routes")


def _path(uid: str, route_id: str) -> str:
    return os.path.join(_routes_dir(uid), f"{route_id}.json")


def _gpx_path(uid: str, route_id: str) -> str:
    return os.path.join(_routes_dir(uid), f"{route_id}.gpx")


def _analysis_path(uid: str, route_id: str) -> str:
    return os.path.join(_routes_dir(uid), f"{route_id}.analysis.json")


def _merge_saved_into_analysis(
    uid: str, route_id: str, saved: Dict[str, dict]
) -> None:
    """Ensure verified search finds stay in recommendedStops across reloads."""
    cache = _analysis_path(uid, route_id)
    if not os.path.isfile(cache) or not saved:
        return
    try:
        with open(cache, "r", encoding="utf-8") as f:
            analysis = json.load(f)
    except (OSError, json.JSONDecodeError, TypeError):
        return
    stops = list(analysis.get("recommendedStops") or [])
    by_id = {str(s.get("id")): s for s in stops if isinstance(s, dict) and s.get("id")}
    for sid, snap in saved.items():
        if not isinstance(snap, dict):
            continue
        existing = by_id.get(str(sid))
        if existing:
            existing["reviewStatus"] = "verified"
            for k in ("resupplyScore", "services", "qualityStars", "qualityLabel"):
                if snap.get(k) is not None:
                    existing[k] = snap[k]
        else:
            stops.append({**snap, "reviewStatus": "verified", "id": str(sid)})
            by_id[str(sid)] = stops[-1]
    analysis["recommendedStops"] = stops
    verified = sum(1 for s in stops if isinstance(s, dict) and s.get("reviewStatus") == "verified")
    summary = dict(analysis.get("summary") or {})
    summary["verifiedStopCount"] = verified
    summary["recommendedStopCount"] = sum(
        1 for s in stops if isinstance(s, dict) and s.get("reviewStatus") != "rejected"
    )
    analysis["summary"] = summary
    try:
        tmp = f"{cache}.tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(analysis, f)
        os.replace(tmp, cache)
    except OSError:
        pass


def _patch_analysis_reviews(uid: str, route_id: str, reviews: Dict[str, str]) -> None:
    """Apply stop review statuses to the cached analysis without re-running POI/climb work.

    Verify should feel instant — deleting the cache forced a full re-analysis on the
    next GET and made every Verify click wait on heavy work.
    """
    cache = _analysis_path(uid, route_id)
    if not os.path.isfile(cache):
        return
    try:
        with open(cache, "r", encoding="utf-8") as f:
            analysis = json.load(f)
    except (OSError, json.JSONDecodeError, TypeError):
        return

    analysis["stopReviews"] = dict(reviews)
    stops = list(analysis.get("recommendedStops") or [])
    for stop in stops:
        if not isinstance(stop, dict):
            continue
        sid = stop.get("id")
        if sid is None:
            continue
        stop["reviewStatus"] = reviews.get(str(sid)) or "unreviewed"
    analysis["recommendedStops"] = stops

    verified = sum(1 for s in stops if isinstance(s, dict) and s.get("reviewStatus") == "verified")
    summary = dict(analysis.get("summary") or {})
    summary["verifiedStopCount"] = verified
    summary["recommendedStopCount"] = sum(
        1 for s in stops if isinstance(s, dict) and s.get("reviewStatus") != "rejected"
    )
    analysis["summary"] = summary

    try:
        tmp = f"{cache}.tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(analysis, f)
        os.replace(tmp, cache)
    except OSError:
        pass


def _ensure_dir(uid: str) -> None:
    os.makedirs(_routes_dir(uid), exist_ok=True)


def _verified_resupply_counts(uid: str, route: dict) -> Dict[str, int]:
    """Water / shop verified counts for Planning shelf (work already done)."""
    from .parsing.route_gpx_export import (
        is_export_shop,
        is_export_water,
        merge_verified_stops,
    )

    recommended: List[dict] = []
    cache = _analysis_path(uid, str(route.get("id") or ""))
    if os.path.isfile(cache):
        try:
            with open(cache, "r", encoding="utf-8") as f:
                analysis = json.load(f)
            recommended = [
                s
                for s in (analysis.get("recommendedStops") or [])
                if isinstance(s, dict)
            ]
        except (OSError, json.JSONDecodeError, TypeError):
            recommended = []

    merged = merge_verified_stops(
        recommended,
        route.get("savedStops") or {},
        route.get("stopReviews") or {},
    )
    water = sum(1 for s in merged if is_export_water(s))
    shop = sum(1 for s in merged if is_export_shop(s))
    return {
        "water": water,
        "shop": shop,
        "total": len(merged),
    }


def _summary(route: dict, uid: Optional[str] = None) -> dict:
    prep = route.get("preparation") or {}
    checks = ["routeUnderstood", "stopsVerified", "keyClimbsReviewed", "stagesPlanned"]
    done = sum(1 for k in checks if prep.get(k))
    verified = (
        _verified_resupply_counts(uid, route)
        if uid
        else {"water": 0, "shop": 0, "total": 0}
    )
    return {
        "id": route["id"],
        "createdAt": route.get("createdAt"),
        "updatedAt": route.get("updatedAt"),
        "name": route.get("name") or "Untitled route",
        "sourceFilename": route.get("sourceFilename"),
        "distanceKm": route.get("distanceKm") or 0,
        "elevationGainM": route.get("elevationGainM") or 0,
        "pointCount": route.get("pointCount") or 0,
        "hasTimestamps": bool(route.get("hasTimestamps")),
        "status": route.get("status") or "planning",
        "dateStart": route.get("dateStart"),
        "dateEnd": route.get("dateEnd"),
        "verificationProgress": {"done": done, "total": len(checks)},
        "verifiedCounts": verified,
        "objectType": "route",
        "hasAnalysis": bool(route.get("hasAnalysis")),
        "proUnlock": route.get("proUnlock") if isinstance(route.get("proUnlock"), dict) else None,
    }


def list_routes(uid: str) -> List[dict]:
    d = _routes_dir(uid)
    if not os.path.isdir(d):
        return []
    out: List[dict] = []
    for fname in os.listdir(d):
        if not fname.endswith(".json") or fname.endswith(".analysis.json"):
            continue
        try:
            with open(os.path.join(d, fname), "r", encoding="utf-8") as f:
                route = json.load(f)
            out.append(_summary(route, uid=uid))
        except (OSError, json.JSONDecodeError):
            continue
    out.sort(key=lambda r: r.get("updatedAt") or r.get("createdAt") or 0, reverse=True)
    return out


def get_route(uid: str, route_id: str) -> Optional[dict]:
    path = _path(uid, route_id)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def set_pro_unlock(uid: str, route_id: str, unlock: Dict[str, Any]) -> Optional[dict]:
    """Attach a Race Pass (or similar) unlock to one planned route."""
    route = get_route(uid, route_id)
    if not route:
        return None
    route["proUnlock"] = dict(unlock)
    return _save(uid, route)


def _save(uid: str, route: dict) -> dict:
    _ensure_dir(uid)
    route["updatedAt"] = time.time()
    path = _path(uid, route["id"])
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(route, f)
    os.replace(tmp, path)
    return route


def create_route_from_gpx(
    uid: str,
    *,
    gpx_path: str,
    filename: str,
    name: Optional[str] = None,
    on_progress: Optional[Callable] = None,
) -> dict:
    def _progress(stage: str, label: str, pct: int, stats: Optional[Dict[str, Any]] = None) -> None:
        if on_progress:
            on_progress(stage, label, pct, stats)

    _progress("parsing", "Parsing GPX", 8, None)
    parsed = parse_route_gpx(gpx_path)
    now = time.time()
    stem = os.path.splitext(filename or "route")[0].replace("_", " ").replace("-", " ").strip()
    route_id = uuid.uuid4().hex[:12]
    track = downsample_track(parsed.points)
    stats = {
        "distanceKm": round(float(parsed.distance_km or 0), 1),
        "elevationGainM": int(parsed.elevation_gain_m or 0),
        "pointCount": int(parsed.point_count or 0),
    }
    _progress(
        "parsed",
        f"Parsing {stats['pointCount']:,} GPX points",
        16,
        stats,
    )
    route = {
        "id": route_id,
        "createdAt": now,
        "updatedAt": now,
        "objectType": "route",
        "name": (name or parsed.name or stem or "Untitled route").strip(),
        "sourceFilename": filename,
        "distanceKm": parsed.distance_km,
        "elevationGainM": parsed.elevation_gain_m,
        "pointCount": parsed.point_count,
        "hasTimestamps": parsed.has_timestamps,
        "status": "planning",
        "dateStart": None,
        "dateEnd": None,
        "points": downsample_latlon(parsed.points),
        "track": track,
        "preparation": dict(PREPARATION_DEFAULTS),
        "stopReviews": {},
        "hasAnalysis": False,
    }
    _ensure_dir(uid)
    try:
        shutil.copyfile(gpx_path, _gpx_path(uid, route_id))
    except OSError:
        pass
    _progress("saving", "Saving route", 22, stats)
    _save(uid, route)
    # Eager local analysis (climbs/stages); POIs may hit Overpass.
    try:
        get_route_analysis(uid, route_id, force=True, on_progress=on_progress)
    except Exception:
        pass
    _progress("done", "Almost ready…", 98, stats)
    return _summary(get_route(uid, route_id) or route, uid=uid)


def update_route(uid: str, route_id: str, patch: Dict[str, Any]) -> Optional[dict]:
    route = get_route(uid, route_id)
    if not route:
        return None
    if "name" in patch and isinstance(patch["name"], str):
        route["name"] = patch["name"].strip() or route["name"]
    if "status" in patch and patch["status"] in ("planning", "ready", "archived"):
        route["status"] = patch["status"]
    for key in ("dateStart", "dateEnd"):
        if key in patch:
            val = patch[key]
            route[key] = str(val)[:10] if val else None
    if "preparation" in patch and isinstance(patch["preparation"], dict):
        prep = dict(route.get("preparation") or PREPARATION_DEFAULTS)
        for key, default in PREPARATION_DEFAULTS.items():
            if key not in patch["preparation"]:
                continue
            val = patch["preparation"][key]
            if key == "notes":
                prep[key] = str(val or "")[:4000]
            else:
                prep[key] = bool(val)
        route["preparation"] = prep
        checks = ["routeUnderstood", "stopsVerified", "keyClimbsReviewed", "stagesPlanned"]
        if all(prep.get(k) for k in checks) and route.get("status") == "planning":
            route["status"] = "ready"
    if "stopReviews" in patch and isinstance(patch["stopReviews"], dict):
        reviews = dict(route.get("stopReviews") or {})
        for sid, status in patch["stopReviews"].items():
            key = str(sid)[:64]
            if status in (None, "", "unreviewed"):
                reviews.pop(key, None)
            elif status in REVIEW_STATUSES:
                reviews[key] = status
        route["stopReviews"] = reviews
        # Lightweight: patch review fields on cached analysis instead of wiping it
        # (full re-analysis was the main reason Verify felt frozen).
        _patch_analysis_reviews(uid, route_id, reviews)
    if "savedStops" in patch and isinstance(patch["savedStops"], dict):
        # Permanent verified stop snapshots (esp. area-* search finds).
        saved = dict(route.get("savedStops") or {})
        for sid, snap in patch["savedStops"].items():
            key = str(sid)[:64]
            if snap is None:
                saved.pop(key, None)
                continue
            if not isinstance(snap, dict):
                continue
            lat, lon = snap.get("lat"), snap.get("lon")
            if lat is None or lon is None:
                continue
            osm_type = str(snap.get("osmType") or "node")[:24]
            saved[key] = {
                "id": key,
                "osmId": snap.get("osmId"),
                "osmType": osm_type,
                "name": snap.get("name"),
                "category": snap.get("category") or "Stop",
                "group": snap.get("group") or "resupply",
                "lat": float(lat),
                "lon": float(lon),
                "distanceAlongKm": float(snap.get("distanceAlongKm") or 0),
                "distanceOffRouteM": int(snap.get("distanceOffRouteM") or 0),
                "openingHours": snap.get("openingHours"),
                "website": snap.get("website"),
                "phone": snap.get("phone"),
                "hotelStars": snap.get("hotelStars"),
                "is24h": bool(snap.get("is24h")),
                "hasShop": snap.get("hasShop"),
                "qualityStars": int(snap.get("qualityStars") or 4),
                "qualityLabel": snap.get("qualityLabel") or "Verified",
                "qualityScore": snap.get("qualityScore"),
                "resupplyScore": snap.get("resupplyScore"),
                "services": list(snap.get("services") or [])[:8],
                "reviewStatus": "verified",
                "googleMapsUrl": snap.get("googleMapsUrl"),
            }
        route["savedStops"] = saved
        _merge_saved_into_analysis(uid, route_id, saved)
    if "notes" in patch:
        prep = dict(route.get("preparation") or PREPARATION_DEFAULTS)
        prep["notes"] = str(patch["notes"] or "")[:4000]
        route["preparation"] = prep
    _save(uid, route)
    return get_route_detail(uid, route_id)


def get_route_detail(uid: str, route_id: str) -> Optional[dict]:
    route = get_route(uid, route_id)
    if not route:
        return None
    return {
        **_summary(route, uid=uid),
        "points": route.get("points") or [],
        "preparation": route.get("preparation") or dict(PREPARATION_DEFAULTS),
        "stopReviews": route.get("stopReviews") or {},
        "savedStops": route.get("savedStops") or {},
        "dateStart": route.get("dateStart"),
        "dateEnd": route.get("dateEnd"),
    }


def get_route_analysis(
    uid: str,
    route_id: str,
    *,
    force: bool = False,
    target_stage_km: float = 250.0,
    on_progress: Optional[Callable] = None,
) -> Optional[dict]:
    route = get_route(uid, route_id)
    if not route:
        return None
    cache = _analysis_path(uid, route_id)

    # Stale/empty climb caches on high-elevation courses must be recomputed.
    if not force and os.path.isfile(cache):
        try:
            with open(cache, "r", encoding="utf-8") as f:
                cached = json.load(f)
            elev = int(route.get("elevationGainM") or 0)
            climbs = int((cached.get("summary") or {}).get("climbCount") or 0)
            schema_ok = cached.get("schemaVersion", 0) >= 2
            target_ok = abs(float(cached.get("targetStageKm") or 250) - float(target_stage_km)) < 0.5
            suspicious = elev >= 800 and climbs == 0
            if target_ok and schema_ok and not suspicious:
                saved = route.get("savedStops") or {}
                if saved:
                    _merge_saved_into_analysis(uid, route_id, saved)
                    try:
                        with open(cache, "r", encoding="utf-8") as f:
                            return json.load(f)
                    except (OSError, json.JSONDecodeError, TypeError):
                        pass
                return cached
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            pass

    # Legacy routes without track / without elevation: rebuild from GPX or DEM.
    if not route.get("track"):
        gpx = _gpx_path(uid, route_id)
        if os.path.isfile(gpx):
            parsed = parse_route_gpx(gpx)
            route["track"] = downsample_track(parsed.points)
            route["points"] = downsample_latlon(parsed.points)
            route["distanceKm"] = parsed.distance_km
            route["elevationGainM"] = parsed.elevation_gain_m
            _save(uid, route)

    if on_progress:
        on_progress("elevation", "Preparing elevation profile", 24, {
            "distanceKm": round(float(route.get("distanceKm") or 0), 1),
            "elevationGainM": int(route.get("elevationGainM") or 0),
            "pointCount": int(route.get("pointCount") or 0),
        })
    route, heal_meta = ensure_analysis_track(route)
    if heal_meta.get("healed"):
        _save(uid, route)

    analysis = analyze_planned_route(
        route,
        force_refresh=force,
        target_stage_km=target_stage_km,
        on_progress=on_progress,
    )
    analysis["schemaVersion"] = 2
    analysis["elevationSource"] = heal_meta.get("source") or (
        "gpx" if track_has_elevation(route.get("track") or []) else "none"
    )
    if heal_meta.get("source") == "dem":
        analysis["insights"] = [
            "Elevation healed from terrain data (original GPX elev was missing) — climbs estimated from DEM.",
            *list(analysis.get("insights") or []),
        ]
    if on_progress:
        on_progress("saving_analysis", "Saving planning data", 96, analysis.get("summary"))
    try:
        with open(cache, "w", encoding="utf-8") as f:
            json.dump(analysis, f)
        route["hasAnalysis"] = True
        _save(uid, route)
    except OSError:
        pass
    return analysis


def export_route_gpx(uid: str, route_id: str) -> Optional[tuple]:
    """Build GPX 1.1: course track only + verified water/shop/hotel waypoints.

    Never re-emits imported source POIs/checkpoints — track from geometry,
    waypoints rebuilt from RYDN verified stops. Returns ``(filename, gpx_bytes)``
    or ``None`` if the route is missing.
    """
    from .parsing.route_gpx_export import (
        build_export_gpx,
        export_filename,
        filter_export_waypoints,
        merge_verified_stops,
        track_points_from_parsed,
        track_points_from_route,
    )

    route = get_route(uid, route_id)
    if not route:
        return None

    track_pts = track_points_from_route(route)
    gpx_path = _gpx_path(uid, route_id)
    if os.path.isfile(gpx_path):
        try:
            parsed = parse_route_gpx(gpx_path)
            from_file = track_points_from_parsed(parsed.points)
            if len(from_file) >= 2:
                track_pts = from_file
        except Exception:
            pass

    recommended: List[dict] = []
    cache = _analysis_path(uid, route_id)
    if os.path.isfile(cache):
        try:
            with open(cache, "r", encoding="utf-8") as f:
                analysis = json.load(f)
            recommended = list(analysis.get("recommendedStops") or [])
        except (OSError, json.JSONDecodeError, TypeError):
            recommended = []

    merged = merge_verified_stops(
        recommended,
        route.get("savedStops") or {},
        route.get("stopReviews") or {},
    )
    waypoints = filter_export_waypoints(merged)
    name = str(route.get("name") or "Route")
    body = build_export_gpx(name=name, track_points=track_pts, waypoints=waypoints)
    return export_filename(name), body


def delete_route(uid: str, route_id: str) -> bool:
    path = _path(uid, route_id)
    if not os.path.isfile(path):
        return False
    try:
        os.unlink(path)
        for extra in (_gpx_path(uid, route_id), _analysis_path(uid, route_id)):
            if os.path.isfile(extra):
                os.unlink(extra)
        return True
    except OSError:
        return False
