"""Planned route GPX parser — geometry first, timestamps optional.

Unlike completed-ride GPX parsing, points without ``<time>`` are kept.
Used only for Routes (planning), never for Rides.
"""

from __future__ import annotations

import math
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, List, Optional, Tuple

from ..util.geo import haversine_m


@dataclass
class RouteTrackPoint:
    lat: float
    lon: float
    ele: Optional[float]
    t: Optional[float]  # epoch seconds when present
    distance_km: float


@dataclass
class ParsedRouteGpx:
    name: Optional[str]
    points: List[RouteTrackPoint]
    distance_km: float
    elevation_gain_m: float
    has_timestamps: bool
    point_count: int


def _parse_ele(trkpt: ET.Element) -> Optional[float]:
    for child in trkpt:
        if child.tag.endswith("ele") and child.text:
            try:
                return float(child.text)
            except ValueError:
                return None
    return None


def _parse_time(trkpt: ET.Element) -> Optional[float]:
    for child in trkpt:
        if child.tag.endswith("time") and child.text:
            raw = child.text.strip()
            if not raw:
                return None
            try:
                if raw.endswith("Z"):
                    raw = raw[:-1] + "+00:00"
                dt = datetime.fromisoformat(raw)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return dt.timestamp()
            except ValueError:
                return None
    return None


def _extract_name(root: ET.Element) -> Optional[str]:
    for el in root.iter():
        if el.tag.endswith("name") and el.text and el.text.strip():
            # Prefer metadata/trk name over waypoint noise — first track name wins
            parent = None
            return el.text.strip()
    return None


def _raw_points(root: ET.Element) -> List[Tuple[float, float, Optional[float], Optional[float]]]:
    out: List[Tuple[float, float, Optional[float], Optional[float]]] = []
    for trkpt in root.iter():
        if not trkpt.tag.endswith("trkpt") and not trkpt.tag.endswith("rtept"):
            continue
        lat_s, lon_s = trkpt.get("lat"), trkpt.get("lon")
        if lat_s is None or lon_s is None:
            continue
        try:
            lat, lon = float(lat_s), float(lon_s)
        except ValueError:
            continue
        if not math.isfinite(lat) or not math.isfinite(lon):
            continue
        out.append((lat, lon, _parse_ele(trkpt), _parse_time(trkpt)))
    return out


def _elevation_gain(raw: List[Tuple[float, float, Optional[float], Optional[float]]]) -> float:
    gain = 0.0
    for i in range(1, len(raw)):
        a, b = raw[i - 1][2], raw[i][2]
        if a is None or b is None:
            continue
        d = b - a
        if d > 0:
            gain += d
    return gain


def parse_route_gpx(path: str) -> ParsedRouteGpx:
    """Parse a planning GPX. Timestamps optional; geometry required."""
    try:
        root = ET.parse(path).getroot()
    except ET.ParseError as exc:
        raise ValueError("Invalid or empty GPX file.") from exc

    raw = _raw_points(root)
    if len(raw) < 2:
        raise ValueError("No route track found in this GPX.")

    track: List[RouteTrackPoint] = []
    cumulative = 0.0
    timed = 0
    for i, (lat, lon, ele, t) in enumerate(raw):
        if i > 0:
            pl, po = raw[i - 1][0], raw[i - 1][1]
            cumulative += haversine_m(pl, po, lat, lon) / 1000.0
        if t is not None:
            timed += 1
        track.append(RouteTrackPoint(lat=lat, lon=lon, ele=ele, t=t, distance_km=cumulative))

    name = None
    for el in root.iter():
        if el.tag.endswith("trk") or el.tag.endswith("metadata") or el.tag.endswith("rte"):
            for child in el:
                if child.tag.endswith("name") and child.text and child.text.strip():
                    name = child.text.strip()
                    break
        if name:
            break

    return ParsedRouteGpx(
        name=name,
        points=track,
        distance_km=round(cumulative, 1),
        elevation_gain_m=round(_elevation_gain(raw)),
        has_timestamps=timed >= 2,
        point_count=len(track),
    )


def downsample_latlon(points: List[RouteTrackPoint], max_points: int = 2500) -> List[List[float]]:
    """[[lat, lon], ...] for map preview — never used as a Ride sample stream."""
    track = downsample_track(points, max_points=max_points)
    return [[p[0], p[1]] for p in track]


def downsample_track(
    points: List[RouteTrackPoint], max_points: int = 8000
) -> List[List[Any]]:
    """[[lat, lon, ele|null, distance_km], ...] for planning analysis + map."""
    if not points:
        return []

    def row(p: RouteTrackPoint) -> List[Any]:
        return [p.lat, p.lon, p.ele, round(p.distance_km, 3)]

    if len(points) <= max_points:
        return [row(p) for p in points]
    step = len(points) / max_points
    out: List[List[Any]] = []
    i = 0.0
    while int(i) < len(points) and len(out) < max_points:
        out.append(row(points[int(i)]))
        i += step
    last = row(points[-1])
    if out[-1][0] != last[0] or out[-1][1] != last[1]:
        out.append(last)
    return out
