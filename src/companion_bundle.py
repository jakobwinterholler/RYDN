"""Build Companion offline bundles from roadbook analysis."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from bundle_checksum import compute_bundle_checksum
from bundle_contract import CURRENT_SCHEMA_VERSION, apply_bundle_version_fields
from poi_id import compute_poi_id, migrate_verified_stops_to_poi_ids, resolve_verified_stop_record
from race_dashboard import compute_race_dashboard_stats
from resupply_intelligence import build_resupply_reason, planning_score
from significant_climbs import significant_climbs
from suggested_stops import resolve_planning_zones
from unsupported_sections import analyze_unsupported_sections

COMPANION_SCHEMA_VERSION = CURRENT_SCHEMA_VERSION

POI_ICONS: dict[str, str] = {
    "water": "💧",
    "food": "🍽",
    "fuel": "⛽",
    "supermarket": "🛒",
    "convenience": "🏪",
    "restaurant": "🍽",
    "cafe": "☕",
    "café": "☕",
    "bakery": "🥐",
}

DEFAULT_RIDER_ASSUMPTIONS = {
    "ridingSpeedKmh": 20,
    "climbingPenaltyMinPer100m": 3,
    "waterMlPerHour": 500,
    "carbsGPerHour": 60,
    "maxGapWithoutResupplyKm": 45,
}


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _zone_has_category(zone: dict[str, Any], key: str) -> bool:
    for group in zone.get("categories") or []:
        if group.get("key") == key and group.get("primary"):
            return True
    return False


def _is_coffee_category(category: str) -> bool:
    lowered = category.lower()
    return "cafe" in lowered or "coffee" in lowered or lowered == "café"


def _primary_poi(zone: dict[str, Any]) -> dict[str, Any] | None:
    """Select the single best primary POI across all categories in a zone."""
    ranked = _rank_zone_pois(zone)
    return ranked[0] if ranked else None


def _rank_zone_pois(
    zone: dict[str, Any],
    *,
    climbs: list[dict[str, Any]] | None = None,
    unsupported_sections: list[dict[str, Any]] | None = None,
) -> list[tuple[dict[str, Any], str, str]]:
    """Flatten and rank all POIs in a zone. Returns (poi, category_key, category_label)."""
    seen: set[str] = set()
    items: list[tuple[dict[str, Any], str, str]] = []
    zone_km = float(zone.get("distance_along_km") or 0)
    for group in zone.get("categories") or []:
        category_key = str(group.get("key") or "")
        category_label = str(group.get("label") or category_key)
        for option in [group.get("primary"), *(group.get("alternatives") or [])]:
            if not isinstance(option, dict):
                continue
            osm_key = f"{option.get('osm_type')}-{option.get('osm_id')}"
            if osm_key in seen:
                continue
            seen.add(osm_key)
            items.append((option, category_key, category_label))
    peer_kms = [
        float(poi.get("distance_along_km") or zone_km)
        for poi, _, _ in items
    ]
    items.sort(
        key=lambda entry: planning_score(
            entry[0],
            category_key=entry[1],
            zone_km=zone_km,
            climbs=climbs,
            unsupported_sections=unsupported_sections,
            peer_kms=peer_kms,
        ),
        reverse=True,
    )
    return items


def _suggested_stops_by_zone(roadbook: dict[str, Any]) -> dict[int, dict[str, Any]]:
    mapping: dict[int, dict[str, Any]] = {}
    for stop in roadbook.get("suggested_stops") or []:
        if not isinstance(stop, dict):
            continue
        zone_id = int(stop.get("zone_id") or 0)
        if zone_id:
            mapping[zone_id] = stop
    return mapping


def _find_poi_in_zone(
    zone: dict[str, Any],
    osm_id: int,
    osm_type: str,
) -> tuple[dict[str, Any], str, str] | None:
    for group in zone.get("categories") or []:
        category_key = str(group.get("key") or "")
        category_label = str(group.get("label") or category_key)
        for option in [group.get("primary"), *(group.get("alternatives") or [])]:
            if not isinstance(option, dict):
                continue
            if int(option.get("osm_id") or 0) == osm_id and str(option.get("osm_type") or "") == osm_type:
                return option, category_key, category_label
    return None


def _find_poi_in_roadbook(
    roadbook: dict[str, Any],
    osm_id: int,
    osm_type: str,
) -> dict[str, Any] | None:
    for poi in roadbook.get("pois") or []:
        if not isinstance(poi, dict):
            continue
        if int(poi.get("osm_id") or 0) == osm_id and str(poi.get("osm_type") or "") == osm_type:
            return poi
    return None


def _poi_from_suggested_stop(suggested: dict[str, Any]) -> dict[str, Any]:
    return {
        "osm_id": int(suggested.get("osm_id") or 0),
        "osm_type": str(suggested.get("osm_type") or "node"),
        "name": suggested.get("name"),
        "poi_category": suggested.get("poi_category"),
        "distance_along_km": suggested.get("distance_along_km"),
        "distance_off_route_m": suggested.get("distance_off_route_m"),
        "lat": suggested.get("lat"),
        "lon": suggested.get("lon"),
        "score": suggested.get("score"),
        "opening_hours": suggested.get("opening_hours"),
        "brand": suggested.get("brand"),
        "phone": suggested.get("phone"),
        "website": suggested.get("website"),
    }


def _resolve_zone_primary(
    zone: dict[str, Any],
    roadbook: dict[str, Any],
    suggested_stop: dict[str, Any] | None,
    *,
    climbs: list[dict[str, Any]] | None = None,
    unsupported_sections: list[dict[str, Any]] | None = None,
) -> tuple[dict[str, Any] | None, str, str]:
    if suggested_stop:
        osm_id = int(suggested_stop.get("osm_id") or 0)
        osm_type = str(suggested_stop.get("osm_type") or "node")
        if osm_id:
            matched = _find_poi_in_zone(zone, osm_id, osm_type)
            if matched:
                return matched
            roadbook_poi = _find_poi_in_roadbook(roadbook, osm_id, osm_type)
            if roadbook_poi:
                category_key = str(suggested_stop.get("category_key") or "food")
                category_label = str(suggested_stop.get("category_label") or category_key)
                return roadbook_poi, category_key, category_label
            return (
                _poi_from_suggested_stop(suggested_stop),
                str(suggested_stop.get("category_key") or "food"),
                str(suggested_stop.get("category_label") or "Resupply"),
            )

    ranked = _rank_zone_pois(
        zone,
        climbs=climbs,
        unsupported_sections=unsupported_sections,
    )
    if ranked:
        return ranked[0][0], ranked[0][1], ranked[0][2]
    return None, "", "Resupply"


def _alternative_payload(
    poi: dict[str, Any],
    category_key: str,
    category_label: str,
    verified_stops: dict[str, Any],
    zone_id: int | str,
    race_id: str,
) -> dict[str, Any]:
    category = str(poi.get("poi_category") or category_label)
    poi_id = compute_poi_id(race_id, poi, category=category)
    record, _ = resolve_verified_stop_record(
        verified_stops,
        zone_id=zone_id,
        poi_id=poi_id,
    )
    return {
        "poiId": poi_id,
        "osmId": poi.get("osm_id"),
        "osmType": poi.get("osm_type"),
        "name": _format_poi_name(poi, {"name": f"KM {zone_id}"}),
        "category": category,
        "categoryLabel": category_label,
        "icon": _poi_icon(category),
        "distanceOffRouteM": poi.get("distance_off_route_m"),
        "distanceAlongKm": poi.get("distance_along_km"),
        "score": poi.get("score"),
        "confidenceScore": poi.get("score"),
        "verificationStatus": _verification_status(record),
        "openingHours": poi.get("opening_hours"),
        "lat": poi.get("lat"),
        "lon": poi.get("lon"),
        "phone": poi.get("phone"),
        "website": poi.get("website"),
        "placeId": _poi_place_id(poi),
        "hasFood": category_key == "food" or "supermarket" in category.lower(),
        "hasWater": category_key == "water" or "water" in category.lower(),
        "hasFuel": category_key == "fuel" or "gas" in category.lower(),
    }


def _category_label(zone: dict[str, Any]) -> str:
    labels = [
        group.get("label", "")
        for group in (zone.get("categories") or [])
        if group.get("primary")
    ]
    return " · ".join(label for label in labels if label) or "Resupply"


def _format_poi_name(poi: dict[str, Any] | None, zone: dict[str, Any]) -> str:
    if not poi:
        return str(zone.get("name") or "Resupply")
    name = str(poi.get("name") or "").strip()
    brand = str(poi.get("brand") or "").strip()
    if name and brand and brand.lower() not in name.lower():
        return f"{brand} {name}".strip()
    return name or brand or str(zone.get("name") or "Resupply")


def _poi_icon(category: str) -> str:
    lowered = category.lower()
    if "supermarket" in lowered:
        return "🛒"
    if "convenience" in lowered:
        return "🏪"
    if "cafe" in lowered or "café" in lowered or "coffee" in lowered:
        return "☕"
    if "restaurant" in lowered:
        return "🍽"
    if "water" in lowered or "drinking" in lowered:
        return "💧"
    if "fuel" in lowered or "gas" in lowered:
        return "⛽"
    for key, icon in POI_ICONS.items():
        if key in lowered:
            return icon
    return "📍"


def _is_google_place_id(value: str) -> bool:
    value = value.strip()
    return len(value) >= 10 and value.startswith(("ChI", "GhI", "EhI"))


def _poi_place_id(poi: dict[str, Any] | None) -> str | None:
    if not poi:
        return None
    direct = poi.get("place_id") or poi.get("placeId")
    if isinstance(direct, str) and _is_google_place_id(direct):
        return direct.strip()
    tags = poi.get("tags") or {}
    if isinstance(tags, dict):
        for key in ("place_id", "google_place_id", "google:place_id"):
            value = tags.get(key)
            if isinstance(value, str) and _is_google_place_id(value):
                return value.strip()
    return None


def _climb_name(climb: dict[str, Any], index: int) -> str:
    for key in ("nickname", "suggested_name"):
        value = climb.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    climb_id = str(climb.get("id") or "").strip()
    if climb_id:
        return f"Climb {climb_id.replace('C', '')}"
    return f"Climb {index + 1}"


def _build_climbs(roadbook: dict[str, Any]) -> list[dict[str, Any]]:
    climbs: list[dict[str, Any]] = []
    for index, climb in enumerate(significant_climbs(roadbook.get("climbs") or [])):
        if not isinstance(climb, dict):
            continue
        climbs.append(
            {
                "id": str(climb.get("id") or f"climb-{index + 1}"),
                "name": _climb_name(climb, index),
                "startKm": climb.get("start_km"),
                "endKm": climb.get("end_km"),
                "lengthKm": climb.get("length_km"),
                "elevationGainM": climb.get("elevation_gain_m"),
                "avgGradientPct": climb.get("avg_gradient_pct"),
                "max50mPct": climb.get("max_50_m_pct"),
                "max100mPct": climb.get("max_100_m_pct"),
                "max250mPct": climb.get("max_250_m_pct"),
                "max500mPct": climb.get("max_500_m_pct"),
                "max1000mPct": climb.get("max_1000_m_pct"),
            }
        )
    return climbs


def _verified_stop_key(zone_id: int | str) -> str:
    return str(zone_id)


def _verification_status(record: dict[str, Any] | None) -> str:
    if not record:
        return "unverified"
    status = record.get("status")
    if status == "verified":
        return "verified"
    if status in ("rejected", "deferred"):
        return "needs_review"
    return "unverified"


def _elevation_gain_in_range(track_points: list[dict[str, Any]], start_km: float, end_km: float) -> int:
    in_range = [
        point
        for point in track_points
        if start_km <= float(point.get("km") or 0) <= end_km
    ]
    if len(in_range) < 2:
        return int(max(0, (end_km - start_km) * 8))
    gain = 0.0
    for index in range(1, len(in_range)):
        previous = in_range[index - 1].get("ele_m")
        current = in_range[index].get("ele_m")
        if previous is not None and current is not None and current > previous:
            gain += float(current) - float(previous)
    return int(round(gain))


def _estimate_riding_hours(distance_km: float, elevation_gain_m: float, assumptions: dict[str, float]) -> float:
    base = distance_km / assumptions["ridingSpeedKmh"]
    climb = (elevation_gain_m / 100) * (assumptions["climbingPenaltyMinPer100m"] / 60)
    return base + climb


def _unsupported_risk_band(distance_km: float, elevation_gain_m: float, assumptions: dict[str, float]) -> str:
    gap_factor = distance_km / assumptions["maxGapWithoutResupplyKm"]
    climb_factor = elevation_gain_m / 1500
    score = gap_factor * 0.7 + climb_factor * 0.3
    if score >= 1.4:
        return "High"
    if score >= 0.85:
        return "Medium"
    return "Low"


DISCOVERY_CATEGORIES = frozenset(
    {
        "Gas station",
        "Small supermarket",
        "Mini supermarket",
        "Drinking water",
        "Convenience store",
        "Supermarket",
        "Café",
        "Restaurant",
    }
)


def _is_excluded_mountain_hut(tags: dict[str, Any]) -> bool:
    tourism = str(tags.get("tourism") or "").lower()
    if tourism not in {"alpine_hut", "wilderness_hut", "hostel"}:
        return False
    amenity = str(tags.get("amenity") or "").lower()
    return amenity not in {"restaurant", "cafe", "fast_food"}


def _is_public_dining(tags: dict[str, Any]) -> bool:
    access = str(tags.get("access") or "").lower()
    if access in {"private", "no"}:
        return False
    return not _is_excluded_mountain_hut(tags)


def _is_discoverable_category(category: str, tags: dict[str, Any] | None) -> bool:
    if category not in DISCOVERY_CATEGORIES:
        return False
    tag_map = tags if isinstance(tags, dict) else {}
    if _is_excluded_mountain_hut(tag_map):
        return False
    if category in {"Restaurant", "Café"}:
        return _is_public_dining(tag_map)
    return True


def _discover_poi_payload(poi: dict[str, Any]) -> dict[str, Any] | None:
    category = str(poi.get("category") or poi.get("poi_category") or "")
    tags = poi.get("tags") if isinstance(poi.get("tags"), dict) else {}
    if not _is_discoverable_category(category, tags):
        return None
    osm_id = poi.get("osm_id")
    osm_type = poi.get("osm_type")
    if osm_id is None or not osm_type:
        return None
    return {
        "osmId": int(osm_id),
        "osmType": str(osm_type),
        "name": poi.get("name"),
        "category": category,
        "priority": int(poi.get("priority") or 2),
        "lat": float(poi.get("lat") or 0),
        "lon": float(poi.get("lon") or 0),
        "distanceAlongKm": float(poi.get("distance_along_km") or 0),
        "distanceOffRouteM": float(poi.get("distance_off_route_m") or 0),
        "score": float(poi.get("score") or 0),
        "zoneId": poi.get("zone_id"),
        "openingHours": poi.get("opening_hours"),
        "brand": poi.get("brand"),
        "tags": tags or None,
    }


def _build_discover_pois(roadbook: dict[str, Any]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    discover: list[dict[str, Any]] = []
    for poi in roadbook.get("pois") or []:
        if not isinstance(poi, dict):
            continue
        payload = _discover_poi_payload(poi)
        if not payload:
            continue
        key = f"{payload['osmType']}-{payload['osmId']}"
        if key in seen:
            continue
        seen.add(key)
        discover.append(payload)
    return discover


def _build_bounds(track_points: list[dict[str, Any]]) -> dict[str, float]:
    if not track_points:
        return {"south": 0, "west": 0, "north": 0, "east": 0}
    lats = [float(point["lat"]) for point in track_points]
    lons = [float(point["lon"]) for point in track_points]
    south, north = min(lats), max(lats)
    west, east = min(lons), max(lons)
    lat_pad = max(0.01, (north - south) * 0.08)
    lon_pad = max(0.01, (east - west) * 0.08)
    return {
        "south": south - lat_pad,
        "north": north + lat_pad,
        "west": west - lon_pad,
        "east": east + lon_pad,
    }


def build_companion_bundle(
    race_id: str,
    roadbook: dict[str, Any],
    preparation: dict[str, Any],
    *,
    revision: int,
    rider_assumptions: dict[str, float] | None = None,
) -> dict[str, Any]:
    summary = roadbook.get("summary") or {}
    route = roadbook.get("route") or {}
    track_points = route.get("track_points") or []
    zones = resolve_planning_zones(roadbook)
    all_zones = roadbook.get("resupply_zones") or []
    verified_stops = (preparation or {}).get("verified_stops") or {}
    total_km = float(summary.get("distance_km") or 0)
    assumptions = {**DEFAULT_RIDER_ASSUMPTIONS, **(rider_assumptions or {})}

    raw_sections = analyze_unsupported_sections(all_zones, total_km)
    climb_candidates = roadbook.get("climbs") or []
    significant = significant_climbs(climb_candidates)
    suggested_by_zone = _suggested_stops_by_zone(roadbook)

    stops: list[dict[str, Any]] = []
    for zone in zones:
        zone_id = zone.get("zone_id")
        poi, primary_key, poi_category_label = _resolve_zone_primary(
            zone,
            roadbook,
            suggested_by_zone.get(int(zone_id or 0)),
            climbs=significant,
            unsupported_sections=raw_sections,
        )
        ranked = _rank_zone_pois(
            zone,
            climbs=significant,
            unsupported_sections=raw_sections,
        )
        category = str((poi or {}).get("poi_category") or poi_category_label or "Resupply")
        poi_lat = (poi or {}).get("lat")
        poi_lon = (poi or {}).get("lon")
        stop_lat = float(poi_lat if poi_lat is not None else zone.get("lat") or 0)
        stop_lon = float(poi_lon if poi_lon is not None else zone.get("lon") or 0)
        record, _ = resolve_verified_stop_record(
            verified_stops,
            zone_id=zone_id,
            poi_id=compute_poi_id(race_id, poi, category=category) if poi else None,
        )
        status = _verification_status(record if isinstance(record, dict) else None)
        notes = str((record or {}).get("reject_notes") or (record or {}).get("rejectNotes") or "").strip() or None
        primary_osm_id = int((poi or {}).get("osm_id") or 0)
        primary_osm_type = str((poi or {}).get("osm_type") or "")
        alt_ranked = [
            entry
            for entry in ranked
            if not (
                primary_osm_id
                and int(entry[0].get("osm_id") or 0) == primary_osm_id
                and str(entry[0].get("osm_type") or "") == primary_osm_type
            )
        ]
        alternatives = [
            _alternative_payload(alt_poi, alt_key, alt_label, verified_stops, zone_id, race_id)
            for alt_poi, alt_key, alt_label in alt_ranked[:6]
        ]
        nearby_alternatives = alternatives
        zone_km = float(zone.get("distance_along_km") or 0)
        poi_id = compute_poi_id(race_id, poi, category=category, distance_along_km=zone_km) if poi else compute_poi_id(
            race_id,
            {"poi_category": category, "distance_along_km": zone_km},
            category=category,
            distance_along_km=zone_km,
        )
        resupply_reason = (
            build_resupply_reason(
                poi,
                category_key=primary_key,
                zone_km=zone_km,
                climbs=significant,
                unsupported_sections=raw_sections,
                peer_pois=[entry[0] for entry in ranked],
            )
            if poi
            else None
        )
        stops.append(
            {
                "poiId": poi_id,
                "zoneId": zone_id,
                "osmId": (poi or {}).get("osm_id"),
                "osmType": (poi or {}).get("osm_type"),
                "km": float((poi or {}).get("distance_along_km") or zone.get("distance_along_km") or 0),
                "lat": stop_lat,
                "lon": stop_lon,
                "name": _format_poi_name(poi, zone),
                "category": category,
                "categoryLabel": _category_label(zone),
                "icon": _poi_icon(category),
                "distanceOffRouteM": (poi or {}).get("distance_off_route_m"),
                "verificationStatus": status,
                "openingHours": (poi or {}).get("opening_hours"),
                "notes": notes,
                "phone": (poi or {}).get("phone"),
                "website": (poi or {}).get("website"),
                "hasFood": _zone_has_category(zone, "food"),
                "hasWater": _zone_has_category(zone, "water"),
                "hasFuel": _zone_has_category(zone, "fuel"),
                "hasCoffee": _is_coffee_category(category),
                "confidenceScore": (poi or {}).get("score"),
                "verificationDate": (record or {}).get("updated_at") if status == "verified" else None,
                "placeId": _poi_place_id(poi),
                "alternatives": alternatives,
                "nearbyAlternatives": nearby_alternatives,
                "resupplyReason": resupply_reason,
            }
        )

    stops.sort(key=lambda stop: float(stop.get("km") or 0))
    unsupported: list[dict[str, Any]] = []
    for section in raw_sections:
        start_km = float(section["startKm"])
        end_km = float(section["endKm"])
        distance = float(section["distanceKm"])
        elevation_gain = _elevation_gain_in_range(track_points, start_km, end_km)
        riding_hours = _estimate_riding_hours(distance, elevation_gain, assumptions)
        unsupported.append(
            {
                **section,
                "elevationGainM": elevation_gain,
                "estimatedRidingHours": round(riding_hours, 2),
                "waterNeededMl": int(round(riding_hours * assumptions["waterMlPerHour"])),
                "carbsNeededG": int(round(riding_hours * assumptions["carbsGPerHour"])),
                "riskBand": _unsupported_risk_band(distance, elevation_gain, assumptions),
            }
        )

    dashboard = compute_race_dashboard_stats(roadbook, preparation, max_gap_km=assumptions["maxGapWithoutResupplyKm"])
    dashboard_stats = {
        "verifiedStops": dashboard["verified_stops"],
        "unverifiedStops": dashboard["unverified_stops"],
        "remainingStops": dashboard["unverified_stops"],
        "remainingUnsupportedKm": int(
            round(
                sum(
                    section["distanceKm"]
                    for section in unsupported
                    if section["distanceKm"] >= assumptions["maxGapWithoutResupplyKm"] * 0.5
                )
            )
        ),
        "readinessScore": dashboard["readiness_score"],
        "readinessReasons": dashboard["readiness_reasons"],
    }

    elevation_samples = [
        float(point["ele_m"]) if point.get("ele_m") is not None else None
        for point in track_points
    ]
    route_payload: dict[str, Any] = {
        "coordinates": [
            [float(point["lon"]), float(point["lat"])] for point in track_points
        ],
        "bounds": _build_bounds(track_points),
    }
    if any(value is not None for value in elevation_samples):
        route_payload["elevationsM"] = [
            value if value is not None else 0.0 for value in elevation_samples
        ]

    generated_at = _utc_now()
    bundle: dict[str, Any] = apply_bundle_version_fields({
        "schemaVersion": COMPANION_SCHEMA_VERSION,
        "revision": revision,
        "bundle_version": revision,
        "generatedAt": generated_at,
        "syncedAt": generated_at,
        "exportedAt": generated_at,
        "race": {
            "id": race_id,
            "name": summary.get("route_name") or "Untitled race",
            "distanceKm": total_km,
            "elevationGainM": float(summary.get("elevation_gain_m") or 0),
            "analyzedAt": roadbook.get("analyzed_at"),
        },
        "route": route_payload,
        "stops": stops,
        "discoverPois": _build_discover_pois(roadbook),
        "climbs": _build_climbs(roadbook),
        "unsupportedSections": unsupported,
        "dashboardStats": dashboard_stats,
        "riderAssumptions": assumptions,
    })
    bundle["bundleChecksum"] = compute_bundle_checksum(bundle)
    return bundle
