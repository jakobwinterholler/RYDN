"""Rider-oriented resupply stop ranking with climb and gap awareness."""

from __future__ import annotations

import re
from typing import Any


def _opening_hours_bonus(poi: dict[str, Any]) -> float:
    """Favour stops with reliable or 24/7 opening hours."""
    hours = str(poi.get("opening_hours") or "").strip().lower()
    if not hours:
        return 0.0
    if "24/7" in hours or hours.startswith("24"):
        return 8.0
    if re.search(r"mo|tu|we|th|fr|sa|su", hours):
        if "00:00-24:00" in hours or "00:00-23:59" in hours:
            return 6.0
        return 4.0
    return 2.0


def _highway_only_penalty(poi: dict[str, Any], category_key: str) -> float:
    """Penalize fuel stations that are motorway-only and hard to reach by bike."""
    if category_key != "fuel":
        return 0.0
    tags = poi.get("tags") or {}
    if not isinstance(tags, dict):
        return 0.0
    highway = str(tags.get("highway") or "").lower()
    if highway in {"motorway", "motorway_link", "trunk", "trunk_link"}:
        return 18.0
    access = str(tags.get("access") or tags.get("motorcycle") or "").lower()
    if access in {"no", "private", "customers"}:
        return 10.0
    return 0.0


def _on_route_bonus(detour_m: float) -> float:
    """Reward minimal detour — on-route stops are easier during ultras."""
    if detour_m <= 30:
        return 6.0
    if detour_m <= 80:
        return 3.0
    if detour_m <= 150:
        return 1.0
    return 0.0


def _poi_category_key(poi: dict[str, Any], category_key: str) -> str:
    lowered = str(poi.get("poi_category") or "").lower()
    if category_key == "fuel" or "gas" in lowered or "fuel" in lowered:
        return "fuel"
    if "small supermarket" in lowered or "mini supermarket" in lowered:
        return "small_supermarket"
    if "convenience" in lowered:
        return "convenience"
    if "supermarket" in lowered:
        return "large_supermarket"
    if "drinking water" in lowered or category_key == "water":
        return "water"
    if category_key == "food":
        return "food"
    return "other"


def stop_type_priority_boost(poi: dict[str, Any], category_key: str) -> float:
    """
    Rider stop-type priority:
    1. Fuel stations
    2. Small supermarkets
    3. Water fountains
    4. Large supermarkets (useful but below fuel)
    """
    kind = _poi_category_key(poi, category_key)
    return {
        "fuel": 14.0,
        "small_supermarket": 11.0,
        "water": 9.0,
        "convenience": 7.0,
        "large_supermarket": 5.0,
        "food": 6.0,
        "other": 0.0,
    }.get(kind, 0.0)


def _climb_for_km(climbs: list[dict[str, Any]], km: float) -> dict[str, Any] | None:
    for climb in climbs:
        start = float(climb.get("start_km") or climb.get("startKm") or 0)
        end = float(climb.get("end_km") or climb.get("endKm") or 0)
        if start - 0.3 <= km <= end + 0.3:
            return climb
    return None


def _next_climb_after(climbs: list[dict[str, Any]], km: float) -> dict[str, Any] | None:
    upcoming = [
        climb
        for climb in climbs
        if float(climb.get("start_km") or climb.get("startKm") or 0) > km
    ]
    if not upcoming:
        return None
    return min(
        upcoming,
        key=lambda climb: float(climb.get("start_km") or climb.get("startKm") or 0),
    )


def _unsupported_gap_after(
    unsupported_sections: list[dict[str, Any]],
    km: float,
) -> dict[str, Any] | None:
    for section in unsupported_sections:
        start = float(section.get("startKm") or section.get("start_km") or 0)
        if start >= km - 0.2:
            return section
    return None


