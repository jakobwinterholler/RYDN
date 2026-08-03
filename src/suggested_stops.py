"""Hand-picked suggested stops from resupply zones with climb and gap awareness."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from resupply_intelligence import (
    _poi_category_key,
    build_resupply_reason,
    planning_score,
)
from significant_climbs import significant_climbs
from unsupported_sections import analyze_unsupported_sections

DEDUP_DISTANCE_KM = 0.3
SUPERMARKET_SPACING_KM = 5.0
GAS_SPACING_KM = 8.0
URBAN_CLUSTER_KM = 2.0
URBAN_MIN_ZONES = 3
BASE_SPACING_KM = 16.0
TIGHT_SPACING_KM = 10.0
REMOTE_GAP_KM = 22.0
REMOTE_PICK_SPACING_KM = 6.0
LOOKAHEAD_KM = 20.0
GAP_FILL_THRESHOLD_KM = 8.0


@dataclass
class SuggestedStop:
    zone_id: int
    osm_id: int
    osm_type: str
    name: str | None
    poi_category: str
    category_key: str
    category_label: str
    distance_along_km: float
    distance_off_route_m: float
    lat: float
    lon: float
    score: float
    reason: str | None


def _zone_km(zone: dict[str, Any]) -> float:
    return float(zone.get("distance_along_km") or 0)


def _zone_min_detour(zone: dict[str, Any]) -> float:
    distances: list[float] = []
    for group in zone.get("categories") or []:
        for option in [group.get("primary"), *(group.get("alternatives") or [])]:
            if isinstance(option, dict):
                distances.append(float(option.get("distance_off_route_m") or 9999))
    return min(distances) if distances else 9999.0


def _zone_score(zone: dict[str, Any]) -> float:
    score = float(zone.get("poi_count") or 0) * 2
    tone = str(zone.get("accessibility_tone") or "")
    score += {"good": 4, "caution": 3, "warning": 2, "bad": 1}.get(tone, 0)
    for key, bonus in (("food", 25), ("water", 20), ("fuel", 10)):
        for group in zone.get("categories") or []:
            if group.get("key") == key and group.get("primary"):
                score += bonus
                break
    return score


def _compare_zone_candidates(left: dict[str, Any], right: dict[str, Any]) -> int:
    detour_diff = _zone_min_detour(left) - _zone_min_detour(right)
    if detour_diff != 0:
        return -1 if detour_diff < 0 else 1
    score_diff = _zone_score(right) - _zone_score(left)
    if score_diff > 0:
        return -1
    if score_diff < 0:
        return 1
    return 0


def _pick_best_in_range(candidates: list[dict[str, Any]], start: int, end: int) -> int:
    best = start
    for index in range(start + 1, end + 1):
        if _compare_zone_candidates(candidates[index], candidates[best]) < 0:
            best = index
    return best


def _collapse_urban_clusters(zones: list[dict[str, Any]]) -> list[dict[str, Any]]:
    sorted_zones = sorted(zones, key=_zone_km)
    if not sorted_zones:
        return sorted_zones

    collapsed: list[dict[str, Any]] = []
    cluster = [sorted_zones[0]]

    for zone in sorted_zones[1:]:
        if _zone_km(zone) - _zone_km(cluster[0]) <= URBAN_CLUSTER_KM:
            cluster.append(zone)
            continue
        if len(cluster) >= URBAN_MIN_ZONES:
            collapsed.append(cluster[_pick_best_in_range(cluster, 0, len(cluster) - 1)])
        else:
            collapsed.extend(cluster)
        cluster = [zone]

    if len(cluster) >= URBAN_MIN_ZONES:
        collapsed.append(cluster[_pick_best_in_range(cluster, 0, len(cluster) - 1)])
    else:
        collapsed.extend(cluster)
    return collapsed


def _select_planning_zones(zones: list[dict[str, Any]], total_km: float) -> list[dict[str, Any]]:
    """Spacing-aware zone selection — mirrors frontend selectPlanningStops."""
    if not zones:
        return []
    candidates = _collapse_urban_clusters(zones)
    if len(candidates) == 1:
        return candidates

    picked: list[dict[str, Any]] = []
    picked_ids: set[int] = set()

    def pick_at(index: int) -> None:
        zone = candidates[index]
        zone_id = int(zone.get("zone_id") or 0)
        if zone_id in picked_ids:
            return
        picked_ids.add(zone_id)
        picked.append(zone)

    pick_at(0)
    anchor_index = 0

    while anchor_index < len(candidates) - 1:
        anchor_km = _zone_km(candidates[anchor_index])
        gap_to_next = _zone_km(candidates[anchor_index + 1]) - anchor_km
        spacing = TIGHT_SPACING_KM if gap_to_next >= REMOTE_GAP_KM else BASE_SPACING_KM

        if gap_to_next >= REMOTE_GAP_KM:
            scan_index = anchor_index + 1
            last_picked = anchor_index
            window_end = anchor_km + spacing * 2.5
            while scan_index < len(candidates) and _zone_km(candidates[scan_index]) <= window_end:
                since_last = _zone_km(candidates[scan_index]) - _zone_km(candidates[last_picked])
                if since_last >= spacing * 0.75:
                    pick_at(scan_index)
                    last_picked = scan_index
                scan_index += 1
            if last_picked == anchor_index:
                pick_at(anchor_index + 1)
                anchor_index += 1
            else:
                anchor_index = last_picked
            continue

        target_km = anchor_km + spacing
        target_index = anchor_index + 1
        while target_index < len(candidates) and _zone_km(candidates[target_index]) < target_km:
            target_index += 1
        if target_index >= len(candidates):
            break

        cluster_start = target_index
        while (
            cluster_start > anchor_index + 1
            and _zone_km(candidates[target_index]) - _zone_km(candidates[cluster_start - 1])
            <= URBAN_CLUSTER_KM
        ):
            cluster_start -= 1

        best_index = _pick_best_in_range(candidates, cluster_start, target_index)
        pick_at(best_index)
        anchor_index = best_index

    pick_at(len(candidates) - 1)
    return sorted(picked, key=_zone_km)


def _zone_has_fuel_primary(zone: dict[str, Any]) -> bool:
    for group in zone.get("categories") or []:
        if group.get("key") == "fuel" and isinstance(group.get("primary"), dict):
            return True
    return False


def _merge_climb_fuel_zones(
    zones: list[dict[str, Any]],
    selected: list[dict[str, Any]],
    climbs: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Always include fuel stops that sit on a significant climb."""
    significant = significant_climbs(climbs)
    if not significant:
        return selected

    selected_ids = {int(zone.get("zone_id") or 0) for zone in selected}
    merged = list(selected)
    for zone in zones:
        zone_id = int(zone.get("zone_id") or 0)
        if zone_id in selected_ids or not _zone_has_fuel_primary(zone):
            continue
        zone_km = _zone_km(zone)
        for climb in significant:
            start_km = float(climb.get("start_km") or climb.get("startKm") or 0)
            end_km = float(climb.get("end_km") or climb.get("endKm") or 0)
            if start_km <= zone_km <= end_km:
                merged.append(zone)
                selected_ids.add(zone_id)
                break
    return sorted(merged, key=_zone_km)


