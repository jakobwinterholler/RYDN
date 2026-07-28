"""Orchestrate Planned Route analysis for the Verify page (Planning 2.0)."""

from __future__ import annotations

import time
from typing import Any, Dict, List, Optional, Sequence

from .route_decisions import build_critical_decisions
from .route_plan import (
    detect_route_climbs,
    elevation_profile,
    remote_gaps_from_services,
    suggest_stages,
)
from .route_pois import fetch_route_pois
from .route_stops import select_recommended_stops, stop_key
from .route_weather import fetch_route_weather


def _sleep_near_stages(
    stages: List[Dict[str, Any]], sleep: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    if not stages or not sleep:
        return []
    out: List[Dict[str, Any]] = []
    for stage in stages[:-1]:
        end_km = float(stage["endKm"])
        near = sorted(sleep, key=lambda p: abs(float(p["distanceAlongKm"]) - end_km))
        pick = near[0] if near and abs(float(near[0]["distanceAlongKm"]) - end_km) <= 45 else None
        if pick:
            pick = {**pick, "id": stop_key(pick)}
        out.append(
            {
                "stageIndex": stage["index"],
                "stageLabel": stage["label"],
                "targetKm": end_km,
                "suggestion": pick,
                "note": (
                    f"Nearest sleep ~{abs(float(pick['distanceAlongKm']) - end_km):.0f} km from day end"
                    if pick
                    else "No sleep POI within 45 km of this stage end — wild camping or move the break."
                ),
            }
        )
    return out


def _decision_weather(weather: Dict[str, Any] | None) -> Dict[str, Any] | None:
    """Keep only forecast days that change planning decisions."""
    if not weather or weather.get("status") != "ok":
        return weather
    days = weather.get("days") or []
    alerts = []
    for d in days:
        reasons = []
        tmax = d.get("tempMaxC")
        tmin = d.get("tempMinC")
        precip = d.get("precipMm") or 0
        wind = d.get("windMaxKmh") or 0
        code = d.get("weatherCode")
        if tmax is not None and tmax >= 32:
            reasons.append("extreme heat")
        if tmin is not None and tmin <= 5:
            reasons.append("cold night")
        if wind >= 40:
            reasons.append("strong wind")
        if precip >= 8:
            reasons.append("wet weather")
        if code in (95, 96, 99):
            reasons.append("thunderstorms")
        if reasons:
            alerts.append({**d, "decisionReasons": reasons})
    return {
        **weather,
        "days": days,
        "decisionAlerts": alerts,
        "hasDecisionWeather": bool(alerts),
    }


def analyze_planned_route(
    route: dict,
    *,
    force_refresh: bool = False,
    target_stage_km: float = 250.0,
) -> Dict[str, Any]:
    track: Sequence[Sequence[Any]] = route.get("track") or []
    if not track:
        pts = route.get("points") or []
        # Never use index-as-km — caller should heal first; last-resort geometry only.
        from .route_elevation import points_to_track

        track = points_to_track(pts) if pts else []

    started = time.time()
    elev_n = sum(1 for r in track if len(r) > 2 and isinstance(r[2], (int, float)))
    climbs = detect_route_climbs(track)
    climbs = sorted(climbs, key=lambda c: (-float(c.get("difficultyScore") or 0), c["startKm"]))
    profile = elevation_profile(track)
    elev_pairs = [(float(p[0]), float(p[1])) for p in profile]

    poi_bundle = fetch_route_pois(track, force_refresh=force_refresh)
    pois = poi_bundle.get("pois") or []
    sleep = poi_bundle.get("sleep") or []
    reviews = route.get("stopReviews") or {}

    water_kms = [float(p["distanceAlongKm"]) for p in pois if p.get("group") == "water"]
    food_kms = [
        float(p["distanceAlongKm"])
        for p in pois
        if p.get("group") in ("resupply", "dining") or p.get("category") == "Gas station"
    ]
    service_kms = [
        float(p["distanceAlongKm"])
        for p in pois
        if p.get("group") in ("resupply", "water", "dining", "service")
    ]
    sleep_kms = [float(p["distanceAlongKm"]) for p in sleep]

    total_km = float(
        route.get("distanceKm")
        or (track[-1][3] if track and len(track[-1]) > 3 else 0)
        or 0
    )

    gaps = remote_gaps_from_services(
        water_kms=water_kms,
        food_kms=food_kms,
        service_kms=service_kms,
        sleep_kms=sleep_kms,
        total_km=total_km,
        track=track,
    )

    recommended = select_recommended_stops(
        pois, sleep, total_km=total_km, reviews=reviews
    )
    # Keep rejected in Planning so Verify/map can show status colours.
    # Ride mode filters to verified only on the client.

    snap_kms = [
        float(p["distanceAlongKm"])
        for p in sleep + [x for x in pois if x.get("group") == "resupply"]
    ]
    hard_climbs = [(float(c["startKm"]), float(c["endKm"])) for c in climbs if c.get("hard")]
    target = max(40.0, min(400.0, float(target_stage_km or 250.0)))
    stages = suggest_stages(
        total_km,
        elev_pairs,
        target_km=target,
        snap_kms=snap_kms,
        hard_climb_kms=hard_climbs,
    )
    sleep_plan = _sleep_near_stages(stages, sleep)

    weather = _decision_weather(
        fetch_route_weather(
            track,
            date_start=route.get("dateStart"),
            date_end=route.get("dateEnd"),
            total_km=total_km,
        )
    )

    decisions = build_critical_decisions(
        recommended=recommended,
        climbs=climbs,
        remote_gaps=gaps,
        stages=stages,
        sleep_plan=sleep_plan,
        total_km=total_km,
    )

    empty: Dict[str, Optional[str]] = {
        "climbs": None,
        "stops": None,
        "decisions": None,
        "remote": None,
    }
    if not climbs:
        if elev_n < 8:
            empty["climbs"] = (
                "No climbs were detected because elevation data is missing on this course. "
                "Re-import the GPX with elevation, or refresh so RYDN can heal elev from terrain data."
            )
        elif int(route.get("elevationGainM") or 0) < 150:
            empty["climbs"] = "This course is relatively flat — no sustained climbs met the significance thresholds."
        else:
            empty["climbs"] = (
                "Elevation is present but no sustained climbs passed the filters. "
                "Try Refresh — if this persists, the elev profile may be too smoothed."
            )
    if not recommended:
        if poi_bundle.get("error"):
            empty["stops"] = (
                f"No stop recommendations yet because map data could not be loaded ({poi_bundle.get('error')}). "
                "Refresh when you have connectivity."
            )
        else:
            empty["stops"] = "OpenStreetMap returned no reliable services near this track."
    if not decisions:
        empty["decisions"] = (
            "Critical decisions appear once climbs, remote gaps, or overnight suggestions are available."
        )
    if not gaps:
        empty["remote"] = "No long resupply gaps (≥40 km) — services look reasonably spaced."

    insights: List[str] = []
    if climbs:
        hard = [c for c in climbs if c.get("hard")]
        insights.append(
            f"{len(climbs)} significant climb{'s' if len(climbs) != 1 else ''}"
            + (f" — hardest listed first." if hard else ".")
        )
    else:
        insights.append(empty["climbs"] or "No significant climbs detected.")

    if recommended:
        insights.append(
            f"{len(recommended)} recommended stop{'s' if len(recommended) != 1 else ''} — scored and spaced for this Ultra."
        )
    elif empty["stops"]:
        insights.append(empty["stops"])

    if decisions:
        insights.append(f"{len(decisions)} critical decision{'s' if len(decisions) != 1 else ''} to review.")
    if gaps:
        worst = max(gaps, key=lambda g: g["distanceKm"])
        insights.append(
            f"Longest remote stretch: {worst['distanceKm']:.0f} km "
            f"(km {worst['startKm']:.0f}–{worst['endKm']:.0f})."
        )
    if stages:
        insights.append(f"{len(stages)} stage{'s' if len(stages) != 1 else ''} suggested from terrain and sleep.")
    if weather and weather.get("hasDecisionWeather"):
        insights.append(
            f"{len(weather['decisionAlerts'])} weather alert{'s' if len(weather['decisionAlerts']) != 1 else ''} that change decisions."
        )

    verified = sum(1 for s in recommended if s.get("reviewStatus") == "verified")

    return {
        "routeId": route.get("id"),
        "status": "ready",
        "schemaVersion": 2,
        "computedAt": time.time(),
        "durationS": round(time.time() - started, 2),
        "targetStageKm": target,
        "cache": {"poi": poi_bundle.get("cache") or "skipped"},
        "poiError": poi_bundle.get("error"),
        "emptyReasons": empty,
        "summary": {
            "distanceKm": round(total_km, 1),
            "elevationGainM": int(route.get("elevationGainM") or 0),
            "climbCount": len(climbs),
            "recommendedStopCount": sum(
                1 for s in recommended if s.get("reviewStatus") != "rejected"
            ),
            "verifiedStopCount": verified,
            "criticalDecisionCount": len(decisions),
            "remoteGapCount": len(gaps),
            "longestRemoteGapKm": max((g["distanceKm"] for g in gaps), default=None),
            "stageCount": len(stages),
            "hasElevation": elev_n >= 8,
        },
        "insights": insights,
        "profile": profile,
        "climbs": climbs,
        "recommendedStops": recommended,
        "sleep": sleep[:80],  # capped — never dump thousands to the client
        "sleepPlan": sleep_plan,
        "remoteGaps": gaps,
        "stages": stages,
        "criticalDecisions": decisions,
        "weather": weather,
        "stopReviews": reviews,
    }
