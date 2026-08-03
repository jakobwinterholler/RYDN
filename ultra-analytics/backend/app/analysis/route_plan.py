"""Planning intelligence for Planned Routes — climbs, stages, remote gaps.

Climb detection uses descent-from-summit segmentation (roadbook approach)
so long undulating cols stay one climb instead of fragmenting on false flats.
"""

from __future__ import annotations

import bisect
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .helpers import interpolate

# Tuned for ultra course GPX (aligned with parent climb_detector + ride review).
_GRID_M = 100.0
_MIN_GAIN_M = 50.0
_MIN_LEN_M = 500.0
_MIN_AVG_GRADE = 3.0
_UP_GRADE = 1.0
_DESCENT_END_M = 50.0  # end climb after this much descent from summit
_GRADE_SMOOTH = 2  # ±cells for grade mean


def _track_arrays(track: Sequence[Sequence[Any]]) -> Tuple[List[float], List[float], List[float], List[float]]:
    lats: List[float] = []
    lons: List[float] = []
    eles: List[float] = []
    dists: List[float] = []
    for row in track:
        if len(row) < 2:
            continue
        lat, lon = float(row[0]), float(row[1])
        ele = row[2] if len(row) > 2 else None
        dist = float(row[3]) if len(row) > 3 else (dists[-1] if dists else 0.0)
        lats.append(lat)
        lons.append(lon)
        if ele is not None and isinstance(ele, (int, float)):
            eles.append(float(ele))
        else:
            eles.append(float("nan"))
        dists.append(dist)
    return lats, lons, eles, dists


def _interp(xs: List[float], ys: List[float], x: float) -> Optional[float]:
    return interpolate(xs, ys, x)


def point_at_km(track: Sequence[Sequence[Any]], km: float) -> Optional[Tuple[float, float]]:
    if not track:
        return None
    best = None
    best_d = float("inf")
    for row in track:
        if len(row) < 4:
            continue
        d = abs(float(row[3]) - km)
        if d < best_d:
            best_d = d
            best = (float(row[0]), float(row[1]))
    if best:
        return best
    row = track[min(len(track) - 1, max(0, int(km)))]
    return (float(row[0]), float(row[1])) if len(row) >= 2 else None


def _passes_gradient(length_km: float, gain: float, avg: float, max_g: float) -> bool:
    if avg >= _MIN_AVG_GRADE:
        return True
    if gain < _MIN_GAIN_M or length_km <= 0:
        return False
    # Reject long near-flat DEM noise that only spiked briefly.
    if avg < 1.8 and length_km > 6:
        return False
    # Undulating cols: average diluted by recoveries, but steep pitches matter.
    if max_g >= 5.0 and length_km >= 1.0 and gain >= 150 and avg >= 1.8:
        return True
    if max_g >= 6.0 and length_km >= 0.75 and gain >= _MIN_GAIN_M and avg >= 2.0:
        return True
    return False


def _difficulty(gain: float, avg: float, length_km: float, max_g: float) -> Dict[str, Any]:
    """0–100 difficulty score for planning priority."""
    score = (
        min(gain, 1500) / 1500 * 45
        + min(avg, 12) / 12 * 25
        + min(max_g, 18) / 18 * 15
        + min(length_km, 20) / 20 * 15
    )
    score = round(max(0, min(100, score)))
    if score >= 75:
        label = "Brutal"
    elif score >= 55:
        label = "Hard"
    elif score >= 35:
        label = "Serious"
    else:
        label = "Notable"
    return {"difficultyScore": score, "difficultyLabel": label}


