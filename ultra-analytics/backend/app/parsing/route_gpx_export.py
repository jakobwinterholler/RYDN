"""GPX 1.1 export for planned routes — course geometry + verified stops only.

Export never copies imported ``<wpt>`` / checkpoints from the source GPX.
The track comes from the course geometry; waypoints are rebuilt from RYDN
verified water / shop / hotel (sleep) only.

GPX ``<sym>`` has no formal enum; Garmin names are the de-facto interchange
standard and what Coros / Wahoo / Hammerhead typically map on import.

Coros choices (plain names + Garmin-compatible symbols):
- Water → name ``Water``, ``<sym>Drinking Water</sym>``, ``<type>Water</type>``
  Classic outdoors refill icon; Coros shows imported waypoints as checkpoints
  and preserves common Garmin symbols when present.
- Shop  → name ``Shop``, ``<sym>Shopping Center</sym>``, ``<type>Shop</type>``
  Markets/stores (not cafés). No universal GPX ``Store``; avoid ``Restaurant``.
- Hotel → name ``Hotel``, ``<sym>Lodging</sym>``, ``<type>Hotel</type>``
  Sleep / hotel / hostel / camping verified by the rider.
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

# Garmin-compatible waypoint symbols (see module docstring). Coros maps these
# better than free-form text; FIT course-point types are a separate format.
SYM_WATER = "Drinking Water"
SYM_SHOP = "Shopping Center"
SYM_HOTEL = "Lodging"

# Plain Coros-friendly labels — no emojis (device lists truncate / garble them).
NAME_WATER = "Water"
NAME_SHOP = "Shop"
NAME_HOTEL = "Hotel"

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


def is_export_hotel(stop: Dict[str, Any]) -> bool:
    """Verified sleep — hotel / hostel / camping / shelter."""
    cat = (stop.get("category") or "").lower()
    group = (stop.get("group") or "").lower()
    if group == "sleep":
        return True
    return any(
        x in cat
        for x in ("hotel", "hostel", "motel", "guesthouse", "guest house", "camping", "campsite", "shelter", "hut")
    )


def filter_export_waypoints(stops: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Verified water + shop + hotel/sleep only; rejects café/bike/unverified."""
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
        elif is_export_hotel(stop):
            kind = "hotel"
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


def _wpt_labels(kind: str) -> Tuple[str, str, str]:
    if kind == "water":
        return NAME_WATER, SYM_WATER, "Water"
    if kind == "hotel":
        return NAME_HOTEL, SYM_HOTEL, "Hotel"
    return NAME_SHOP, SYM_SHOP, "Shop"


def build_export_gpx(
    *,
    name: str,
    track_points: Sequence[Tuple[float, float, Optional[float]]],
    waypoints: Sequence[Dict[str, Any]],
) -> bytes:
    """Emit GPX 1.1 with ``<trk>`` + filtered verified ``<wpt>`` only (no source POIs)."""
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
        kind = str(stop.get("_exportKind") or "shop")
        label, sym, wpt_type = _wpt_labels(kind)
        wpt = _el("wpt", lat=f"{float(stop['lat']):.7f}", lon=f"{float(stop['lon']):.7f}")
        wpt.append(_el("name", label))
        wpt.append(_el("sym", sym))
        wpt.append(_el("type", wpt_type))
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