def climb_position_bonus(
    poi_km: float,
    poi: dict[str, Any],
    category_key: str,
    climbs: list[dict[str, Any]],
    peer_kms: list[float],
) -> float:
    """
    Favour the last useful stop before or on a climb segment.
    Multiple fountains on a climb → prefer the highest one (carry less water uphill).
    Multiple fuel stations before a climb → prefer the latest practical one.
    """
    kind = _poi_category_key(poi, category_key)
    if kind not in {"water", "fuel"}:
        return 0.0

    climb = _climb_for_km(climbs, poi_km)
    if climb is not None and kind == "fuel":
        start = float(climb.get("start_km") or climb.get("startKm") or 0)
        end = float(climb.get("end_km") or climb.get("endKm") or 0)
        span = max(end - start, 0.1)
        progress = (poi_km - start) / span
        if 0.15 <= progress <= 0.85:
            bonus = 5.0 + min(4.0, progress * 4.0)
            if peer_kms and poi_km >= max(peer_kms) - 0.05:
                bonus += 2.0
            return bonus

    if climb is not None and kind == "water":
        start = float(climb.get("start_km") or climb.get("startKm") or 0)
        end = float(climb.get("end_km") or climb.get("endKm") or 0)
        span = max(end - start, 0.1)
        progress = (poi_km - start) / span
        bonus = min(8.0, progress * 8.0)
        if peer_kms:
            if poi_km >= max(peer_kms) - 0.05:
                bonus += 4.0
        return bonus

    next_climb = _next_climb_after(climbs, poi_km)
    if next_climb is not None and kind == "fuel":
        climb_start = float(next_climb.get("start_km") or next_climb.get("startKm") or 0)
        if climb_start - poi_km <= 12.0:
            proximity = max(0.0, 12.0 - (climb_start - poi_km))
            bonus = min(6.0, proximity * 0.5)
            if peer_kms and poi_km >= max(peer_kms) - 0.05:
                bonus += 3.0
            return bonus

    return 0.0


def unsupported_gap_bonus(
    poi_km: float,
    unsupported_sections: list[dict[str, Any]],
) -> float:
    """Boost stops that cover an upcoming long unsupported gap."""
    gap = _unsupported_gap_after(unsupported_sections, poi_km)
    if gap is None:
        return 0.0
    distance = float(gap.get("distanceKm") or gap.get("distance_km") or 0)
    if distance < 25.0:
        return 0.0
    return min(8.0, distance / 8.0)


def planning_score(
    poi: dict[str, Any],
    *,
    category_key: str,
    zone_km: float,
    climbs: list[dict[str, Any]] | None = None,
    unsupported_sections: list[dict[str, Any]] | None = None,
    peer_kms: list[float] | None = None,
) -> float:
    """Combined rider-oriented planning score for primary POI selection."""
    base = float(poi.get("score") or 0)
    detour = float(poi.get("distance_off_route_m") or 0)
    poi_km = float(poi.get("distance_along_km") or zone_km)
    peers = [km for km in (peer_kms or []) if km != poi_km]

    score = base
    score -= min(detour / 8.0, 35.0)
    score += _on_route_bonus(detour)
    score += _opening_hours_bonus(poi)
    score -= _highway_only_penalty(poi, category_key)
    score += stop_type_priority_boost(poi, category_key)
    score += climb_position_bonus(
        poi_km,
        poi,
        category_key,
        climbs or [],
        peers,
    )
    score += unsupported_gap_bonus(poi_km, unsupported_sections or [])
    return round(score, 2)


def build_resupply_reason(
    poi: dict[str, Any],
    *,
    category_key: str,
    zone_km: float,
    climbs: list[dict[str, Any]] | None = None,
    unsupported_sections: list[dict[str, Any]] | None = None,
    peer_pois: list[dict[str, Any]] | None = None,
) -> str | None:
    """Human-readable rider reasoning for this stop choice."""
    kind = _poi_category_key(poi, category_key)
    poi_km = float(poi.get("distance_along_km") or zone_km)
    reasons: list[str] = []

    climb = _climb_for_km(climbs or [], poi_km)
    if climb is not None and kind == "water":
        climb_id = str(climb.get("id") or "climb")
        if peer_pois and len(peer_pois) > 1:
            reasons.append(
                f"Refill at km {poi_km:.0f} — last useful fountain before summit on {climb_id}"
            )
        else:
            reasons.append(f"Water on {climb_id} — refill before climbing further")

    next_climb = _next_climb_after(climbs or [], poi_km)
    if next_climb is not None and kind == "fuel":
        climb_start = float(next_climb.get("start_km") or next_climb.get("startKm") or 0)
        if climb_start - poi_km <= 12.0:
            reasons.append(
                f"Last practical fuel before climb at km {climb_start:.0f}"
            )

    gap = _unsupported_gap_after(unsupported_sections or [], poi_km)
    if gap is not None:
        distance = float(gap.get("distanceKm") or gap.get("distance_km") or 0)
        if distance >= 25.0:
            reasons.append(f"No water for the next {distance:.0f} km after this point")

    if kind == "fuel":
        reasons.append("Fuel station — food, water, toilets, long hours")
    elif kind == "small_supermarket":
        reasons.append("Small supermarket — fast entry, often on route")
    elif kind == "convenience":
        reasons.append("Convenience store — quick resupply on route")
    elif kind == "water":
        reasons.append("Drinking water — valuable on climbs and hot sections")

    if not reasons:
        return None
    return reasons[0] if len(reasons) == 1 else " · ".join(reasons[:2])
