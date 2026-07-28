"""Smart stop scoring — rank candidates, recommend ~10–30 for an Ultra."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, Tuple

# Base reliability by category (stars 1–5).
_CATEGORY_STARS: Dict[str, int] = {
    "Gas station": 5,
    "Supermarket": 5,
    "Drinking water": 5,
    "Water tap": 4,
    "Convenience": 4,
    "Pharmacy": 4,
    "Bike shop": 4,
    "Bakery": 3,
    "Hotel": 4,
    "Hostel": 3,
    "Campsite": 3,
    "Shelter": 3,
    "Alpine hut": 3,
    "Café": 2,
    "Restaurant": 2,
    "Fast food": 2,
}

_DINING = {"Café", "Restaurant", "Fast food"}


def _is_24h(hours: Optional[str]) -> bool:
    if not hours:
        return False
    h = hours.lower().replace(" ", "")
    return "24/7" in h or h in ("24hours", "24h") or "mo-su24" in h


def stop_key(poi: Dict[str, Any]) -> str:
    return f"{poi.get('osmType', 'node')}:{poi.get('osmId', 0)}"


def score_stop(poi: Dict[str, Any], *, nearby_count: int = 0) -> Dict[str, Any]:
    """Confidence score for a single OSM candidate."""
    cat = poi.get("category") or ""
    group = poi.get("group") or ""
    hours = poi.get("openingHours")
    off = float(poi.get("distanceOffRouteM") or 999)
    base = _CATEGORY_STARS.get(cat, 2)

    # 24h gas / shops are ultra gold.
    is24 = _is_24h(hours)
    if cat == "Gas station" and is24:
        base = 5
    elif is24 and group == "resupply":
        base = min(5, base + 1)

    # Proximity: on-route is trustworthy; far off is weaker.
    if off <= 80:
        prox = 1.0
    elif off <= 250:
        prox = 0.85
    elif off <= 500:
        prox = 0.7
    else:
        prox = 0.5

    # Cluster bonus — more mapped amenities nearby → better mapping / town.
    cluster = min(1.15, 1.0 + nearby_count * 0.03)

    # Opening hours known → slight confidence bump.
    hours_factor = 1.08 if hours else 0.95

    # Dining is lower priority for ultra resupply.
    dining_penalty = 0.75 if cat in _DINING else 1.0

    raw = base * prox * cluster * hours_factor * dining_penalty
    stars = max(1, min(5, int(round(raw))))
    if stars >= 5:
        label = "Excellent"
    elif stars == 4:
        label = "Reliable"
    elif stars == 3:
        label = "Acceptable"
    elif stars == 2:
        label = "Avoid if possible"
    else:
        label = "Unknown"

    return {
        **poi,
        "id": stop_key(poi),
        "qualityStars": stars,
        "qualityLabel": label,
        "qualityScore": round(raw, 2),
        "is24h": is24,
        "priority": group in ("resupply", "water", "service") or cat == "Gas station",
    }


def _cluster_counts(pois: Sequence[Dict[str, Any]], radius_km: float = 3.0) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    items = list(pois)
    for p in items:
        k = stop_key(p)
        km = float(p.get("distanceAlongKm") or 0)
        n = sum(
            1
            for o in items
            if o is not p and abs(float(o.get("distanceAlongKm") or 0) - km) <= radius_km
        )
        counts[k] = n
    return counts


def select_recommended_stops(
    pois: Sequence[Dict[str, Any]],
    sleep: Sequence[Dict[str, Any]],
    *,
    total_km: float,
    reviews: Optional[Dict[str, str]] = None,
) -> List[Dict[str, Any]]:
    """Pick ~10–30 intentional stops — never dump every OSM node."""
    reviews = reviews or {}
    all_raw = list(pois) + [s for s in sleep if s.get("group") == "sleep"]
    if not all_raw:
        return []

    clusters = _cluster_counts(all_raw)
    scored = [score_stop(p, nearby_count=clusters.get(stop_key(p), 0)) for p in all_raw]

    # Target count scales with distance.
    if total_km <= 0:
        target = 12
    else:
        target = int(round(total_km / 40.0))  # ~25 for 1000 km
        target = max(10, min(30, target))

    # Min spacing so we don't recommend every km.
    min_spacing = max(12.0, min(45.0, total_km / max(target, 1) * 0.85))

    # Prefer high-priority categories in ranking.
    ranked = sorted(
        scored,
        key=lambda s: (
            0 if s.get("priority") else 1,
            -s["qualityScore"],
            s.get("distanceOffRouteM") or 999,
        ),
    )

    chosen: List[Dict[str, Any]] = []
    used_kms: List[float] = []

    def too_close(km: float) -> bool:
        return any(abs(km - u) < min_spacing for u in used_kms)

    # Always keep verified stops even if spacing conflicts slightly.
    for s in ranked:
        sid = s["id"]
        status = reviews.get(sid)
        if status == "rejected":
            continue
        km = float(s.get("distanceAlongKm") or 0)
        if status == "verified":
            if not any(abs(km - u) < 5 for u in used_kms):
                chosen.append(s)
                used_kms.append(km)
            continue

    for s in ranked:
        if len(chosen) >= target:
            break
        sid = s["id"]
        if reviews.get(sid) == "rejected":
            continue
        if any(c["id"] == sid for c in chosen):
            continue
        # Skip low-value dining unless sparse.
        if s.get("category") in _DINING and s["qualityStars"] < 3:
            continue
        km = float(s.get("distanceAlongKm") or 0)
        if too_close(km):
            continue
        chosen.append(s)
        used_kms.append(km)

    # Second pass with tighter spacing if we are short of target.
    if len(chosen) < target:
        loose = min_spacing * 0.55
        for s in ranked:
            if len(chosen) >= target:
                break
            sid = s["id"]
            if reviews.get(sid) == "rejected":
                continue
            if any(c["id"] == sid for c in chosen):
                continue
            if s.get("category") in _DINING and s["qualityStars"] < 3:
                continue
            km = float(s.get("distanceAlongKm") or 0)
            if any(abs(km - u) < loose for u in used_kms):
                continue
            chosen.append(s)
            used_kms.append(km)

    # Ensure water coverage: if a long stretch lacks water recommendations, force best water.
    waters = [s for s in ranked if s.get("group") == "water" and reviews.get(s["id"]) != "rejected"]
    for w in waters:
        km = float(w.get("distanceAlongKm") or 0)
        if any(abs(km - u) < min_spacing * 0.7 for u in used_kms):
            continue
        # Only add if that region has no recommended stop nearby
        if not any(abs(km - float(c.get("distanceAlongKm") or 0)) < min_spacing for c in chosen):
            if len(chosen) < target + 5:
                chosen.append(w)
                used_kms.append(km)

    # Keep rejected stops visible in Planning (grey markers / re-review).
    rejected_ids = {sid for sid, st in reviews.items() if st == "rejected"}
    for s in ranked:
        if s["id"] in rejected_ids and not any(c["id"] == s["id"] for c in chosen):
            chosen.append(s)

    chosen.sort(key=lambda s: float(s.get("distanceAlongKm") or 0))

    # Annotate spacing / review status / links.
    prev_km = 0.0
    out: List[Dict[str, Any]] = []
    for s in chosen:
        km = float(s.get("distanceAlongKm") or 0)
        lat, lon = s.get("lat"), s.get("lon")
        status = reviews.get(s["id"]) or "unreviewed"
        # Rough ETA from start at 22 km/h moving average.
        eta_s = (km / 22.0) * 3600.0 if km > 0 else 0.0
        out.append(
            {
                **s,
                "reviewStatus": status,
                "distanceSincePreviousKm": round(max(0.0, km - prev_km), 1),
                "estimatedArrivalS": round(eta_s),
                "googleMapsUrl": (
                    f"https://www.google.com/maps/search/?api=1&query={lat},{lon}"
                    if lat is not None and lon is not None
                    else None
                ),
                "streetViewUrl": (
                    f"https://www.google.com/maps/@?api=1&map_action=pano&viewpoint={lat},{lon}"
                    if lat is not None and lon is not None
                    else None
                ),
                "website": s.get("website"),
            }
        )
        prev_km = km
    return out
