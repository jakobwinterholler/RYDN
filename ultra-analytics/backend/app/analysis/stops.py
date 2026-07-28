"""Stops — 'Where did I stop, why, and which stops were unnecessary?'

Classification is **behaviour-first** (see ``stop_classifier.py``): the category
is earned from what the rider did — how long they were stationary, whether the
device stopped recording, time of day — not from what happened to be nearby. A
nearby hotel can only *support* a hotel/sleep call, never make one. When the
evidence is weak we return **unknown** rather than guess. External signals
(POIs, Roadbook/Companion verified stops, rider corrections) plug into the
classifier without changing this module.
"""

from __future__ import annotations

import bisect
from typing import List, Optional

from .helpers import fmt_clock, fmt_duration
from .prepare import PreparedRide, Segment
from .stop_classifier import _LABELS, StopFeatures, classify
from ..util.geo import is_night, local_hour

MIN_STOP_S = 120.0
MERGE_GAP_S = 45.0  # roll-and-stop-again counts as one stop


def _ele_at(ride: PreparedRide, target_m: float) -> Optional[float]:
    if not ride.dist:
        return None
    i = bisect.bisect_left(ride.dist, target_m)
    i = min(max(i, 0), ride.n - 1)
    return ride.ele[i]


def _ele_range(ride: PreparedRide):
    vals = [e for e in ride.ele if e is not None]
    if not vals:
        return None, None
    return min(vals), max(vals)


