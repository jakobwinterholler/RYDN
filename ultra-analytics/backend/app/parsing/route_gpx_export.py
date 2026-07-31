"""GPX 1.1 export for planned routes — course geometry + verified water/shop waypoints.

GPX ``<sym>`` has no formal enum; Garmin names are the de-facto interchange standard
and the ones most bike computers (Garmin, Coros, Wahoo, Hammerhead, Polar) map when
importing waypoints.

Choices (prefer proximity-alert-capable icons without custom device config):
- Water → ``Drinking Water`` — classic Garmin outdoors symbol; widely listed
  (BaseCamp/Montana custom-symbol tables, plotaroute GPX support) and commonly
  preserved through Connect / Edge imports.
- Shop  → ``Shopping Center`` — classic Garmin POI symbol for markets/stores.
  There is no universal GPX ``Store`` / ``Supermarket``; FIT course-point type
  ``store`` is a separate format. Avoid ``Restaurant`` (dining) for food shops.
"""

from __future__ import annotations

import math
import re
import xml.etree.ElementTree as ET
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple
from xml.dom import minidom

GPX_NS = "http://www.topografix.com/GPX/1/1"
GPX_XSI = "http://www.w3.org/2001/XMLSchema-instance"
GPX_SCHEMA_LOC = (
    "http://www.topografix.com/GPX/1/1 "
    "http://www.topografix.com/GPX/1/1/gpx.xsd"
)

# Garmin-compatible waypoint symbols (see module docstring).
SYM_WATER = "Drinking Water"
SYM_SHOP = "Shopping Center"

NAME_WATER = "💧"
NAME_SHOP = "🛒"

ET.register_namespace("", GPX_NS)
ET.register_namespace("xsi", GPX_XSI)


def is_export_water(stop: Dict[str, Any]) -> bool:
    cat = (stop.get("category") or "").lower()
    group = (stop.get("group") or "").lower()
    return group == "water" or "water" in cat or "drinking" in cat


def is_export_shop(stop: Dict[str, Any]) -> bool:
    """Markets / food shops only — not fuel, sleep, cafés, or bike shops."""
    cat = (stop.get("category") or "").lower()
    group = (stop.get("group") or "").lower()
    if group in ("sleep", "dining", "service", "water"):
        return False
    blocked = (
        "gas",
        "fuel",
        "24h",
        "hotel",
        "hostel",
        "camp",
        "shelter",
        "hut",
        "café",
        "cafe",
        "restaurant",
        "fast food",
        "bike",
        "pharmacy",
    )
    if any(x in cat for x in blocked):
        return False
    if any(x in cat for x in ("supermarket", "convenience", "bakery", "grocery", "market")):
        return True
    return group == "resupply"


