"""Compute race dashboard stats from roadbook analysis and preparation state."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from suggested_stops import resolve_planning_zones
from unsupported_sections import analyze_unsupported_sections

RELIABLE_FOOD_SCORE = 35
RELIABLE_WATER_SCORE = 10

WEIGHTS = {
    "supermarkets": 20,
    "fuel": 20,
    "water": 20,
    "opening_hours": 15,
    "unsupported": 15,
    "overall_verification": 10,
}


def _zone_has_category(zone: dict[str, Any], key: str) -> bool:
    for group in zone.get("categories") or []:
        if group.get("key") == key and group.get("primary"):
            return True
    return False


def _primary_poi(zone: dict[str, Any]) -> dict[str, Any] | None:
    for key in ("water", "food", "fuel"):
        for group in zone.get("categories") or []:
            if group.get("key") == key and group.get("primary"):
                return group["primary"]
    for group in zone.get("categories") or []:
        if group.get("primary"):
            return group["primary"]
    return None


def _is_supermarket_zone(zone: dict[str, Any]) -> bool:
    food = None
    for group in zone.get("categories") or []:
        if group.get("key") == "food" and group.get("primary"):
            food = group["primary"]
            break
    if not food:
        return False
    category = str(food.get("poi_category") or food.get("category") or "").lower()
    return any(token in category for token in ("supermarket", "convenience", "bakery"))


def _is_verified(zone_id: Any, verified_stops: dict[str, Any]) -> bool:
    record = verified_stops.get(str(zone_id)) or {}
    return record.get("status") == "verified"


def _last_verification_at(verified_stops: dict[str, Any]) -> str | None:
    timestamps: list[str] = []
    for record in verified_stops.values():
        if not isinstance(record, dict):
            continue
        if record.get("status") != "verified":
            continue
        updated = record.get("updated_at")
        if isinstance(updated, str) and updated:
            timestamps.append(updated)
    if not timestamps:
        return None
    return max(timestamps, key=lambda value: _parse_iso(value))


def _parse_iso(value: str) -> float:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


def compute_race_dashboard_stats(
    roadbook: dict[str, Any],
    preparation: dict[str, Any],
    *,
    max_gap_km: float = 45.0,
) -> dict[str, Any]:
    all_zones = roadbook.get("resupply_zones") or []
    planning_zones = resolve_planning_zones(roadbook)
    summary = roadbook.get("summary") or {}
    total_km = float(summary.get("distance_km") or 0)
    verified_stops = (preparation or {}).get("verified_stops") or {}

    verified_count = 0
    unverified_count = 0
    supermarkets = 0
    water_stops = 0
    fuel_stops = 0
    supermarket_verified = 0
    water_verified = 0
    fuel_verified = 0
    missing_hours = 0

    for zone in planning_zones:
        zone_id = zone.get("zone_id")
        verified = _is_verified(zone_id, verified_stops)
        if verified:
            verified_count += 1
        else:
            unverified_count += 1

        has_water = _zone_has_category(zone, "water")
        has_fuel = _zone_has_category(zone, "fuel")
        has_supermarket = _is_supermarket_zone(zone)

        if has_water:
            water_stops += 1
            if verified:
                water_verified += 1
        if has_fuel:
            fuel_stops += 1
            if verified:
                fuel_verified += 1
        if has_supermarket:
            supermarkets += 1
            if verified:
                supermarket_verified += 1

        poi = _primary_poi(zone)
        hours = (poi or {}).get("opening_hours")
        if not hours or not str(hours).strip():
            missing_hours += 1

    unsupported = analyze_unsupported_sections(all_zones, total_km)
    longest_unsupported = max((section["distanceKm"] for section in unsupported), default=None)

    readiness_input = {
        "verifiedStops": verified_count,
        "unverifiedStops": unverified_count,
        "categories": {
            "supermarkets": {"total": supermarkets, "verified": supermarket_verified},
            "water": {"total": water_stops, "verified": water_verified},
            "fuel": {"total": fuel_stops, "verified": fuel_verified},
        },
        "stopsMissingOpeningHours": missing_hours,
        "longestUnsupportedKm": longest_unsupported,
        "maxGapKm": max_gap_km,
    }

    score, reasons = _compute_readiness(readiness_input)

    return {
        "verified_stops": verified_count,
        "unverified_stops": unverified_count,
        "supermarkets": supermarkets,
        "water_stops": water_stops,
        "fuel_stops": fuel_stops,
        "longest_unsupported_km": longest_unsupported,
        "last_verification_at": _last_verification_at(verified_stops),
        "readiness_score": score,
        "readiness_reasons": reasons,
    }


def _ratio_score(total: int, verified: int, weight: int) -> float:
    if total <= 0:
        return 0.0
    return (verified / total) * weight


def _compute_readiness(input_data: dict[str, Any]) -> tuple[int, list[dict[str, str]]]:
    reasons: list[dict[str, str]] = []
    max_gap = float(input_data.get("maxGapKm") or 45)
    earned = 0.0

    categories = input_data.get("categories") or {}
    supermarkets = categories.get("supermarkets") or {"total": 0, "verified": 0}
    water = categories.get("water") or {"total": 0, "verified": 0}
    fuel = categories.get("fuel") or {"total": 0, "verified": 0}

    sm_total = int(supermarkets.get("total") or 0)
    sm_verified = int(supermarkets.get("verified") or 0)
    water_total = int(water.get("total") or 0)
    water_verified = int(water.get("verified") or 0)
    fuel_total = int(fuel.get("total") or 0)
    fuel_verified = int(fuel.get("verified") or 0)
    verified_stops = int(input_data.get("verifiedStops") or 0)
    unverified_stops = int(input_data.get("unverifiedStops") or 0)
    total_stops = verified_stops + unverified_stops

    if sm_total == 0:
        reasons.append({"kind": "warn", "text": "No supermarket stops on route"})
    elif sm_verified == sm_total:
        reasons.append({"kind": "pass", "text": "All supermarkets verified"})
        earned += WEIGHTS["supermarkets"]
    else:
        missing = sm_total - sm_verified
        reasons.append(
            {"kind": "warn", "text": f"{missing} supermarket{'s' if missing != 1 else ''} not verified"}
        )
        earned += _ratio_score(sm_total, sm_verified, WEIGHTS["supermarkets"])

    if fuel_total == 0:
        reasons.append({"kind": "warn", "text": "No fuel stops on route"})
    elif fuel_verified == fuel_total:
        reasons.append({"kind": "pass", "text": "All fuel stops verified"})
        earned += WEIGHTS["fuel"]
    else:
        missing = fuel_total - fuel_verified
        reasons.append(
            {"kind": "warn", "text": f"{missing} fuel stop{'s' if missing != 1 else ''} not verified"}
        )
        earned += _ratio_score(fuel_total, fuel_verified, WEIGHTS["fuel"])

    if water_total == 0:
        reasons.append({"kind": "warn", "text": "No water stops on route"})
    elif water_verified == water_total:
        reasons.append({"kind": "pass", "text": "All water stops verified"})
        earned += WEIGHTS["water"]
    else:
        missing = water_total - water_verified
        reasons.append(
            {"kind": "warn", "text": f"{missing} water stop{'s' if missing != 1 else ''} not verified"}
        )
        earned += _ratio_score(water_total, water_verified, WEIGHTS["water"])

    missing_hours = int(input_data.get("stopsMissingOpeningHours") or 0)
    if total_stops > 0:
        known_hours = total_stops - missing_hours
        if missing_hours == 0:
            reasons.append({"kind": "pass", "text": "Opening hours available"})
            earned += WEIGHTS["opening_hours"]
        else:
            if missing_hours == 1:
                text = "1 stop with unknown opening hours"
            else:
                text = f"{missing_hours} stops with unknown opening hours"
            reasons.append({"kind": "warn", "text": text})
            earned += _ratio_score(total_stops, known_hours, WEIGHTS["opening_hours"])

    longest = input_data.get("longestUnsupportedKm")
    if longest is not None and float(longest) > max_gap:
        reasons.append(
            {
                "kind": "warn",
                "text": f"Unsupported section >{int(max_gap)} km ({int(float(longest))} km)",
            }
        )
        excess_ratio = min(1.0, (float(longest) - max_gap) / max_gap)
        earned += WEIGHTS["unsupported"] * max(0.0, 1.0 - excess_ratio)
    elif longest is not None:
        reasons.append({"kind": "pass", "text": "Unsupported gaps within your limit"})
        earned += WEIGHTS["unsupported"]

    if total_stops > 0:
        if verified_stops == total_stops:
            reasons.append({"kind": "pass", "text": "Every resupply stop verified"})
            earned += WEIGHTS["overall_verification"]
        else:
            earned += _ratio_score(total_stops, verified_stops, WEIGHTS["overall_verification"])

    return max(0, min(100, round(earned))), reasons
