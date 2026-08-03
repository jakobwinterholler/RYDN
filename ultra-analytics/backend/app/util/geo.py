"""Small geospatial and numeric helpers.

Kept dependency-free so the analysis core stays portable (the same math will
later run inside Roadbook/Companion services).
"""

from __future__ import annotations

import math
from typing import Iterable, List, Optional, Sequence

EARTH_RADIUS_M = 6_371_000.0


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two lat/lon points in metres."""
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(a)))


def local_hour(epoch_s: float, lon: Optional[float]) -> float:
    """Approximate local hour-of-day (0..24) from a UTC timestamp.

    We have no timezone database in Phase 1, so we approximate the offset from
    longitude (15 degrees per hour). This is more than accurate enough to tell
    day from night, which is what stop classification needs.
    """
    utc_hour = (epoch_s / 3600.0) % 24.0
    offset = (lon / 15.0) if lon is not None else 0.0
    return (utc_hour + offset) % 24.0


def is_night(epoch_s: float, lon: Optional[float]) -> bool:
    h = local_hour(epoch_s, lon)
    return h >= 22.0 or h < 6.0


def moving_average(values: Sequence[Optional[float]], window: int) -> List[Optional[float]]:
    """Centered moving average that skips ``None`` values."""
    n = len(values)
    if n == 0 or window <= 1:
        return list(values)
    half = window // 2
    out: List[Optional[float]] = [None] * n
    for i in range(n):
        acc = 0.0
        count = 0
        for j in range(max(0, i - half), min(n, i + half + 1)):
            v = values[j]
            if v is not None:
                acc += v
                count += 1
        out[i] = (acc / count) if count else None
    return out


def clean_numeric(values: Iterable[Optional[float]]) -> List[float]:
    return [float(v) for v in values if v is not None and not math.isnan(float(v))]


def percentile(sorted_values: Sequence[float], pct: float) -> float:
    if not sorted_values:
        return 0.0
    if pct <= 0:
        return sorted_values[0]
    if pct >= 100:
        return sorted_values[-1]
    k = (len(sorted_values) - 1) * (pct / 100.0)
    lo = math.floor(k)
    hi = math.ceil(k)
    if lo == hi:
        return sorted_values[int(k)]
    return sorted_values[lo] * (hi - k) + sorted_values[hi] * (k - lo)


def decimate(values: Sequence[float], target: int) -> List[float]:
    """Reduce a series to ~``target`` points for transport, keeping shape."""
    n = len(values)
    if n <= target or target <= 0:
        return list(values)
    step = n / target
    out: List[float] = []
    i = 0.0
    while i < n:
        out.append(values[int(i)])
        i += step
    if out and out[-1] != values[-1]:
        out.append(values[-1])
    return out


def decimate_points(points: Sequence[Sequence[float]], target: int) -> List[List[float]]:
    """Downsample a polyline to ~``target`` [lat, lon] points."""
    n = len(points)
    if n <= target or target <= 0:
        return [[float(p[0]), float(p[1])] for p in points if len(p) >= 2]
    step = n / target
    out: List[List[float]] = []
    i = 0.0
    while i < n:
        p = points[int(i)]
        out.append([float(p[0]), float(p[1])])
        i += step
    last = points[-1]
    if out and (out[-1][0] != float(last[0]) or out[-1][1] != float(last[1])):
        out.append([float(last[0]), float(last[1])])
    return out


def decode_polyline(encoded: str, precision: int = 5) -> List[List[float]]:
    """Decode a Google/Mapbox encoded polyline into [lat, lon] pairs."""
    if not encoded:
        return []
    coords: List[List[float]] = []
    index = 0
    lat = 0
    lon = 0
    factor = 10**precision
    length = len(encoded)
    while index < length:
        result = 0
        shift = 0
        while True:
            b = ord(encoded[index]) - 63
            index += 1
            result |= (b & 0x1F) << shift
            shift += 5
            if b < 0x20:
                break
        dlat = ~(result >> 1) if result & 1 else (result >> 1)
        lat += dlat

        result = 0
        shift = 0
        while True:
            b = ord(encoded[index]) - 63
            index += 1
            result |= (b & 0x1F) << shift
            shift += 5
            if b < 0x20:
                break
        dlon = ~(result >> 1) if result & 1 else (result >> 1)
        lon += dlon
        coords.append([lat / factor, lon / factor])
    return coords