def filter_export_waypoints(stops: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Verified water + shop only; rejects sleep/café/bike/unverified."""
    out: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for stop in stops:
        if not isinstance(stop, dict):
            continue
        if (stop.get("reviewStatus") or "") != "verified":
            continue
        lat, lon = stop.get("lat"), stop.get("lon")
        try:
            lat_f, lon_f = float(lat), float(lon)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(lat_f) or not math.isfinite(lon_f):
            continue
        kind: Optional[str] = None
        if is_export_water(stop):
            kind = "water"
        elif is_export_shop(stop):
            kind = "shop"
        if kind is None:
            continue
        sid = str(stop.get("id") or f"{lat_f:.6f},{lon_f:.6f}")
        if sid in seen:
            continue
        seen.add(sid)
        item = dict(stop)
        item["lat"] = lat_f
        item["lon"] = lon_f
        item["_exportKind"] = kind
        out.append(item)
    out.sort(key=lambda s: float(s.get("distanceAlongKm") or 0))
    return out


def merge_verified_stops(
    recommended: Sequence[Dict[str, Any]],
    saved: Dict[str, Any],
    reviews: Optional[Dict[str, str]] = None,
) -> List[Dict[str, Any]]:
    """Mirror frontend mergeVerifiedStops + stopReviews for export."""
    by_id: Dict[str, Dict[str, Any]] = {}
    reviews = reviews or {}
    for stop in recommended:
        if not isinstance(stop, dict) or not stop.get("id"):
            continue
        sid = str(stop["id"])
        status = reviews.get(sid) or stop.get("reviewStatus") or "unreviewed"
        if status != "verified":
            continue
        by_id[sid] = {**stop, "reviewStatus": "verified", "id": sid}
    for sid, snap in (saved or {}).items():
        if not isinstance(snap, dict):
            continue
        key = str(sid)
        by_id[key] = {**snap, "reviewStatus": "verified", "id": key}
    return list(by_id.values())


def _el(tag: str, text: Optional[str] = None, **attrs: str) -> ET.Element:
    el = ET.Element(f"{{{GPX_NS}}}{tag}", {k: v for k, v in attrs.items() if v is not None})
    if text is not None:
        el.text = text
    return el


def _safe_filename(name: str) -> str:
    stem = re.sub(r"[^\w\-]+", "_", (name or "route").strip(), flags=re.UNICODE)
    stem = stem.strip("_")[:80] or "route"
    return f"{stem}.gpx"


def build_export_gpx(
    *,
    name: str,
    track_points: Sequence[Tuple[float, float, Optional[float]]],
    waypoints: Sequence[Dict[str, Any]],
) -> bytes:
    """Emit standards-compliant GPX 1.1 with ``<trk>`` + filtered ``<wpt>``."""
    root = ET.Element(
        f"{{{GPX_NS}}}gpx",
        {
            "version": "1.1",
            "creator": "RYDN",
            f"{{{GPX_XSI}}}schemaLocation": GPX_SCHEMA_LOC,
        },
    )
    meta = _el("metadata")
    meta.append(_el("name", name))
    root.append(meta)

    for stop in waypoints:
        kind = stop.get("_exportKind")
        wpt = _el("wpt", lat=f"{float(stop['lat']):.7f}", lon=f"{float(stop['lon']):.7f}")
        if kind == "water":
            wpt.append(_el("name", NAME_WATER))
            wpt.append(_el("sym", SYM_WATER))
            wpt.append(_el("type", "Water"))
        else:
            wpt.append(_el("name", NAME_SHOP))
            wpt.append(_el("sym", SYM_SHOP))
            wpt.append(_el("type", "Shop"))
        # Optional human hint for apps that ignore emoji names; keep <name> emoji-only.
        cat = stop.get("category")
        if cat:
            wpt.append(_el("desc", str(cat)))
        root.append(wpt)

    if track_points:
        trk = _el("trk")
        trk.append(_el("name", name))
        seg = _el("trkseg")
        for lat, lon, ele in track_points:
            if not math.isfinite(lat) or not math.isfinite(lon):
                continue
            pt = _el("trkpt", lat=f"{lat:.7f}", lon=f"{lon:.7f}")
            if ele is not None and math.isfinite(float(ele)):
                pt.append(_el("ele", f"{float(ele):.1f}"))
            seg.append(pt)
        trk.append(seg)
        root.append(trk)

    rough = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    try:
        pretty = minidom.parseString(rough).toprettyxml(indent="  ", encoding="utf-8")
        # minidom adds an extra XML declaration line we already have via encoding=
        return pretty
    except Exception:
        return rough


def track_points_from_parsed(points: Sequence[Any]) -> List[Tuple[float, float, Optional[float]]]:
    out: List[Tuple[float, float, Optional[float]]] = []
    for p in points:
        lat = getattr(p, "lat", None)
        lon = getattr(p, "lon", None)
        ele = getattr(p, "ele", None)
        if lat is None or lon is None:
            continue
        out.append((float(lat), float(lon), float(ele) if ele is not None else None))
    return out


def track_points_from_route(route: Dict[str, Any]) -> List[Tuple[float, float, Optional[float]]]:
    """Fall back to stored track / map points when original GPX is missing."""
    out: List[Tuple[float, float, Optional[float]]] = []
    for p in route.get("track") or []:
        if not isinstance(p, (list, tuple)) or len(p) < 2:
            continue
        try:
            lat, lon = float(p[0]), float(p[1])
        except (TypeError, ValueError):
            continue
        ele = None
        if len(p) >= 3 and p[2] is not None:
            try:
                ele = float(p[2])
            except (TypeError, ValueError):
                ele = None
        out.append((lat, lon, ele))
    if out:
        return out
    for p in route.get("points") or []:
        if not isinstance(p, (list, tuple)) or len(p) < 2:
            continue
        try:
            out.append((float(p[0]), float(p[1]), None))
        except (TypeError, ValueError):
            continue
    return out


def export_filename(route_name: str) -> str:
    return _safe_filename(route_name)