def _rank_zone_pois(
    zone: dict[str, Any],
    *,
    climbs: list[dict[str, Any]],
    unsupported_sections: list[dict[str, Any]],
) -> list[tuple[dict[str, Any], str, str]]:
    seen: set[str] = set()
    items: list[tuple[dict[str, Any], str, str]] = []
    zone_km = _zone_km(zone)
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

    peer_kms = [float(poi.get("distance_along_km") or zone_km) for poi, _, _ in items]
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


def _poi_kind(poi: dict[str, Any], category_key: str) -> str:
    return _poi_category_key(poi, category_key)


def _is_supermarket_kind(kind: str) -> bool:
    return kind in {"small_supermarket", "large_supermarket"}


def _violates_dedup(
    candidate: SuggestedStop,
    selected: list[SuggestedStop],
) -> bool:
    for existing in selected:
        km_gap = abs(candidate.distance_along_km - existing.distance_along_km)
        if km_gap < DEDUP_DISTANCE_KM:
            return True

        cand_kind = _poi_kind({"poi_category": candidate.poi_category}, candidate.category_key)
        exist_kind = _poi_kind({"poi_category": existing.poi_category}, existing.category_key)

        if cand_kind == "fuel" and exist_kind == "fuel" and km_gap < GAS_SPACING_KM:
            return True

        if _is_supermarket_kind(cand_kind) and _is_supermarket_kind(exist_kind):
            if km_gap < SUPERMARKET_SPACING_KM:
                return True

    return False


