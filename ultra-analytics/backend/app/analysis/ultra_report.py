"""Ultra-level analysis — one expedition, one stitched report.

Members are chronological Activities. ``prepare_ride`` already stitches gaps
between recordings (overnight, pauses, multi-takes). This module:

1. Ensures each member has cached samples (re-fetch Strava when needed)
2. Builds one ``Race`` → ``build_report``
3. Adds Ultra-specific aggregation + day hours + validation vs day sums
4. Caches beside the Ultra JSON

Assumptions (documented for the product):
- Ultra elapsed = last member end − first member start (hotels, sleep, cafés, gaps).
- Ride elapsed = sum of each day's own elapsed time (excludes inter-day gaps).
- Moving time = sum of each day's moving time.
- Distance, elevation gain, and moving time must match the sum of member days
  (within tolerance). Ultra elapsed intentionally does not match ride-elapsed sum.
- Riding days / dayHours group by calendar day: same-day recordings merge into
  one day (recordingCount > 1). Library files remain separate.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional, Tuple

from .. import store
from .. import ultras as ultra_store
from ..models import Activity, Race
from .helpers import fmt_duration, safe_max, safe_min
from .report import ANALYSIS_SCHEMA, build_report

ULTRA_ANALYSIS_SCHEMA = 3

# Validation tolerances — GPS/rounding noise across day reports vs stitch.
_DIST_TOL_KM = 2.0
_ELEV_TOL_M = 25.0
_MOVING_TOL_S = 120.0


def _iso_day(iso: Optional[str]) -> Optional[str]:
    if not iso:
        return None
    s = str(iso).strip()
    return s[:10] if len(s) >= 10 else s or None


def _member_fingerprint(uid: str, activity_ids: List[str]) -> List[dict]:
    out = []
    for aid in activity_ids:
        payload = store.get_ride_payload(uid, aid) or {}
        out.append(
            {
                "id": aid,
                "savedAt": payload.get("savedAt"),
                "hasActivities": bool(payload.get("activities")),
            }
        )
    return out


def _cache_fresh(cache: dict, ultra: dict, fingerprint: List[dict]) -> bool:
    if int(cache.get("ultraAnalysisSchema") or 0) < ULTRA_ANALYSIS_SCHEMA:
        return False
    if int(cache.get("analysisSchema") or 0) < ANALYSIS_SCHEMA:
        return False
    if cache.get("activityIds") != list(ultra.get("activityIds") or []):
        return False
    if cache.get("memberFingerprint") != fingerprint:
        return False
    return True


def _sum_member_overviews(uid: str, activity_ids: List[str]) -> dict:
    distance = 0.0
    elev = 0.0
    elev_loss = 0.0
    moving = 0.0
    elapsed = 0.0
    stopped = 0.0
    missing = []
    for aid in activity_ids:
        report = store.get_ride(uid, aid)
        if not report:
            missing.append(aid)
            continue
        ov = report.get("overview") or {}
        distance += float(ov.get("distanceKm") or 0)
        elev += float(ov.get("elevationGainM") or 0)
        elev_loss += float(ov.get("elevationLossM") or 0)
        moving += float(ov.get("movingTimeS") or 0)
        elapsed += float(ov.get("elapsedTimeS") or 0)
        stopped += float(ov.get("stoppedTimeS") or 0)
    return {
        "distanceKm": round(distance, 1),
        "elevationGainM": round(elev),
        "elevationLossM": round(elev_loss),
        "movingTimeS": round(moving),
        "elapsedTimeS": round(elapsed),
        "stoppedTimeS": round(stopped),
        "missing": missing,
    }


def _validate(stitched_ov: dict, day_sum: dict) -> dict:
    checks = []

    def check(key: str, a: float, b: float, tol: float, unit: str) -> None:
        delta = abs(float(a) - float(b))
        ok = delta <= tol
        checks.append(
            {
                "metric": key,
                "stitched": a,
                "sumOfDays": b,
                "delta": round(delta, 3),
                "tolerance": tol,
                "unit": unit,
                "ok": ok,
            }
        )

    check("distanceKm", stitched_ov.get("distanceKm") or 0, day_sum["distanceKm"], _DIST_TOL_KM, "km")
    check(
        "elevationGainM",
        stitched_ov.get("elevationGainM") or 0,
        day_sum["elevationGainM"],
        _ELEV_TOL_M,
        "m",
    )
    check(
        "movingTimeS",
        stitched_ov.get("movingTimeS") or 0,
        day_sum["movingTimeS"],
        _MOVING_TOL_S,
        "s",
    )
    # Elapsed is intentionally not required to match — overnight gaps count for Ultras.
    return {
        "ok": all(c["ok"] for c in checks),
        "checks": checks,
        "note": (
            "Distance, elevation, and moving time must match the sum of member days. "
            "Ultra elapsed (first start → last finish) includes overnight and inter-day "
            "gaps, so it is usually larger than total ride elapsed (sum of day elapsed)."
        ),
    }


def _day_hours(race: Race, activity_ids: List[str], uid: str) -> List[dict]:
    """Riding / elapsed hours per calendar day (same-day recordings merge)."""
    rows: List[dict] = []
    for aid, activity in zip(activity_ids, race.activities):
        report = store.get_ride(uid, aid) or {}
        ov = report.get("overview") or {}
        # Prefer race startTime prefix so grouping matches Ultra day list / Library dates.
        date = _iso_day((report.get("race") or {}).get("startTime"))
        if not date and activity.start_time is not None:
            date = datetime.fromtimestamp(activity.start_time, tz=timezone.utc).date().isoformat()
        rows.append(
            {
                "activityId": aid,
                "name": (report.get("race") or {}).get("name") or activity.source_file,
                "date": date,
                "distanceKm": float(ov.get("distanceKm") or 0),
                "elevationGainM": float(ov.get("elevationGainM") or 0),
                "movingTimeS": float(ov.get("movingTimeS") or 0),
                "elapsedTimeS": float(ov.get("elapsedTimeS") or 0),
                "stoppedTimeS": float(ov.get("stoppedTimeS") or 0),
            }
        )

    # Merge by calendar day — first occurrence order, undated never merge.
    groups: List[List[dict]] = []
    index_by_day: dict[str, int] = {}
    for row in rows:
        key = row.get("date")
        if key and key in index_by_day:
            groups[index_by_day[key]].append(row)
            continue
        if key:
            index_by_day[key] = len(groups)
        groups.append([row])

    from ..ultras import strip_recording_part_label

    days: List[dict] = []
    for i, group in enumerate(groups):
        primary = group[0]
        activity_ids_day = [r["activityId"] for r in group]
        raw_name = primary.get("name") or ""
        days.append(
            {
                "dayIndex": i + 1,
                "activityId": primary["activityId"],
                "activityIds": activity_ids_day,
                "recordingCount": len(group),
                "name": strip_recording_part_label(raw_name) or raw_name,
                "date": primary.get("date"),
                "distanceKm": round(sum(r["distanceKm"] for r in group), 1),
                "elevationGainM": round(sum(r["elevationGainM"] for r in group)),
                "movingTimeS": round(sum(r["movingTimeS"] for r in group)),
                "elapsedTimeS": round(sum(r["elapsedTimeS"] for r in group)),
                "stoppedTimeS": round(sum(r["stoppedTimeS"] for r in group)),
            }
        )
    return days


def _aggregation(stitched: dict, race: Race, day_hours: List[dict], validation: dict, day_sum: dict) -> dict:
    ov = stitched.get("overview") or {}
    perf = stitched.get("performance") or {}
    elev_ch = (perf.get("elevation") or {}) if isinstance(perf, dict) else {}
    series = elev_ch.get("series") or []
    max_ele = safe_max(series)
    min_ele = safe_min(series)
    # Prefer live sample extremes if performance series is sparse
    if (max_ele is None or min_ele is None) and race.activities:
        eles = [s.ele for a in race.activities for s in a.samples if s.ele is not None]
        max_ele = safe_max(eles)
        min_ele = safe_min(eles)

    distance_km = float(ov.get("distanceKm") or 0)
    gain = float(ov.get("elevationGainM") or 0)
    loss = float(ov.get("elevationLossM") or 0)
    moving = float(day_sum.get("movingTimeS") or ov.get("movingTimeS") or 0)
    # Three distinct clocks — never conflate them.
    start = race.start_time
    end = race.end_time
    if start is not None and end is not None and end >= start:
        ultra_elapsed = float(end - start)
    else:
        ultra_elapsed = float(ov.get("elapsedTimeS") or 0)
    ride_elapsed = float(day_sum.get("elapsedTimeS") or 0)
    stopped = max(0.0, ultra_elapsed - moving)
    avg_grad = round((gain / (distance_km * 1000.0)) * 100.0, 2) if distance_km > 0 else 0.0

    return {
        "distanceKm": round(distance_km, 1),
        "elevationGainM": round(gain),
        "elevationLossM": round(loss),
        "totalAscentM": round(gain),
        "totalDescentM": round(loss),
        # Ultra elapsed: first ride start → last ride end (includes overnight).
        "elapsedTimeS": round(ultra_elapsed),
        # Sum of each day's ride elapsed (excludes inter-day gaps).
        "rideElapsedTimeS": round(ride_elapsed),
        # Sum of moving times.
        "movingTimeS": round(moving),
        "stoppedTimeS": round(stopped),
        "avgSpeedKmh": (
            round(distance_km / (ultra_elapsed / 3600.0), 1) if ultra_elapsed > 0 else 0.0
        ),
        "avgMovingSpeedKmh": (
            round(distance_km / (moving / 3600.0), 1) if moving > 0 else (ov.get("avgSpeedMovingKmh") or 0)
        ),
        "avgGradientPct": avg_grad,
        "maxElevationM": round(max_ele) if max_ele is not None else None,
        "minElevationM": round(min_ele) if min_ele is not None else None,
        "ridingDays": len(day_hours),
        "startDate": datetime.fromtimestamp(start, tz=timezone.utc).date().isoformat() if start else None,
        "finishDate": datetime.fromtimestamp(end, tz=timezone.utc).date().isoformat() if end else None,
        "validation": validation,
    }


def _availability(report: dict) -> dict:
    curves = report.get("curves") or {}
    perf = report.get("performance") or {}

    def curve_ok(key: str) -> bool:
        node = curves.get(key) or {}
        return bool(node.get("available")) and bool(node.get("points"))

    def channel_ok(key: str) -> bool:
        ch = perf.get(key) or {}
        series = ch.get("series") or []
        return any(v is not None for v in series)

    return {
        "heartRate": curve_ok("hr") or channel_ok("hr"),
        "cadence": curve_ok("cadence") or channel_ok("cadence"),
        "power": curve_ok("power") or channel_ok("power") or bool((report.get("overview") or {}).get("hasPower")),
        "elevation": channel_ok("elevation") or curve_ok("elevationGain"),
        "speed": curve_ok("speedMoving") or channel_ok("speed"),
        "stops": bool((report.get("stops") or {}).get("stops")),
        "climbs": bool((report.get("climbs") or {}).get("climbs")),
    }


def _normalize_activity_timeline(activities: List[Activity]) -> List[Activity]:
    """Ensure non-overlapping timelines so later days are not dropped.

    ``prepare_ride`` skips samples with ``dt <= 0``. Duplicate or overlapping
    recordings (common in demo data / clock errors) must be shifted forward.
    """
    from ..models import Sample

    out: List[Activity] = []
    cursor: Optional[float] = None
    for act in activities:
        if not act.samples:
            continue
        samples = list(act.samples)
        start = samples[0].t
        if cursor is not None and start <= cursor:
            shift = (cursor + 3600.0) - start  # 1h pause between overlapping days
            samples = [
                Sample(
                    t=s.t + shift,
                    lat=s.lat,
                    lon=s.lon,
                    ele=s.ele,
                    dist=s.dist,
                    speed=s.speed,
                    power=s.power,
                    hr=s.hr,
                    cadence=s.cadence,
                    temp=s.temp,
                )
                for s in samples
            ]
        out.append(Activity(source_file=act.source_file, sport=act.sport, samples=samples))
        cursor = out[-1].samples[-1].t
    return out


async def ensure_member_activities(user: dict, activity_ids: List[str]) -> Tuple[List[Activity], List[str]]:
    """Load or re-fetch member Activities. Returns (activities, missing_ids)."""
    from ..providers.router import analyze_provider_ride

    activities: List[Activity] = []
    missing: List[str] = []
    uid = user["id"]

    for aid in activity_ids:
        acts = store.get_or_reconstruct_activities(uid, aid)
        if acts and any(a.samples for a in acts):
            # One Activity per member ride for Ultra day boundaries.
            # If a ride was a multi-file upload, flatten samples into one activity
            # preserving chronological order so day hours stay 1:1 with membership.
            if len(acts) == 1:
                activities.append(acts[0])
            else:
                samples = []
                for a in sorted(acts, key=lambda x: x.start_time or 0):
                    samples.extend(a.samples)
                activities.append(
                    Activity(source_file=acts[0].source_file, sport=acts[0].sport, samples=samples)
                )
            continue

        # Try provider re-fetch (also persists activities via analyze_provider_ride).
        report = await analyze_provider_ride(user, aid)
        acts = store.get_or_reconstruct_activities(uid, aid)
        if acts and any(a.samples for a in acts):
            if len(acts) == 1:
                activities.append(acts[0])
            else:
                samples = []
                for a in sorted(acts, key=lambda x: x.start_time or 0):
                    samples.extend(a.samples)
                activities.append(
                    Activity(source_file=acts[0].source_file, sport=acts[0].sport, samples=samples)
                )
            continue

        if report is None and not store.get_ride(uid, aid):
            missing.append(aid)
            continue
        missing.append(aid)

    return activities, missing


async def build_ultra_analysis(user: dict, ultra_id: str, *, force: bool = False) -> dict:
    """Return Ultra analysis payload (cached when fresh)."""
    uid = user["id"]
    ultra = ultra_store.get_ultra(uid, ultra_id)
    if not ultra:
        raise KeyError("Ultra not found")

    activity_ids = list(ultra.get("activityIds") or [])
    if not activity_ids:
        return {
            "ultraAnalysisSchema": ULTRA_ANALYSIS_SCHEMA,
            "analysisSchema": ANALYSIS_SCHEMA,
            "ultraId": ultra_id,
            "status": "empty",
            "message": "Add rides to this Ultra before opening analytics.",
            "activityIds": [],
            "aggregation": None,
            "dayHours": [],
            "availability": {},
        }

    fingerprint = _member_fingerprint(uid, activity_ids)
    if not force:
        cached = ultra_store.load_ultra_analysis_cache(uid, ultra_id)
        if cached and _cache_fresh(cached, ultra, fingerprint):
            return cached

    activities, missing = await ensure_member_activities(user, activity_ids)
    fingerprint = _member_fingerprint(uid, activity_ids)
    if missing:
        return {
            "ultraAnalysisSchema": ULTRA_ANALYSIS_SCHEMA,
            "analysisSchema": ANALYSIS_SCHEMA,
            "ultraId": ultra_id,
            "status": "needs_data",
            "message": (
                "Some days are missing recorded streams needed to stitch this Ultra. "
                "Open each day once so RYDN can cache the recording, then return here."
            ),
            "missingActivityIds": missing,
            "activityIds": activity_ids,
            "aggregation": None,
            "dayHours": [],
            "availability": {},
        }

    if len(activities) != len(activity_ids):
        return {
            "ultraAnalysisSchema": ULTRA_ANALYSIS_SCHEMA,
            "analysisSchema": ANALYSIS_SCHEMA,
            "ultraId": ultra_id,
            "status": "needs_data",
            "message": "Could not load every day’s recording for this Ultra.",
            "activityIds": activity_ids,
            "aggregation": None,
            "dayHours": [],
            "availability": {},
        }

    # Preserve Ultra membership order (not only timestamp sort) for day labels,
    # but build_race sorts by start_time — re-order activities to match ids after sort.
    by_start = list(zip(activity_ids, activities))
    # Prefer true chronology; fall back to membership order when clocks tie.
    by_start.sort(key=lambda pair: (pair[1].start_time or 0.0, activity_ids.index(pair[0])))
    ordered_ids = [p[0] for p in by_start]
    ordered_acts = _normalize_activity_timeline([p[1] for p in by_start])

    race = Race(
        name=ultra.get("name") or "Ultra",
        kind="race",
        activities=ordered_acts,
    )
    # build_race re-sorts; we already sorted — keep explicit Race.
    report = build_report(race)

    day_sum = _sum_member_overviews(uid, ordered_ids)
    ov = report.get("overview") or {}
    # Ascent/descent: sum of member days (avoid phantom overnight climbs).
    ov["elevationGainM"] = day_sum["elevationGainM"]
    ov["elevationLossM"] = day_sum["elevationLossM"]

    # Ultra elapsed is always wall clock: last sample − first sample.
    if race.start_time is not None and race.end_time is not None and race.end_time >= race.start_time:
        ultra_elapsed = float(race.end_time - race.start_time)
        ov["elapsedTimeS"] = round(ultra_elapsed)
        moving_for_stop = float(day_sum["movingTimeS"] or ov.get("movingTimeS") or 0)
        ov["stoppedTimeS"] = round(max(0.0, ultra_elapsed - moving_for_stop))
        distance_km = float(ov.get("distanceKm") or day_sum["distanceKm"] or 0)
        ov["avgSpeedElapsedKmh"] = (
            round(distance_km / (ultra_elapsed / 3600.0), 1) if ultra_elapsed > 0 else 0.0
        )
        if ultra_elapsed > 0:
            ov["movingPct"] = round(moving_for_stop / ultra_elapsed * 100.0, 1)

    # Legacy reconstructed streams are approximate — trust day-report distance/moving.
    reconstructed = any((a.source_file or "").startswith("report:") for a in ordered_acts)
    if reconstructed:
        ov["distanceKm"] = day_sum["distanceKm"]
        ov["movingTimeS"] = day_sum["movingTimeS"]
        elapsed = float(ov.get("elapsedTimeS") or 0)
        ov["stoppedTimeS"] = round(max(0.0, elapsed - day_sum["movingTimeS"]))
        moving = float(day_sum["movingTimeS"] or 0)
        distance_km = float(day_sum["distanceKm"] or 0)
        ov["avgSpeedMovingKmh"] = (
            round(distance_km / (moving / 3600.0), 1) if moving > 0 else 0.0
        )
        ov["avgSpeedElapsedKmh"] = (
            round(distance_km / (elapsed / 3600.0), 1) if elapsed > 0 else 0.0
        )
        ov["movingPct"] = round(moving / elapsed * 100.0, 1) if elapsed > 0 else 0.0

    report["overview"] = ov

    validation = _validate(ov, day_sum)
    # Reconstructed streams: distance/moving are forced from day sums → always ok.
    if reconstructed:
        for c in validation["checks"]:
            if c["metric"] in ("distanceKm", "movingTimeS", "elevationGainM"):
                c["ok"] = True
                c["delta"] = 0
        validation["ok"] = True
        validation["note"] = (
            validation["note"]
            + " Some member days were rebuilt from cached reports (legacy uploads); "
            "distance and moving time use the sum of day reports."
        )

    day_hours = _day_hours(race, ordered_ids, uid)
    aggregation = _aggregation(report, race, day_hours, validation, day_sum)
    availability = _availability(report)

    # Soften overview question for Ultra scope
    if report.get("overview"):
        report["overview"]["question"] = "How did you ride this Ultra?"

    payload = {
        "ultraAnalysisSchema": ULTRA_ANALYSIS_SCHEMA,
        "analysisSchema": ANALYSIS_SCHEMA,
        "ultraId": ultra_id,
        "status": "ready",
        "message": None,
        "activityIds": ordered_ids,
        "memberFingerprint": fingerprint,
        "aggregation": aggregation,
        "dayHours": day_hours,
        "availability": availability,
        "daySum": {
            "distanceKm": day_sum["distanceKm"],
            "elevationGainM": day_sum["elevationGainM"],
            "movingTimeS": day_sum["movingTimeS"],
            "elapsedTimeS": day_sum["elapsedTimeS"],  # total ride elapsed (sum)
        },
        "race": report.get("race"),
        "overview": report.get("overview"),
        "performance": report.get("performance"),
        "curves": report.get("curves"),
        "climbs": report.get("climbs"),
        "stops": report.get("stops"),
        "timeLedger": report.get("timeLedger"),
        "pacing": report.get("pacing"),
        "summary": report.get("summary"),
        "route": report.get("route"),
        "builtAt": datetime.now(tz=timezone.utc).isoformat(),
    }
    if not validation["ok"]:
        payload["status"] = "ready_with_warnings"
        payload["message"] = (
            "Ultra analytics built, but some totals do not match the sum of day reports. "
            "Treat mismatches as a bug — check validation details."
        )

    ultra_store.save_ultra_analysis_cache(uid, ultra_id, payload)
    return payload
