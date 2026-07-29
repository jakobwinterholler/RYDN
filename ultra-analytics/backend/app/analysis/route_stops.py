"""Smart stop scoring — rank candidates, recommend ~10–30 for an Ultra.

Priority for resupply planning:
  1. Drinking water
  2. Small neighborhood supermarkets / convenience (Condis, Spar, Express, …)
  3. Fuel / pharmacy / bike (useful services)
  Below: restaurants, cafés, large hypermarkets
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Sequence, Tuple

# Base reliability by category (stars 1–5) — water & small shops lead.
_CATEGORY_STARS: Dict[str, int] = {
    "Drinking water": 5,
    "Water tap": 4,
    "Convenience": 5,
    "Supermarket": 4,  # adjusted by brand size below
    "Gas station": 4,
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

# Small neighborhood banners — prefer over hypermarkets for ultra resupply.
_SMALL_MARKET_HINTS = (
    "condis",
    "spar",
    "eurospa",
    "carrefour express",
    "carrefour city",
    "carrefour contact",
    "carrefour market",
    "bonpreu",
    "bon preu",
    "consum",
    "dia ",
    "dia market",
    "aldi",
    "lidl",
    "caprabo",
    "mercadona",  # mid-size but ultra-useful in ES
    "simply",
    "simply market",
    "coop",
    "coopérative",
    "minicoop",
    "ah to go",
    "ah convenience",
    "tesco express",
    "tesco metro",
    "sainsbury's local",
    "sainsburys local",
    "marks & spencer simply food",
    "m&s simply food",
    "7-eleven",
    "7 eleven",
    "open late",
    "night & day",
    "petit casino",
    "casino shop",
    "monoprix",
    "franprix",
    "super u",
    "u express",
    "intermarché express",
    "intermarche express",
    "netto",
    "penny",
    "rewe to go",
    "rewe city",
    "edeka",
    "migros",
    "coop pronto",
    "avec",
    "k kiosk",
)

# Large format / hyper — demote vs neighborhood markets.
_HYPER_HINTS = (
    "hypermarket",
    "hipermercado",
    "carrefour hyper",
    "auchan",
    "alcampo",
    "eroski center",
    "eroski hipermercado",
    "tesco extra",
    "tesco hyper",
    "asda superstore",
    "walmart",
    "costco",
    "makro",
    "metro cash",
    "ikea",
    "decathlon",  # not food resupply
)


def _is_24h(hours: Optional[str]) -> bool:
    if not hours:
        return False
    h = hours.lower().replace(" ", "")
    return "24/7" in h or h in ("24hours", "24h") or "mo-su24" in h


def _text_blob(poi: Dict[str, Any]) -> str:
    parts = [
        str(poi.get("name") or ""),
        str(poi.get("brand") or ""),
        str(poi.get("operator") or ""),
        str(poi.get("category") or ""),
    ]
    return " ".join(parts).lower()


def _store_size(poi: Dict[str, Any]) -> str:
    """Return 'small' | 'large' | 'unknown' for shop size preference."""
    cat = poi.get("category") or ""
    if cat == "Convenience":
        return "small"
    if cat != "Supermarket":
        return "unknown"
    blob = _text_blob(poi)
    if any(h in blob for h in _HYPER_HINTS):
        return "large"
    if any(h in blob for h in _SMALL_MARKET_HINTS):
        return "small"
    # Bare "supermarket" without hyper cues → treat as neighborhood-scale.
    if re.search(r"\b(express|city|local|market|mini)\b", blob):
        return "small"
    return "unknown"


def stop_services(poi: Dict[str, Any]) -> List[str]:
    """Human-facing service tags for marker cards."""
    cat = poi.get("category") or ""
    group = poi.get("group") or ""
    out: List[str] = []
    if group == "water" or "water" in cat.lower():
        out.append("water")
    if cat in ("Supermarket", "Convenience", "Bakery") or group == "resupply":
        out.append("food")
    if cat == "Gas station":
        out.append("fuel")
        out.append("food")  # often drinks/snacks
    if group == "dining":
        out.append("food")
    if cat == "Bike shop":
        out.append("bike")
    if cat == "Pharmacy":
        out.append("pharmacy")
    if group == "sleep":
        out.append("sleep")
    if _is_24h(poi.get("openingHours")):
        out.append("24h")
    # de-dupe preserve order
    seen = set()
    uniq = []
    for s in out:
        if s not in seen:
            seen.add(s)
            uniq.append(s)
    return uniq


def stop_key(poi: Dict[str, Any]) -> str:
    return f"{poi.get('osmType', 'node')}:{poi.get('osmId', 0)}"


def score_stop(poi: Dict[str, Any], *, nearby_count: int = 0) -> Dict[str, Any]:
    """Confidence / resupply usefulness score for a single OSM candidate."""
    cat = poi.get("category") or ""
    group = poi.get("group") or ""
    hours = poi.get("openingHours")
    off = float(poi.get("distanceOffRouteM") or 999)
    base = float(_CATEGORY_STARS.get(cat, 2))
    size = _store_size(poi)

    # Water is the highest-value ultra resource.
    if group == "water" or cat == "Drinking water":
        base = 5.2
    elif cat == "Water tap":
        base = 4.4

    # Small markets beat large hypers and dining.
    if cat == "Supermarket":
        if size == "small":
            base = 5.1
        elif size == "large":
            base = 3.2
        else:
            base = 4.3
    elif cat == "Convenience":
        base = 5.0

    is24 = _is_24h(hours)
    if cat == "Gas station" and is24:
        base = max(base, 4.8)
    elif is24 and group in ("resupply", "water"):
        base = min(5.3, base + 0.4)

    # Proximity: on-route is trustworthy; far off is weaker.
    if off <= 80:
        prox = 1.0
    elif off <= 250:
        prox = 0.88
    elif off <= 500:
        prox = 0.72
    elif off <= 900:
        prox = 0.55
    else:
        prox = 0.4

    # Light cluster bonus — nearby mapped amenities → better town/mapping.
    cluster = min(1.12, 1.0 + nearby_count * 0.025)

    hours_factor = 1.08 if hours else 0.94

    # Dining is lower priority for ultra resupply.
    dining_penalty = 0.62 if cat in _DINING else 1.0

    # Bike shops / pharmacies are useful but not primary food/water.
    service_factor = 0.92 if group == "service" else 1.0

    # Prefer small neighborhood shops explicitly in the continuous score.
    size_factor = 1.08 if size == "small" else (0.78 if size == "large" else 1.0)

    raw = base * prox * cluster * hours_factor * dining_penalty * service_factor * size_factor
    stars = max(1, min(5, int(round(min(5.0, raw)))))
    # 0–100 resupply score for sorting / UI (not capped to star scale).
    resupply_score = int(round(max(0.0, min(100.0, raw * 18.5))))

    if resupply_score >= 85 or stars >= 5:
        label = "Excellent"
    elif resupply_score >= 70 or stars == 4:
        label = "Reliable"
    elif resupply_score >= 55 or stars == 3:
        label = "Acceptable"
    elif stars == 2:
        label = "Avoid if possible"
    else:
        label = "Unknown"

    priority = (
        group in ("water", "resupply")
        or cat in ("Gas station", "Convenience", "Drinking water")
        or (cat == "Supermarket" and size != "large")
    )

    return {
        **poi,
        "id": poi.get("id") or stop_key(poi),
        "qualityStars": stars,
        "qualityLabel": label,
        "qualityScore": round(raw, 2),
        "resupplyScore": resupply_score,
        "storeSize": size,
        "services": stop_services(poi),
        "is24h": is24,
        "priority": priority,
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


def rank_candidates(
    pois: Sequence[Dict[str, Any]],
    *,
    exclude_ids: Optional[Sequence[str]] = None,
    limit: int = 15,
) -> Tuple[List[Dict[str, Any]], bool]:
    """Score + sort candidates; return (top batch, has_more)."""
    exclude = {str(x) for x in (exclude_ids or []) if x}
    clusters = _cluster_counts(pois)
    scored = []
    for p in pois:
        sid = str(p.get("id") or stop_key(p))
        if sid in exclude:
            continue
        # Also skip osm-key form if present in exclude
        alt = stop_key(p)
        if alt in exclude or f"area-{p.get('osmType', 'node')}-{p.get('osmId', 0)}" in exclude:
            continue
        s = score_stop(p, nearby_count=clusters.get(stop_key(p), 0))
        if p.get("reviewStatus") == "verified":
            continue
        scored.append(s)

    scored.sort(
        key=lambda s: (
            0 if s.get("priority") else 1,
            -(s.get("resupplyScore") or 0),
            -(s.get("qualityScore") or 0),
            s.get("distanceOffRouteM") or 999,
        )
    )
    batch = scored[: max(0, limit)]
    has_more = len(scored) > len(batch)
    return batch, has_more


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
            -(s.get("resupplyScore") or 0),
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
        if s.get("category") in _DINING and (s.get("resupplyScore") or 0) < 55:
            continue
        # Skip large hypers when better options exist.
        if s.get("storeSize") == "large" and s.get("category") == "Supermarket":
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
            if s.get("category") in _DINING and (s.get("resupplyScore") or 0) < 50:
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
