"""Corridor POI index for Planning Search-this-area.

Architecture (Option A):
  On route import/analysis → preload primary POIs along a ~2–5 km corridor,
  persist projected results, spatially filter the visible viewport on search.

Search never hits Overpass when the viewport intersects the cached corridor.
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from typing import Any, Dict, List, Optional, Sequence, Tuple

from ..util.geo import haversine_m

# Configurable corridor half-width (meters). Default 3 km.
def corridor_pad_m() -> float:
    raw = (os.environ.get("RYDN_POI_CORRIDOR_M") or "").strip()
    try:
        v = float(raw) if raw else 3000.0
    except ValueError:
        v = 3000.0
    return max(500.0, min(8000.0, v))


CACHE_SCHEMA = 2


def _cache_root() -> str:
    from ..paths import cache_dir

    d = cache_dir("route_pois")
    os.makedirs(d, exist_ok=True)
    return d


def track_fingerprint(track: Sequence[Sequence[Any]]) -> str:
    if len(track) < 2:
        return "empty"
    a, mid, b = track[0], track[len(track) // 2], track[-1]
    dist = float(b[3]) if len(b) > 3 else 0.0
    blob = (
        f"{len(track)}:{float(a[0]):.4f},{float(a[1]):.4f}:"
        f"{float(mid[0]):.4f},{float(mid[1]):.4f}:"
        f"{float(b[0]):.4f},{float(b[1]):.4f}:{dist:.2f}"
    )
    return hashlib.sha1(blob.encode()).hexdigest()[:16]


def _cache_path(fingerprint: str) -> str:
    return os.path.join(_cache_root(), f"{fingerprint}.json")


def corridor_bbox(
    track: Sequence[Sequence[Any]], pad_m: float
) -> Tuple[float, float, float, float]:
    """BBox around the track with approximate degree pad from meters."""
    lats = [float(r[0]) for r in track if len(r) >= 2]
    lons = [float(r[1]) for r in track if len(r) >= 2]
    if not lats:
        return (0.0, 0.0, 0.0, 0.0)
    mid_lat = (min(lats) + max(lats)) / 2.0
    # 1° lat ≈ 111_320 m; lon shrinks by cos(lat)
    pad_lat = pad_m / 111_320.0
    cos_lat = max(0.2, abs(__import__("math").cos(__import__("math").radians(mid_lat))))
    pad_lon = pad_m / (111_320.0 * cos_lat)
    return (
        min(lats) - pad_lat,
        min(lons) - pad_lon,
        max(lats) + pad_lat,
        max(lons) + pad_lon,
    )


def bbox_intersects(
    a: Tuple[float, float, float, float],
    b: Tuple[float, float, float, float],
) -> bool:
    as_, aw, an, ae = a
    bs, bw, bn, be = b
    return not (an < bs or bn < as_ or ae < bw or be < aw)


def load_corridor_cache(fingerprint: str) -> Optional[Dict[str, Any]]:
    path = _cache_path(fingerprint)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if int(data.get("schema") or 0) < CACHE_SCHEMA:
            return None
        if not isinstance(data.get("pois"), list):
            return None
        return data
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        return None


def save_corridor_cache(data: Dict[str, Any]) -> str:
    fp = data["fingerprint"]
    path = _cache_path(fp)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"))
    os.replace(tmp, path)
    return path


# Process-local hot cache — repeated Search-this-area must be sub-ms after warm.
_MEMORY: Dict[str, Dict[str, Any]] = {}


def get_memory_corridor(fingerprint: str) -> Optional[Dict[str, Any]]:
    return _MEMORY.get(fingerprint)


def put_memory_corridor(data: Dict[str, Any]) -> None:
    fp = data.get("fingerprint")
    if fp:
        _MEMORY[fp] = data


class GridIndex:
    """Pragmatic degree-grid spatial index (no extra deps)."""

    def __init__(self, pois: Sequence[Dict[str, Any]], cell_deg: float = 0.05):
        self.cell = max(0.01, cell_deg)
        self.cells: Dict[Tuple[int, int], List[int]] = {}
        self.pois = list(pois)
        for i, p in enumerate(self.pois):
            try:
                lat, lon = float(p["lat"]), float(p["lon"])
            except (KeyError, TypeError, ValueError):
                continue
            key = (int(lat / self.cell), int(lon / self.cell))
            self.cells.setdefault(key, []).append(i)

    def query_bbox(
        self, south: float, west: float, north: float, east: float
    ) -> List[Dict[str, Any]]:
        if not self.pois:
            return []
        i0 = int(south / self.cell) - 1
        i1 = int(north / self.cell) + 1
        j0 = int(west / self.cell) - 1
        j1 = int(east / self.cell) + 1
        out: List[Dict[str, Any]] = []
        seen: set[int] = set()
        for i in range(i0, i1 + 1):
            for j in range(j0, j1 + 1):
                for idx in self.cells.get((i, j), ()):
                    if idx in seen:
                        continue
                    seen.add(idx)
                    p = self.pois[idx]
                    lat, lon = float(p["lat"]), float(p["lon"])
                    if south <= lat <= north and west <= lon <= east:
                        out.append(p)
        return out


def build_grid(pois: Sequence[Dict[str, Any]]) -> GridIndex:
    return GridIndex(pois)


def filter_group(pois: Sequence[Dict[str, Any]], group: str) -> List[Dict[str, Any]]:
    """Apply Search QA group filters (water / markets / sleep).

    Markets = snacks / small grocery (supermarket, convenience, bakery).
    Hours are checked on the stop sheet — no separate 24h QA.
    """
    g = (group or "all").strip().lower()
    out: List[Dict[str, Any]] = []
    for p in pois:
        cat = p.get("category") or ""
        grp = p.get("group") or ""
        if g == "water":
            if grp != "water":
                continue
        elif g == "resupply":
            # Snacks-friendly markets only — not fuel / 24h shops.
            if cat not in ("Supermarket", "Convenience", "Bakery"):
                continue
        elif g == "fuel":
            # Legacy group — kept for API compat; Planning QA no longer exposes it.
            if cat not in ("24h Shop", "Fuel shop"):
                continue
        elif g == "sleep":
            if grp != "sleep":
                continue
        elif g in ("dining", "service"):
            continue
        # Drop secondary / bare pumps always from Search
        if cat in (
            "Pharmacy",
            "Bike shop",
            "Café",
            "Restaurant",
            "Fast food",
            "Gas station",
            "24h Shop",
            "Fuel shop",
        ):
            # Allow fuel group to keep 24h/Fuel shop when explicitly requested.
            if g == "fuel" and cat in ("24h Shop", "Fuel shop"):
                pass
            else:
                continue
        out.append(p)
    return out


def query_viewport(
    corridor: Dict[str, Any],
    *,
    south: float,
    west: float,
    north: float,
    east: float,
    group: str = "all",
    limit: int = 15,
    exclude_ids: Optional[Sequence[str]] = None,
) -> Dict[str, Any]:
    """Filter cached corridor POIs to viewport + rank. No network."""
    from .route_stops import rank_candidates

    t0 = time.perf_counter()
    pois: List[Dict[str, Any]] = corridor.get("pois") or []

    # Prefer prebuilt grid when present on memory object
    grid: Optional[GridIndex] = corridor.get("_grid")  # type: ignore[assignment]
    t_grid = time.perf_counter()
    if grid is None:
        grid = build_grid(pois)
        corridor["_grid"] = grid  # type: ignore[index]
    t_grid_ms = (time.perf_counter() - t_grid) * 1000.0

    t_f = time.perf_counter()
    in_view = grid.query_bbox(south, west, north, east)
    grouped = filter_group(in_view, group)
    # Ensure Search ids are area-* form for temp workspace
    for p in grouped:
        if not str(p.get("id") or "").startswith("area-"):
            osm_type = p.get("osmType") or "node"
            osm_id = p.get("osmId") or 0
            p["id"] = f"area-{osm_type}-{osm_id}"
            if not p.get("googleMapsUrl"):
                p["googleMapsUrl"] = (
                    f"https://www.google.com/maps/search/?api=1&query={p['lat']},{p['lon']}"
                )
    t_filter_ms = (time.perf_counter() - t_f) * 1000.0

    # Soft limit by span (same as legacy viewport)
    span = max(north - south, abs(east - west))
    if span > 1.2:
        limit = min(limit, 5)
    elif span > 0.55:
        limit = min(limit, 8)
    elif span > 0.22:
        limit = min(limit, 12)

    t_r = time.perf_counter()
    batch, has_more = rank_candidates(grouped, exclude_ids=exclude_ids, limit=limit)
    t_rank_ms = (time.perf_counter() - t_r) * 1000.0
    total_ms = (time.perf_counter() - t0) * 1000.0

    return {
        "pois": batch,
        "cache": "corridor-hit",
        "error": None,
        "truncated": False,
        "hasMore": has_more,
        "batchSize": limit,
        "candidateCount": len(grouped),
        "excludedCount": len(exclude_ids or []),
        "corridorPois": len(pois),
        "timings": {
            "totalMs": round(total_ms, 2),
            "serverMs": round(total_ms, 2),
            "cacheLookupMs": 0.0,
            "gridMs": round(t_grid_ms, 3),
            "spatialFilterMs": round(t_filter_ms, 3),
            "rankMs": round(t_rank_ms, 3),
            "overpassMs": None,
            "projectMs": None,
        },
        "stats": {
            "corridorPois": len(pois),
            "inView": len(in_view),
            "candidates": len(grouped),
            "returned": len(batch),
            "cache": "corridor-hit",
        },
    }


def merge_pois_into_corridor(
    corridor: Dict[str, Any], new_pois: Sequence[Dict[str, Any]]
) -> Dict[str, Any]:
    """Union new projected POIs into corridor cache (viewport outside fill)."""
    by_key: Dict[Tuple[str, int], Dict[str, Any]] = {}
    for p in corridor.get("pois") or []:
        key = (str(p.get("osmType") or "node"), int(p.get("osmId") or 0))
        by_key[key] = p
    for p in new_pois:
        key = (str(p.get("osmType") or "node"), int(p.get("osmId") or 0))
        by_key[key] = p
    merged = list(by_key.values())
    corridor = {**corridor, "pois": merged}
    corridor.pop("_grid", None)
    return corridor


def nearest_off_route_m(
    lat: float, lon: float, track: Sequence[Sequence[Any]], sample_step: int = 4
) -> Tuple[float, float]:
    """Return (distance_along_km, off_route_m) — coarse then refine."""
    best_d = float("inf")
    best_km = 0.0
    best_i = 0
    n = len(track)
    step = max(1, sample_step)
    for i in range(0, n, step):
        row = track[i]
        if len(row) < 2:
            continue
        d = haversine_m(lat, lon, float(row[0]), float(row[1]))
        if d < best_d:
            best_d = d
            best_km = float(row[3]) if len(row) > 3 else 0.0
            best_i = i
    # Refine neighbourhood
    for i in range(max(0, best_i - step * 2), min(n, best_i + step * 2 + 1)):
        row = track[i]
        if len(row) < 2:
            continue
        d = haversine_m(lat, lon, float(row[0]), float(row[1]))
        if d < best_d:
            best_d = d
            best_km = float(row[3]) if len(row) > 3 else 0.0
    return best_km, best_d