def analyze_stops(ride: PreparedRide) -> dict:
    # Group consecutive non-moving segments into stop runs.
    runs: List[List[Segment]] = []
    current: List[Segment] = []
    for seg in ride.segments:
        if not seg.moving:
            current.append(seg)
        else:
            if current:
                runs.append(current)
                current = []
    if current:
        runs.append(current)

    raw = []
    for run in runs:
        dur = sum(s.dur for s in run)
        if dur < MIN_STOP_S:
            continue
        raw.append(
            {
                "t0": run[0].t0,
                "t1": run[-1].t1,
                "dur": dur,
                "lat": run[0].lat,
                "lon": run[0].lon,
                "km": run[0].km,
                "is_gap": any(s.is_gap for s in run),
            }
        )

    # Merge stops separated by a tiny move.
    merged = []
    for st in raw:
        if merged and st["t0"] - merged[-1]["t1"] < MERGE_GAP_S:
            prev = merged[-1]
            prev["t1"] = st["t1"]
            prev["dur"] = prev["t1"] - prev["t0"]
            prev["is_gap"] = prev["is_gap"] or st["is_gap"]
        else:
            merged.append(st)

    _, ele_max = _ele_range(ride)
    ele_min, _ = _ele_range(ride)
    high_threshold = None
    if ele_max is not None and ele_min is not None and ele_max > ele_min:
        high_threshold = ele_min + 0.85 * (ele_max - ele_min)

    start_t = ride.t[0] if ride.t else 0.0
    short_durations = [s["dur"] for s in merged if s["dur"] < 40 * 60]
    short_durations.sort()
    median_short = short_durations[len(short_durations) // 2] if short_durations else None

    stops = []
    total_stopped = 0.0
    for i, st in enumerate(merged, start=1):
        # A long stop that starts in the afternoon can still be an overnight
        # sleep — judge night by the middle of the stop, not its start.
        midpoint = (st["t0"] + st["t1"]) / 2.0
        night = is_night(midpoint, st["lon"])
        ele = _ele_at(ride, st["km"] * 1000.0)
        high_point = (
            high_threshold is not None and ele is not None and ele >= high_threshold
        )
        features = StopFeatures(
            duration_s=st["dur"],
            local_hour=local_hour(st["t0"], st["lon"]),
            night=night,
            is_gap=st["is_gap"],
            high_point=high_point,
            elevation_m=ele,
            # external/authoritative signals: none in Phase 1, but the pipeline is
            # ready for Roadbook verified stops, Google Places and rider corrections.
        )
        category, conf, reasons = classify(features)
        hint = reasons[0] if reasons else "stop"
        total_stopped += st["dur"]

        efficiency = None
        if st["dur"] < 40 * 60 and median_short:
            if st["dur"] <= median_short * 1.1:
                efficiency = "efficient"
            elif st["dur"] >= median_short * 2.0:
                efficiency = "long"
            else:
                efficiency = "typical"

        stops.append(
            {
                "index": i,
                "km": round(st["km"], 1),
                "tStart": round(st["t0"]),
                "tEnd": round(st["t1"]),
                "atElapsed": fmt_clock(st["t0"] - start_t),
                "localHour": round(local_hour(st["t0"], st["lon"]), 1),
                "partOfDay": "night" if night else "day",
                "durationS": round(st["dur"]),
                "durationLabel": fmt_duration(st["dur"]),
                "category": category,
                "confidence": round(conf, 2),
                "hint": hint,
                "reasons": reasons,
                "efficiency": efficiency,
                "lat": round(st["lat"], 5) if st["lat"] is not None else None,
                "lon": round(st["lon"], 5) if st["lon"] is not None else None,
            }
        )

    insight = _stops_insight(stops, total_stopped)
    return {
        "question": "Where did I stop, why, and which stops were unnecessary?",
        "stops": stops,
        "count": len(stops),
        "totalStoppedS": round(total_stopped),
        "insight": insight,
        "cadence": _resupply_cadence(ride, stops),
    }


# Shorter than this, a stop is a brief break (smoke, drink, photo, nature) rather
# than a genuine resupply. Without POI/purchase data we cannot tell a 3-minute
# shop stop from a cigarette, so cadence is measured on substantial supply stops
# only — and the excluded brief breaks are reported for full transparency.
RESUPPLY_MIN_S = 300.0  # 5 min
# Categories that are never a resupply, regardless of length.
_NON_SUPPLY = {"sleep", "hotel", "scenic", "mechanical", "traffic"}


def _gain_between(ride: PreparedRide, m0: float, m1: float) -> float:
    """Positive elevation gain accumulated between two distances along the route."""
    if m1 <= m0:
        return 0.0
    lo = bisect.bisect_left(ride.dist, m0)
    hi = bisect.bisect_right(ride.dist, m1)
    gain = 0.0
    prev = None
    for i in range(max(0, lo - 1), min(ride.n, hi + 1)):
        e = ride.ele[i]
        if e is None:
            continue
        if prev is not None and e > prev:
            gain += e - prev
        prev = e
    return gain


def _resupply_cadence(ride: PreparedRide, stops: List[dict]) -> dict:
    supply = [
        s for s in stops
        if s["durationS"] >= RESUPPLY_MIN_S and s["category"] not in _NON_SUPPLY
    ]
    brief = [
        s for s in stops
        if s["durationS"] < RESUPPLY_MIN_S and s["category"] not in ("sleep", "hotel")
    ]

    legs = []
    for a, b in zip(supply, supply[1:]):
        dist_km = max(0.0, b["km"] - a["km"])
        gain = _gain_between(ride, a["km"] * 1000.0, b["km"] * 1000.0)
        legs.append(
            {
                "fromIndex": a["index"],
                "toIndex": b["index"],
                "fromKm": a["km"],
                "toKm": b["km"],
                "distanceKm": round(dist_km, 1),
                "gainM": round(gain),
            }
        )

    base = {
        "question": "How far do I ride between resupplies?",
        "resupplyCount": len(supply),
        "briefBreaksExcluded": len(brief),
        "thresholdMin": round(RESUPPLY_MIN_S / 60),
        "legs": legs,
    }

    if not legs:
        base["available"] = False
        base["avgDistanceKm"] = None
        base["avgGainM"] = None
        base["insight"] = (
            "Not enough resupply stops to measure spacing"
            + (f" — {len(brief)} brief breaks (smoke/drink/photo) were excluded." if brief else ".")
        )
        return base

    avg_d = sum(l["distanceKm"] for l in legs) / len(legs)
    avg_g = sum(l["gainM"] for l in legs) / len(legs)
    longest = max(legs, key=lambda l: l["distanceKm"])
    shortest = min(legs, key=lambda l: l["distanceKm"])

    excluded_note = (
        f" {len(brief)} brief break(s) under {round(RESUPPLY_MIN_S / 60)} min "
        f"(smoke/drink/photo) were not counted as resupplies."
        if brief
        else ""
    )
    base.update(
        {
            "available": True,
            "avgDistanceKm": round(avg_d, 1),
            "avgGainM": round(avg_g),
            "longestKm": longest["distanceKm"],
            "shortestKm": shortest["distanceKm"],
            "insight": (
                f"Across {len(supply)} resupply stops you rode on average "
                f"{avg_d:.0f} km and climbed {round(avg_g)} m between each. "
                f"Your longest dry stretch was {longest['distanceKm']:.0f} km "
                f"(km {longest['fromKm']:.0f}→{longest['toKm']:.0f})." + excluded_note
            ),
        }
    )
    return base


def _stops_insight(stops: List[dict], total_stopped: float) -> Optional[str]:
    if not stops:
        return "No significant stops detected — a remarkably continuous effort."
    longest = max(stops, key=lambda s: s["durationS"])
    resupply = [s for s in stops if s["durationS"] < 40 * 60]
    long_resupply = [s for s in resupply if s["efficiency"] == "long"]
    longest_label = _LABELS.get(longest["category"], longest["category"])
    parts = [
        f"You stopped {len(stops)} times for a total of {fmt_duration(total_stopped)}. "
        f"Your longest stop was {longest['durationLabel']} at km {longest['km']} "
        f"({longest_label})."
    ]
    if long_resupply:
        wasted = sum(s["durationS"] for s in long_resupply)
        parts.append(
            f" {len(long_resupply)} resupply stop(s) ran roughly twice your typical length "
            f"(~{fmt_duration(wasted)} combined) — the clearest place to claw back time. "
            f"Recommendation: pre-plan what you buy and keep short stops under a few minutes."
        )
    return "".join(parts)
