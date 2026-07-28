"""Heal route elevation when GPX track is missing or elev-less."""

from __future__ import annotations

import hashlib
import json
import os
import time
from typing import Any, Dict, List, Optional, Sequence, Tuple

import httpx

from ..util.geo import haversine_m

_OPEN_METEO = "https://api.open-meteo.com/v1/elevation"
_OPEN_TOPO = "https://api.opentopodata.org/v1/srtm30m"
_BATCH = 40
_CACHE_DIR = None  # resolved lazily


def _elev_cache_dir() -> str:
    global _CACHE_DIR
    if _CACHE_DIR is None:
        from ..paths import cache_dir

        _CACHE_DIR = cache_dir("elevation")
    return _CACHE_DIR


def _cache_path(coords: List[Tuple[float, float]]) -> str:
    os.makedirs(_elev_cache_dir(), exist_ok=True)
    key = hashlib.sha1(
        ";".join(f"{a:.4f},{b:.4f}" for a, b in coords).encode()
    ).hexdigest()[:20]
    return os.path.join(_elev_cache_dir(), f"{key}.json")


def _finite_ele(v: Any) -> Optional[float]:
    if isinstance(v, (int, float)):
        return float(v)
    return None


def track_has_elevation(track: Sequence[Sequence[Any]]) -> bool:
    n = 0
    for row in track:
        if len(row) > 2 and _finite_ele(row[2]) is not None:
            n += 1
            if n >= 8:
                return True
    return False


def points_to_track(points: Sequence[Sequence[Any]]) -> List[List[Any]]:
    out: List[List[Any]] = []
    km = 0.0
    prev: Optional[Tuple[float, float]] = None
    for row in points:
        if len(row) < 2:
            continue
        lat, lon = float(row[0]), float(row[1])
        ele = _finite_ele(row[2]) if len(row) > 2 else None
        if prev is not None:
            km += haversine_m(prev[0], prev[1], lat, lon) / 1000.0
        out.append([lat, lon, ele, round(km, 3)])
        prev = (lat, lon)
    return out


def _fetch_open_meteo(coords: List[Tuple[float, float]]) -> Optional[List[Optional[float]]]:
    lats = ",".join(f"{c[0]:.5f}" for c in coords)
    lons = ",".join(f"{c[1]:.5f}" for c in coords)
    with httpx.Client(timeout=60.0) as client:
        for attempt in range(4):
            res = client.get(_OPEN_METEO, params={"latitude": lats, "longitude": lons})
            data = res.json() if res.status_code == 200 else {}
            if data.get("error") or res.status_code in (429, 503):
                time.sleep(2.5 * (attempt + 1))
                continue
            res.raise_for_status()
            elev = data.get("elevation")
            if not isinstance(elev, list) or len(elev) != len(coords):
                return None
            return [float(v) if isinstance(v, (int, float)) else None for v in elev]
    return None


def _fetch_opentopo(coords: List[Tuple[float, float]]) -> Optional[List[Optional[float]]]:
    # OpenTopoData free tier: max 100 locations per request.
    locs = "|".join(f"{c[0]:.5f},{c[1]:.5f}" for c in coords)
    with httpx.Client(timeout=60.0) as client:
        for attempt in range(4):
            res = client.get(_OPEN_TOPO, params={"locations": locs})
            if res.status_code in (429, 503):
                time.sleep(2.5 * (attempt + 1))
                continue
            if res.status_code != 200:
                return None
            data = res.json() or {}
            results = data.get("results") or []
            if len(results) != len(coords):
                return None
            out: List[Optional[float]] = []
            for row in results:
                v = row.get("elevation") if isinstance(row, dict) else None
                out.append(float(v) if isinstance(v, (int, float)) else None)
            return out
    return None


