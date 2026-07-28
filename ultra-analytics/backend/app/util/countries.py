"""Infer country ISO codes from GPS points (offline).

Automatic first — riders can override on the Ultra.
Uses reverse-geocode when available; otherwise a coarse bbox fallback
for common ultra-cycling regions so detection still works without the dep.
"""

from __future__ import annotations

from typing import Iterable, List, Optional, Sequence, Tuple

from .geo import decimate_points

# Coarse boxes as last resort (lon_min, lat_min, lon_max, lat_max, ISO2).
# Order matters for overlaps — more specific regions first.
_FALLBACK_BOXES: List[Tuple[float, float, float, float, str]] = [
    (-9.6, 35.9, 3.4, 43.9, "ES"),
    (-5.2, 41.3, 9.7, 51.2, "FR"),
    (5.9, 45.8, 10.6, 47.9, "CH"),
    (6.6, 36.6, 18.6, 47.1, "IT"),
    (-9.6, 36.9, -6.1, 42.2, "PT"),
    (9.4, 46.3, 17.2, 49.1, "AT"),
    (5.8, 47.2, 15.1, 55.1, "DE"),
    (2.5, 49.4, 6.5, 51.6, "BE"),
    (3.2, 50.7, 7.3, 53.7, "NL"),
    (-10.7, 51.3, -5.3, 55.5, "IE"),
    (-8.7, 49.8, 1.9, 59.0, "GB"),
    (4.0, 57.9, 31.5, 71.3, "NO"),
    (10.9, 55.2, 24.3, 69.2, "SE"),
    (20.5, 59.7, 31.7, 70.2, "FI"),
    (7.9, 54.5, 15.3, 57.8, "DK"),
    (14.0, 49.0, 24.2, 54.9, "PL"),
    (12.0, 48.5, 18.9, 51.1, "CZ"),
    (16.8, 45.7, 22.9, 48.6, "HU"),
    (13.3, 45.4, 16.6, 46.9, "SI"),
    (13.4, 42.3, 19.5, 46.6, "HR"),
    (20.0, 34.7, 29.7, 41.8, "GR"),
    (25.6, 35.8, 45.0, 42.4, "TR"),
    (-17.3, 27.5, -0.9, 36.0, "MA"),
    (-125.0, 24.0, -66.0, 49.5, "US"),
    (-141.0, 41.5, -52.0, 83.5, "CA"),
    (-75.0, -56.0, -66.0, -17.0, "CL"),
    (-74.0, -56.0, -53.0, -21.0, "AR"),
    (112.0, -44.0, 154.0, -10.0, "AU"),
    (166.0, -48.0, 179.0, -34.0, "NZ"),
    (-25.0, 63.0, -13.0, 67.0, "IS"),
    (122.0, 24.0, 146.0, 46.0, "JP"),
]


def _fallback_country(lat: float, lon: float) -> Optional[str]:
    for lon_min, lat_min, lon_max, lat_max, code in _FALLBACK_BOXES:
        if lat_min <= lat <= lat_max and lon_min <= lon <= lon_max:
            return code
    return None


def _lookup_batch(coords: Sequence[Tuple[float, float]]) -> List[Optional[str]]:
    """Return ISO2 per coordinate. Prefer reverse-geocode; else bbox fallback."""
    if not coords:
        return []
    try:
        import reverse_geocode  # type: ignore

        rows = reverse_geocode.search(list(coords))
        out: List[Optional[str]] = []
        for row in rows:
            cc = (row or {}).get("country_code")
            out.append(str(cc).upper() if cc else None)
        return out
    except Exception:
        return [_fallback_country(lat, lon) for lat, lon in coords]


def countries_from_points(
    points: Iterable[Sequence[float]],
    *,
    max_samples: int = 64,
) -> List[str]:
    """Ordered unique ISO2 codes along a route (first appearance order)."""
    pts = [[float(p[0]), float(p[1])] for p in points if p and len(p) >= 2]
    if not pts:
        return []
    sampled = decimate_points(pts, max_samples)
    coords = [(p[0], p[1]) for p in sampled]
    codes = _lookup_batch(coords)
    ordered: List[str] = []
    for cc in codes:
        if cc and len(cc) == 2 and cc not in ordered:
            ordered.append(cc)
    return ordered
