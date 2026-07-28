"""Optional Open-Meteo forecast when planned dates are known."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Dict, List, Optional, Sequence, Tuple

import httpx

from .route_plan import point_at_km


def _parse_iso(d: Optional[str]) -> Optional[date]:
    if not d or not isinstance(d, str):
        return None
    try:
        return date.fromisoformat(d[:10])
    except ValueError:
        return None


def fetch_route_weather(
    track: Sequence[Sequence[Any]],
    *,
    date_start: Optional[str],
    date_end: Optional[str] = None,
    total_km: float = 0.0,
) -> Optional[Dict[str, Any]]:
    """Daily forecast samples along the course. Returns None if dates unknown."""
    start = _parse_iso(date_start)
    if not start:
        return None
    end = _parse_iso(date_end) or start
    if end < start:
        end = start
    # Open-Meteo forecast horizon ~16 days; clamp.
    today = date.today()
    if start > today + timedelta(days=15):
        return {
            "status": "out_of_range",
            "message": "Planned start is beyond the available forecast window.",
            "days": [],
        }
    if start < today - timedelta(days=1):
        # Historical dates — omit rather than confuse with archive API.
        return {
            "status": "past",
            "message": "Planned dates are in the past — forecast omitted.",
            "days": [],
        }

    span_days = min((end - start).days + 1, 10)
    samples: List[Tuple[float, float, float]] = []  # km, lat, lon
    if track and total_km > 0:
        for i in range(span_days):
            frac = (i + 0.5) / max(span_days, 1)
            km = total_km * frac
            ll = point_at_km(track, km)
            if ll:
                samples.append((km, ll[0], ll[1]))
    if not samples and track:
        ll = point_at_km(track, 0)
        if ll:
            samples.append((0.0, ll[0], ll[1]))
    if not samples:
        return None

    # One representative point (mid-route) keeps the call simple and respectful.
    mid = samples[len(samples) // 2]
    lat, lon = mid[1], mid[2]
    end_fetch = min(end, today + timedelta(days=15))
    url = (
        "https://api.open-meteo.com/v1/forecast"
        f"?latitude={lat:.4f}&longitude={lon:.4f}"
        f"&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max"
        f"&timezone=auto&start_date={start.isoformat()}&end_date={end_fetch.isoformat()}"
    )
    try:
        with httpx.Client(timeout=20.0) as client:
            res = client.get(url)
            res.raise_for_status()
            data = res.json()
    except Exception as exc:  # noqa: BLE001
        return {"status": "error", "message": str(exc), "days": []}

    daily = data.get("daily") or {}
    times = daily.get("time") or []
    days: List[Dict[str, Any]] = []
    for i, day in enumerate(times):
        days.append(
            {
                "date": day,
                "weatherCode": (daily.get("weathercode") or [None])[i],
                "tempMaxC": (daily.get("temperature_2m_max") or [None])[i],
                "tempMinC": (daily.get("temperature_2m_min") or [None])[i],
                "precipMm": (daily.get("precipitation_sum") or [None])[i],
                "windMaxKmh": (daily.get("windspeed_10m_max") or [None])[i],
            }
        )
    return {
        "status": "ok",
        "sampleLat": round(lat, 4),
        "sampleLon": round(lon, 4),
        "sampleKm": round(mid[0], 1),
        "days": days,
    }