def _fetch_elev_batch(coords: List[Tuple[float, float]]) -> List[Optional[float]]:
    if not coords:
        return []
    path = _cache_path(coords)
    if os.path.isfile(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                cached = json.load(f)
            if isinstance(cached, list) and len(cached) == len(coords):
                return cached
        except (OSError, json.JSONDecodeError):
            pass

    elev: Optional[List[Optional[float]]] = None
    try:
        elev = _fetch_open_meteo(coords)
    except Exception:
        elev = None
    if elev is None or sum(1 for v in elev if v is not None) < max(1, len(coords) // 2):
        time.sleep(1.0)
        try:
            elev = _fetch_opentopo(coords)
        except Exception:
            elev = None
    if elev is None:
        return [None] * len(coords)

    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(elev, f)
    except OSError:
        pass
    return elev


def enrich_track_elevation(
    track: List[List[Any]], *, sample_step: int = 2, force: bool = False
) -> Tuple[List[List[Any]], Dict[str, Any]]:
    """Fill missing elevation via DEM. Returns (track, meta)."""
    if not track:
        return track, {"source": "empty", "filled": 0}
    if track_has_elevation(track) and not force:
        return track, {"source": "gpx", "filled": 0}

    idxs = list(range(0, len(track), max(1, sample_step)))
    if idxs[-1] != len(track) - 1:
        idxs.append(len(track) - 1)

    samples: List[Tuple[int, Optional[float]]] = []
    for i in range(0, len(idxs), _BATCH):
        chunk_idxs = idxs[i : i + _BATCH]
        coords = [(float(track[j][0]), float(track[j][1])) for j in chunk_idxs]
        elevs = _fetch_elev_batch(coords)
        for j, e in zip(chunk_idxs, elevs):
            samples.append((j, e))
        time.sleep(0.35)  # respect free DEM rate limits

    known = [(i, e) for i, e in samples if e is not None]
    if len(known) < 4:
        return track, {"source": "dem_failed", "filled": 0}

    known.sort(key=lambda t: t[0])
    filled = 0
    k = 0
    for i in range(len(track)):
        while k + 1 < len(known) and known[k + 1][0] < i:
            k += 1
        if known[k][0] == i:
            ele = known[k][1]
        elif k + 1 < len(known):
            i0, e0 = known[k]
            i1, e1 = known[k + 1]
            t = 0.0 if i1 == i0 else (i - i0) / (i1 - i0)
            ele = e0 + (e1 - e0) * t
        else:
            ele = known[k][1]
        row = list(track[i])
        while len(row) < 4:
            row.append(0.0 if len(row) == 3 else None)
        if ele is not None:
            row[2] = round(float(ele), 1)
            filled += 1
        track[i] = row

    gain = 0.0
    prev = None
    for row in track:
        e = _finite_ele(row[2]) if len(row) > 2 else None
        if e is None:
            continue
        if prev is not None and e > prev:
            gain += e - prev
        prev = e

    return track, {"source": "dem", "filled": filled, "elevationGainM": round(gain)}


def _track_elev_stats(track: Sequence[Sequence[Any]]) -> Dict[str, float]:
    eles = [_finite_ele(r[2]) for r in track if len(r) > 2]
    eles = [e for e in eles if e is not None]
    if not eles:
        return {"min": 0.0, "max": 0.0, "range": 0.0, "gain": 0.0, "count": 0}
    gain = 0.0
    prev = None
    for e in eles:
        if prev is not None and e > prev:
            gain += e - prev
        prev = e
    return {
        "min": min(eles),
        "max": max(eles),
        "range": max(eles) - min(eles),
        "gain": gain,
        "count": len(eles),
    }


def ensure_analysis_track(route: dict) -> Tuple[dict, Dict[str, Any]]:
    """Ensure route has a distance+elevation track suitable for climb detection."""
    meta: Dict[str, Any] = {"healed": False, "source": "none"}
    track = list(route.get("track") or [])
    points = route.get("points") or []
    claimed_gain = float(route.get("elevationGainM") or 0)

    if not track and len(points) >= 2:
        track = points_to_track(points)
        route["track"] = track
        meta["healed"] = True
        meta["builtFrom"] = "points"

    if not track:
        return route, meta

    stats = _track_elev_stats(track)
    expected = float(route.get("distanceKm") or 0)
    last_km = float(track[-1][3]) if len(track[-1]) > 3 else 0.0
    if points and expected > 0 and (last_km < expected * 0.4 or last_km > expected * 1.6):
        track = points_to_track(points)
        stats = _track_elev_stats(track)
        meta["healed"] = True

    needs_dem = not track_has_elevation(track)
    if track_has_elevation(track) and claimed_gain >= 1500:
        if stats["range"] < 800 or stats["gain"] < claimed_gain * 0.2:
            needs_dem = True
            meta["reason"] = "suspicious_elevation_profile"

    if needs_dem:
        base = points_to_track(points) if points and len(points) >= 2 else track
        healed, elev_meta = enrich_track_elevation(list(base), force=True)
        if elev_meta.get("source") == "dem" and track_has_elevation(healed):
            route["track"] = healed
            meta.update(elev_meta)
            meta["healed"] = True
        else:
            # Keep existing elev if DEM fails (rate limits / offline).
            meta.update(elev_meta)
            meta["demFailed"] = True
            if track_has_elevation(track):
                route["track"] = track
                meta["source"] = "previous"
    elif track_has_elevation(track):
        meta["source"] = "gpx"

    return route, meta