def detect_route_climbs(track: Sequence[Sequence[Any]]) -> List[Dict[str, Any]]:
    """Significant climbs — descent-ended segments with pitch exceptions."""
    _, _, eles_raw, dists_km = _track_arrays(track)
    pairs = [(d * 1000.0, e) for d, e in zip(dists_km, eles_raw) if e == e]
    if len(pairs) < 8:
        return []
    dist_m = [p[0] for p in pairs]
    ele = [p[1] for p in pairs]
    total_m = dist_m[-1]
    if total_m < _MIN_LEN_M:
        return []

    grid: List[float] = []
    grid_ele: List[float] = []
    x = dist_m[0]
    while x <= total_m:
        v = _interp(dist_m, ele, x)
        if v is not None:
            grid.append(x)
            grid_ele.append(v)
        x += _GRID_M
    if len(grid) < 5:
        return []

    raw_grades: List[float] = [0.0]
    for i in range(1, len(grid)):
        dd = grid[i] - grid[i - 1]
        raw_grades.append(((grid_ele[i] - grid_ele[i - 1]) / dd) * 100.0 if dd > 0 else 0.0)

    grades: List[float] = []
    for i in range(len(raw_grades)):
        lo = max(0, i - _GRADE_SMOOTH)
        hi = min(len(raw_grades), i + _GRADE_SMOOTH + 1)
        grades.append(sum(raw_grades[lo:hi]) / (hi - lo))

    climbs: List[Dict[str, Any]] = []
    n = len(grid)
    i = 0
    while i < n:
        if grades[i] < _UP_GRADE:
            i += 1
            continue
        start = i
        summit = i
        summit_ele = grid_ele[i]
        j = i + 1
        while j < n:
            if grid_ele[j] >= summit_ele:
                summit = j
                summit_ele = grid_ele[j]
            # End when we've descended meaningfully from the running summit
            # and we're no longer in a sustained uphill.
            descent = summit_ele - grid_ele[j]
            if descent >= _DESCENT_END_M and grades[j] < _UP_GRADE:
                break
            j += 1
        end = summit
        i = max(end + 1, j)

        if end <= start:
            continue
        length_m = grid[end] - grid[start]
        gain = 0.0
        max_g = 0.0
        for k in range(start + 1, end + 1):
            de = grid_ele[k] - grid_ele[k - 1]
            if de > 0:
                gain += de
            max_g = max(max_g, grades[k], raw_grades[k])
        length_km = length_m / 1000.0
        avg = (gain / length_m) * 100.0 if length_m > 0 else 0.0
        if gain < _MIN_GAIN_M or length_m < _MIN_LEN_M:
            continue
        if not _passes_gradient(length_km, gain, avg, max_g):
            continue

        vam = 700.0 if avg < 6 else 550.0 if avg < 9 else 420.0
        est_s = (gain / vam) * 3600.0 if vam > 0 else None
        start_km = grid[start] / 1000.0
        end_km = grid[end] / 1000.0
        start_ll = point_at_km(track, start_km)
        end_ll = point_at_km(track, end_km)
        diff = _difficulty(gain, avg, length_km, max_g)
        climbs.append(
            {
                "id": f"climb-{len(climbs) + 1}",
                "name": f"Climb · km {round(start_km)}",
                "startKm": round(start_km, 2),
                "endKm": round(end_km, 2),
                "lengthKm": round(length_km, 2),
                "elevationGainM": round(gain),
                "avgGradientPct": round(avg, 1),
                "maxGradientPct": round(max_g, 1),
                "estimatedClimbTimeS": round(est_s) if est_s else None,
                "hard": False,
                "startLat": round(start_ll[0], 5) if start_ll else None,
                "startLon": round(start_ll[1], 5) if start_ll else None,
                "endLat": round(end_ll[0], 5) if end_ll else None,
                "endLon": round(end_ll[1], 5) if end_ll else None,
                **diff,
            }
        )

    if climbs:
        scored = sorted(
            climbs,
            key=lambda c: c["difficultyScore"],
            reverse=True,
        )
        n_hard = max(1, min(8, len(scored) // 4 + 1))
        hard_ids = {c["id"] for c in scored[:n_hard]}
        for c in climbs:
            c["hard"] = c["id"] in hard_ids
    return climbs


def elevation_profile(track: Sequence[Sequence[Any]], max_points: int = 400) -> List[List[float]]:
    _, _, eles, dists = _track_arrays(track)
    pts = [[d, e] for d, e in zip(dists, eles) if e == e]
    if len(pts) <= max_points:
        return [[round(p[0], 2), round(p[1])] for p in pts]
    step = len(pts) / max_points
    out = []
    i = 0.0
    while int(i) < len(pts) and len(out) < max_points:
        p = pts[int(i)]
        out.append([round(p[0], 2), round(p[1])])
        i += step
    return out


def remote_gaps_from_services(
    *,
    water_kms: List[float],
    food_kms: List[float],
    service_kms: List[float],
    sleep_kms: List[float],
    total_km: float,
    track: Optional[Sequence[Sequence[Any]]] = None,
    min_gap_km: float = 40.0,
) -> List[Dict[str, Any]]:
    """Meaningful remote stretches only — tiny 15–20 km gaps are noise."""
    if total_km <= 0:
        return []

    def gaps_for(marks: List[float]) -> List[Tuple[float, float]]:
        pts = sorted({0.0, *[float(k) for k in marks if 0 <= k <= total_km], total_km})
        return [(a, b) for a, b in zip(pts, pts[1:]) if b - a >= min_gap_km]

    combined = sorted(set(water_kms) | set(food_kms) | set(service_kms))
    raw = gaps_for(combined if combined else service_kms)

    # Merge overlapping / adjacent gaps (< 12 km apart).
    merged: List[Tuple[float, float]] = []
    for a, b in raw:
        if merged and a - merged[-1][1] < 12:
            merged[-1] = (merged[-1][0], b)
        else:
            merged.append((a, b))

    gaps: List[Dict[str, Any]] = []
    for a, b in merged:
        dist = b - a
        if dist < min_gap_km:
            continue
        if dist >= 80:
            risk = "extreme"
            prep = "Carry 2L+ water and a full day of food. Expect no shops or fountains."
        elif dist >= 60:
            risk = "critical"
            prep = "Fill both bottles and pack spare food before entering this stretch."
        elif dist >= 45:
            risk = "high"
            prep = "Top up water and calories at the last stop before this gap."
        else:
            risk = "moderate"
            prep = "Don't skip the last reliable stop — next options are thin."

        eta_h = dist / 22.0
        mid = (a + b) / 2.0
        mid_ll = point_at_km(track, mid) if track else None
        gaps.append(
            {
                "id": f"gap-{round(a)}-{round(b)}",
                "startKm": round(a, 1),
                "endKm": round(b, 1),
                "distanceKm": round(dist, 1),
                "estimatedRideTimeS": round(eta_h * 3600),
                "riskLevel": risk,
                "label": f"km {a:.0f}–{b:.0f} · {dist:.0f} km without resupply",
                "preparation": prep,
                "missing": {
                    "water": not any(a < w < b for w in water_kms),
                    "food": not any(a < f < b for f in food_kms),
                    "sleep": not any(a < s < b for s in sleep_kms),
                    "bikeShop": True,
                },
                "midLat": round(mid_ll[0], 5) if mid_ll else None,
                "midLon": round(mid_ll[1], 5) if mid_ll else None,
            }
        )
    return gaps


# Back-compat alias
def remote_gaps_from_service_kms(
    service_kms: List[float],
    total_km: float,
    *,
    min_gap_km: float = 15.0,
    track: Optional[Sequence[Sequence[Any]]] = None,
) -> List[Dict[str, Any]]:
    return remote_gaps_from_services(
        water_kms=service_kms,
        food_kms=service_kms,
        service_kms=service_kms,
        sleep_kms=[],
        total_km=total_km,
        track=track,
        min_gap_km=min_gap_km,
    )


def suggest_stages(
    total_km: float,
    elev_by_km: List[Tuple[float, float]],
    *,
    target_km: float = 250.0,
    snap_kms: Optional[List[float]] = None,
    climb_starts: Optional[List[float]] = None,
    hard_climb_kms: Optional[List[Tuple[float, float]]] = None,
) -> List[Dict[str, Any]]:
    """Stage breaks: distance target + sleep/food snaps, avoid splitting hard climbs."""
    if total_km <= 0:
        return []
    if total_km < 200:
        target_km = min(target_km, max(60.0, total_km / 2))
    elif total_km < 500:
        target_km = min(target_km, 180.0)

    snaps = sorted(snap_kms or [])
    hard = hard_climb_kms or []

    def elev_between(a: float, b: float) -> float:
        gain = 0.0
        prev = None
        for km, ele in elev_by_km:
            if km < a:
                prev = ele
                continue
            if km > b:
                break
            if prev is not None and ele > prev:
                gain += ele - prev
            prev = ele
        return gain

    def effort_cost(a: float, b: float) -> float:
        """Distance + elevation penalty — prefer breaking before heavy climbing days."""
        return (b - a) + elev_between(a, b) / 10.0

    def in_hard_climb(km: float) -> bool:
        return any(s + 2 < km < e - 1 for s, e in hard)

    breaks: List[float] = [0.0]
    cursor = 0.0
    while cursor + target_km * 0.5 < total_km:
        ideal = cursor + target_km
        if ideal >= total_km - 35:
            break
        # Prefer lower effort remaining in day — nudge earlier if next day has a hard climb soon.
        candidates = [ideal]
        window = [s for s in snaps if ideal - 40 <= s <= ideal + 50]
        candidates.extend(window)
        # Avoid ending mid-climb
        scored_c = []
        for c in candidates:
            if c <= cursor + 35:
                continue
            if in_hard_climb(c):
                continue
            # Prefer sleep snaps; slight penalty for pure distance ideal
            sleep_bonus = -8 if c in snaps else 0
            # Prefer ending before a hard climb that starts soon after
            ahead = [s for s, _e in hard if c < s < c + 80]
            before_climb = -12 if ahead else 0
            score = abs(c - ideal) + sleep_bonus + before_climb + effort_cost(cursor, c) * 0.02
            scored_c.append((score, c))
        if not scored_c:
            snapped = ideal
        else:
            snapped = min(scored_c, key=lambda t: t[0])[1]
        reason_bits = []
        if any(abs(snapped - s) < 1 for s in snaps):
            reason_bits.append("near sleep/resupply")
        if any(snapped < s < snapped + 80 for s, _ in hard):
            reason_bits.append("before a hard climb")
        breaks.append(round(snapped, 1))
        cursor = snapped
    breaks.append(round(total_km, 1))

    clean: List[float] = []
    for b in breaks:
        if not clean or b - clean[-1] >= 25:
            clean.append(b)
    if clean[-1] < total_km - 1:
        clean.append(round(total_km, 1))

    stages: List[Dict[str, Any]] = []
    for idx, (a, b) in enumerate(zip(clean, clean[1:]), start=1):
        reason = f"~{int(target_km)} km target"
        near_snap = any(abs(b - s) < 2 for s in snaps)
        if near_snap:
            reason = "Break near sleep/resupply"
        if any(b < s < b + 80 for s, _ in hard):
            reason = "Rest before a hard climb" if near_snap else "Positioned before a hard climb"
        stages.append(
            {
                "index": idx,
                "label": f"Day {idx}",
                "startKm": a,
                "endKm": b,
                "distanceKm": round(b - a, 1),
                "elevationGainM": round(elev_between(a, b)),
                "reason": reason,
            }
        )
    return stages
