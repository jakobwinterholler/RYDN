"""Stable permanent POI identifiers shared across Desktop, Cloud, and Companion."""

from __future__ import annotations

import hashlib
import re
from typing import Any


def normalize_poi_name(value: str | None) -> str:
    """Lowercase alphanumeric name for deterministic fallback hashing."""
    if not value:
        return ""
    lowered = value.strip().lower()
    return re.sub(r"[^a-z0-9]+", "", lowered)


def compute_poi_id(
    race_id: str,
    poi: dict[str, Any] | None,
    *,
    category: str | None = None,
    distance_along_km: float | None = None,
) -> str:
    """
    Return a stable POI id like ``poi_38472``.

    Priority:
    1. OSM element id when available (stable across re-analysis)
    2. Deterministic hash of race + category + normalized name + rounded km
    """
    if not poi:
        poi = {}

    osm_id = poi.get("osm_id")
    osm_type = poi.get("osm_type")
    if osm_id is not None and osm_type:
        return f"poi_{int(osm_id)}"

    resolved_category = str(poi.get("poi_category") or category or "unknown")
    name = normalize_poi_name(
        str(poi.get("name") or poi.get("brand") or ""),
    )
    km = round(
        float(poi.get("distance_along_km") if poi.get("distance_along_km") is not None else distance_along_km or 0),
        1,
    )
    digest = hashlib.sha256(
        f"{race_id}:{resolved_category}:{name}:{km}".encode("utf-8"),
    ).hexdigest()
    numeric = (int(digest[:8], 16) % 900_000) + 10_000
    return f"poi_{numeric}"


def verified_stop_lookup_keys(
    zone_id: int | str | None,
    poi_id: str | None,
) -> list[str]:
    """Keys to try when resolving a verification record (poi_id first, then legacy zone)."""
    keys: list[str] = []
    if poi_id:
        keys.append(poi_id)
    if zone_id is not None:
        zone_key = str(zone_id)
        if zone_key not in keys:
            keys.append(zone_key)
    return keys


def resolve_verified_stop_record(
    verified_stops: dict[str, Any],
    *,
    zone_id: int | str | None,
    poi_id: str | None,
) -> tuple[dict[str, Any] | None, str | None]:
    """Return verification record and the key it was found under."""
    for key in verified_stop_lookup_keys(zone_id, poi_id):
        record = verified_stops.get(key)
        if isinstance(record, dict):
            return record, key
    return None, None


def migrate_verified_stops_to_poi_ids(
    verified_stops: dict[str, Any],
    stops: list[dict[str, Any]],
) -> dict[str, Any]:
    """
    Copy legacy zone-keyed verifications to poi_id keys when missing.

    Existing poi_id entries are never overwritten.
    """
    if not verified_stops or not stops:
        return verified_stops

    migrated = dict(verified_stops)
    zone_to_poi: dict[str, str] = {}
    for stop in stops:
        if not isinstance(stop, dict):
            continue
        poi_id = stop.get("poiId") or stop.get("poi_id")
        zone_id = stop.get("zoneId") or stop.get("zone_id")
        if poi_id and zone_id is not None:
            zone_to_poi[str(zone_id)] = str(poi_id)

    for zone_key, poi_id in zone_to_poi.items():
        legacy = migrated.get(zone_key)
        if isinstance(legacy, dict) and poi_id not in migrated:
            migrated[poi_id] = {**legacy, "poi_id": poi_id, "migrated_from_zone": zone_key}
    return migrated