def resolve_planning_zones(
    roadbook: dict[str, Any],
) -> list[dict[str, Any]]:
    """Return resupply zones that match suggested stops, with migration fallback."""
    zones = roadbook.get("resupply_zones") or []
    if not zones:
        return []

    suggested = roadbook.get("suggested_stops")
    total_km = float((roadbook.get("summary") or {}).get("distance_km") or 0)
    climbs = roadbook.get("climbs") or []

    if suggested:
        zone_ids = {int(stop.get("zone_id") or 0) for stop in suggested}
    else:
        computed = build_suggested_stops(zones, climbs=climbs, total_km=total_km)
        zone_ids = {int(stop.get("zone_id") or 0) for stop in computed}

    return [zone for zone in zones if int(zone.get("zone_id") or 0) in zone_ids]


def build_suggested_stops(
    zones: list[dict[str, Any]],
    *,
    climbs: list[dict[str, Any]] | None = None,
    total_km: float,
) -> list[dict[str, Any]]:
    """Return hand-picked suggested stops as JSON-serializable dicts."""
    if not zones:
        return []

    climb_rows = climbs or []
    unsupported = analyze_unsupported_sections(zones, total_km)
    selected_zones = _merge_climb_fuel_zones(
        zones,
        _select_planning_zones(zones, total_km),
        climb_rows,
    )

    candidates: list[SuggestedStop] = []
    for zone in selected_zones:
        ranked = _rank_zone_pois(zone, climbs=climb_rows, unsupported_sections=unsupported)
        if not ranked:
            continue
        poi, category_key, category_label = ranked[0]
        zone_km = _zone_km(zone)
        poi_km = float(poi.get("distance_along_km") or zone_km)
        peer_pois = [entry[0] for entry in ranked]
        reason = build_resupply_reason(
            poi,
            category_key=category_key,
            zone_km=zone_km,
            climbs=climb_rows,
            unsupported_sections=unsupported,
            peer_pois=peer_pois,
        )
        candidates.append(
            SuggestedStop(
                zone_id=int(zone.get("zone_id") or 0),
                osm_id=int(poi.get("osm_id") or 0),
                osm_type=str(poi.get("osm_type") or "node"),
                name=poi.get("name"),
                poi_category=str(poi.get("poi_category") or category_label),
                category_key=category_key,
                category_label=category_label,
                distance_along_km=poi_km,
                distance_off_route_m=float(poi.get("distance_off_route_m") or 0),
                lat=float(poi.get("lat") or zone.get("lat") or 0),
                lon=float(poi.get("lon") or zone.get("lon") or 0),
                score=planning_score(
                    poi,
                    category_key=category_key,
                    zone_km=zone_km,
                    climbs=climb_rows,
                    unsupported_sections=unsupported,
                    peer_kms=[float(p.get("distance_along_km") or zone_km) for p, _, _ in ranked],
                ),
                reason=reason,
            )
        )

    candidates.sort(key=lambda stop: stop.distance_along_km)
    selected: list[SuggestedStop] = []
    for candidate in sorted(candidates, key=lambda stop: stop.score, reverse=True):
        if not _violates_dedup(candidate, selected):
            selected.append(candidate)

    selected.sort(key=lambda stop: stop.distance_along_km)
    return [
        {
            "zone_id": stop.zone_id,
            "osm_id": stop.osm_id,
            "osm_type": stop.osm_type,
            "name": stop.name,
            "poi_category": stop.poi_category,
            "category_key": stop.category_key,
            "category_label": stop.category_label,
            "distance_along_km": round(stop.distance_along_km, 2),
            "distance_off_route_m": round(stop.distance_off_route_m, 1),
            "lat": stop.lat,
            "lon": stop.lon,
            "score": stop.score,
            "reason": stop.reason,
        }
        for stop in selected
    ]
