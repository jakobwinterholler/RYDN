"""Completed Ultras — the hero objects of the experience platform.

An Ultra is a named event (The Capitals 2026, NorthCape 2027, …), not a single
Strava activity. It groups one or more activities (Strava days and/or uploads)
into one cabinet card, one Review, and eventually one experience profile used
when planning the next Ultra.

Within an Ultra, multiple recordings on the same calendar day collapse into one
trip day (totals, day index, analytics). Original Library rides stay untouched.

Persistence lives beside the ride library:

    data/users/<uid>/ultras/<ultraId>.json
"""

from __future__ import annotations

import json
import os
import time
import uuid
from typing import Any, Dict, List, Optional

from .lifecycle import AREA_COMPLETED, AREA_PLANNING, enrich_summary, normalize_status
from .paths import users_dir

_USERS_DIR = users_dir()


def _ultras_dir(uid: str) -> str:
    return os.path.join(_USERS_DIR, uid, "ultras")


def _ultra_path(uid: str, ultra_id: str) -> str:
    return os.path.join(_ultras_dir(uid), f"{ultra_id}.json")


def _load(uid: str, ultra_id: str) -> Optional[dict]:
    try:
        with open(_ultra_path(uid, ultra_id), "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def _save(uid: str, ultra: dict) -> dict:
    os.makedirs(_ultras_dir(uid), exist_ok=True)
    with open(_ultra_path(uid, ultra["id"]), "w", encoding="utf-8") as f:
        json.dump(ultra, f, indent=2)
    return ultra


def _empty_experience() -> dict:
    """Inspectable defaults filled after Review — used by 'Use previous experience'."""
    return {
        "dailyRidingCapacityKm": None,
        "preferredSleepHours": None,
        "preferredStopFrequencyPer100Km": None,
        "preferredStartHourLocal": None,
        "preferredNutritionTiming": None,
        "preferredMovingSpeedKmh": None,
        "preferredClimbingPace": None,
        "nightRiding": None,
        "after20hPerformance": None,
        "notes": [],
    }


def _day(iso: Optional[str]) -> Optional[str]:
    if not iso:
        return None
    s = str(iso).strip()
    return s[:10] if len(s) >= 10 else s or None


def _parse_epoch(value: object) -> Optional[float]:
    """Parse an activity start/end into UTC epoch seconds."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        v = float(value)
        # Heuristic: ms vs s
        return v / 1000.0 if v > 1e12 else v
    s = str(value).strip()
    if not s:
        return None
    try:
        from datetime import datetime, timezone

        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.timestamp()
    except ValueError:
        return None


def _activity_span(activity: dict) -> tuple[Optional[float], Optional[float]]:
    """Return (start_epoch, end_epoch) for one ride summary."""
    start = _parse_epoch(activity.get("date") or activity.get("startTime"))
    if start is None:
        return None, None
    end = _parse_epoch(activity.get("endTime"))
    if end is None:
        dur = float(activity.get("durationS") or 0)
        end = start + dur if dur > 0 else start
    if end < start:
        end = start
    return start, end


def _ultra_elapsed_s(activities: List[dict]) -> float:
    """True Ultra duration: last ride end − first ride start (includes overnight gaps)."""
    starts: List[float] = []
    ends: List[float] = []
    for a in activities:
        start, end = _activity_span(a)
        if start is None or end is None:
            continue
        starts.append(start)
        ends.append(end)
    if not starts or not ends:
        return 0.0
    return max(0.0, max(ends) - min(starts))


def _range_from_activities(activities: List[dict]) -> tuple[Optional[str], Optional[str], Optional[str]]:
    days = sorted({d for a in activities if (d := _day(a.get("date")))})
    if not days:
        return None, None, None
    return days[0], days[0], days[-1]


def _calendar_day_key(activity: dict) -> Optional[str]:
    """YYYY-MM-DD for a ride summary, or None when undated."""
    return _day(activity.get("date") or activity.get("startTime"))


def group_activities_by_calendar_day(ordered_activities: List[dict]) -> List[List[dict]]:
    """Merge rides that share a calendar day into one trip day.

    A "day" is one calendar riding day within a trip — not one GPX/FIT file.
    Undated rides never merge with each other. Group order follows first
    occurrence in ``ordered_activities``; members within a group are sorted
    chronologically.
    """
    groups: List[List[dict]] = []
    index_by_day: Dict[str, int] = {}
    for activity in ordered_activities:
        key = _calendar_day_key(activity)
        if key and key in index_by_day:
            groups[index_by_day[key]].append(activity)
            continue
        if key:
            index_by_day[key] = len(groups)
        groups.append([activity])

    for group in groups:
        group.sort(
            key=lambda a: (
                _parse_epoch(a.get("date") or a.get("startTime")) or 0.0,
                str(a.get("id") or ""),
            )
        )
    return groups


def count_calendar_days(activities: List[dict]) -> int:
    """Riding days: unique calendar dates; each undated ride counts alone."""
    return len(group_activities_by_calendar_day(activities))


def strip_recording_part_label(name: Optional[str]) -> str:
    """Remove Strava-style ``(1/2)`` / ``(2/2)`` part markers from a day title.

    Those markers name *recordings*, not Ultra days. After same-day merge the
    Ultra day index is authoritative — keeping ``(1/2)`` makes merge look broken.
    """
    import re

    s = (name or "").strip()
    if not s:
        return ""
    s = re.sub(r"\s*\(\s*\d+\s*/\s*\d+\s*\)", "", s)
    s = re.sub(r"\s{2,}", " ", s).strip(" -—–|&")
    return s


def merge_day_summary(members: List[dict], day_index: int) -> dict:
    """Combine same-calendar-day ride summaries into one Ultra day row."""
    if not members:
        raise ValueError("merge_day_summary requires at least one member")
    primary = members[0]
    activity_ids = [str(m["id"]) for m in members if m.get("id")]
    distance = sum(float(m.get("distanceKm") or 0) for m in members)
    elev = sum(float(m.get("elevationGainM") or 0) for m in members)
    moving = sum(float(m.get("movingTimeS") or 0) for m in members)
    ride_elapsed = sum(float(m.get("durationS") or 0) for m in members)
    has_photos = any(bool(m.get("hasPhotos")) for m in members)
    photo_url = next((m.get("photoUrl") for m in members if m.get("photoUrl")), primary.get("photoUrl"))
    # Prefer a cleaned title; fall back to primary if stripping emptied it.
    display_name = strip_recording_part_label(primary.get("name")) or (primary.get("name") or "")

    merged = {
        **primary,
        "id": primary.get("id"),
        "activityIds": activity_ids,
        "recordingCount": len(members),
        "dayIndex": day_index,
        "date": primary.get("date"),
        "name": display_name,
        "distanceKm": round(distance, 1),
        "elevationGainM": round(elev),
        "movingTimeS": round(moving),
        "durationS": round(ride_elapsed),
        "hasPhotos": has_photos,
        "photoUrl": photo_url,
        "recordings": [
            {
                "id": m.get("id"),
                "name": m.get("name"),  # originals keep Strava titles
                "date": m.get("date"),
                "distanceKm": m.get("distanceKm") or 0,
                "elevationGainM": m.get("elevationGainM") or 0,
                "durationS": m.get("durationS") or 0,
                "movingTimeS": m.get("movingTimeS") or 0,
            }
            for m in members
        ],
    }
    return merged


def apply_activity_totals(ultra: dict, activities: List[dict]) -> dict:
    """Recompute totals + date range + year + day count from member rides.

    Three time metrics (never interchangeable):
    - ``durationS`` / ultra elapsed — first ride start → last ride end (wall clock)
    - ``rideElapsedTimeS`` — sum of each ride's own elapsed time
    - ``movingTimeS`` — sum of each ride's moving time

    ``dayCount`` is the number of calendar riding days (same-day recordings merge).
    """
    ultra["distanceKm"] = round(sum(float(a.get("distanceKm") or 0) for a in activities), 1)
    ultra["elevationGainM"] = round(sum(float(a.get("elevationGainM") or 0) for a in activities))
    ride_elapsed = sum(float(a.get("durationS") or 0) for a in activities)
    ultra["rideElapsedTimeS"] = round(ride_elapsed)
    ultra["movingTimeS"] = round(sum(float(a.get("movingTimeS") or 0) for a in activities))
    ultra["durationS"] = round(_ultra_elapsed_s(activities))
    ultra["dayCount"] = count_calendar_days(activities)
    date, start, end = _range_from_activities(activities)
    if activities:
        ultra["date"] = date
        ultra["dateStart"] = start
        ultra["dateEnd"] = end
        # Year is always inferred from the earliest ride — never typed by the rider.
        if date and len(str(date)) >= 4:
            try:
                ultra["year"] = int(str(date)[:4])
            except ValueError:
                ultra["year"] = None
        else:
            ultra["year"] = None
    else:
        ultra["date"] = None
        ultra["dateStart"] = None
        ultra["dateEnd"] = None
        ultra["year"] = None
    return ultra


def claimed_activity_ids(uid: str, *, except_ultra_id: Optional[str] = None) -> set[str]:
    """Activity ids already belonging to an Ultra (optionally excluding one Ultra)."""
    claimed: set[str] = set()
    for u in list_ultras(uid):
        if except_ultra_id and u.get("id") == except_ultra_id:
            continue
        for aid in u.get("activityIds") or []:
            claimed.add(aid)
    return claimed


def find_membership_conflicts(
    uid: str, activity_ids: List[str], *, except_ultra_id: Optional[str] = None
) -> List[str]:
    """Return activity ids that are already claimed by another Ultra."""
    claimed = claimed_activity_ids(uid, except_ultra_id=except_ultra_id)
    return [aid for aid in activity_ids if aid in claimed]


def recompute_ultra(uid: str, ultra_id: str, rides: Optional[List[dict]] = None) -> Optional[dict]:
    """Prune missing members and refresh all derived Ultra fields.

    Recalculates distance, elevation, elapsed, moving time, day count, year,
    date range, and (unless manually overridden) countries. Route preview is
    derived live in ``ultra_detail`` from remaining members — never stored stale.
    """
    from . import store as ride_store

    ultra = get_ultra(uid, ultra_id)
    if not ultra:
        return None
    if rides is None:
        rides = ride_store.list_rides(uid)
    by_id = {r["id"]: r for r in rides}

    raw_ids = list(ultra.get("activityIds") or [])
    seen: set[str] = set()
    clean_ids: List[str] = []
    for aid in raw_ids:
        if aid in by_id and aid not in seen:
            seen.add(aid)
            clean_ids.append(aid)

    if not ultra.get("activityOrderManual"):
        clean_ids = sort_activity_ids(clean_ids, by_id)

    activities = [by_id[aid] for aid in clean_ids]
    ultra["activityIds"] = clean_ids
    apply_activity_totals(ultra, activities)

    if not ultra.get("countriesManual"):
        detected = detect_countries_for_activities(uid, clean_ids) if clean_ids else []
        ultra["countryCodes"] = detected
        ultra["countryCode"] = detected[0] if detected else None
        if not detected:
            ultra["country"] = None

    ultra["updatedAt"] = time.time()
    saved = _save(uid, ultra)
    invalidate_ultra_analysis(uid, ultra_id)
    return saved


def detach_activity_from_ultras(uid: str, activity_id: str) -> List[str]:
    """Remove an activity from every Ultra and recompute each. Returns affected ids."""
    from . import store as ride_store

    rides = ride_store.list_rides(uid)
    affected: List[str] = []
    for u in list_ultras(uid):
        ids = list(u.get("activityIds") or [])
        if activity_id not in ids:
            continue
        u["activityIds"] = [x for x in ids if x != activity_id]
        _save(uid, u)
        recompute_ultra(uid, u["id"], rides=rides)
        affected.append(u["id"])
    return affected


def recompute_ultras_containing(uid: str, activity_id: str) -> List[str]:
    """Refresh totals for every Ultra that includes this activity (e.g. after reanalyze)."""
    from . import store as ride_store

    rides = ride_store.list_rides(uid)
    affected: List[str] = []
    for u in list_ultras(uid):
        if activity_id not in (u.get("activityIds") or []):
            continue
        recompute_ultra(uid, u["id"], rides=rides)
        affected.append(u["id"])
    return affected


def _analysis_path(uid: str, ultra_id: str) -> str:
    return os.path.join(_ultras_dir(uid), f"{ultra_id}.analysis.json")


def invalidate_ultra_analysis(uid: str, ultra_id: str) -> None:
    try:
        os.remove(_analysis_path(uid, ultra_id))
    except OSError:
        pass


def invalidate_ultras_containing(uid: str, activity_id: str) -> None:
    for u in list_ultras(uid):
        if activity_id in (u.get("activityIds") or []):
            invalidate_ultra_analysis(uid, u["id"])


def load_ultra_analysis_cache(uid: str, ultra_id: str) -> Optional[dict]:
    try:
        with open(_analysis_path(uid, ultra_id), "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def save_ultra_analysis_cache(uid: str, ultra_id: str, payload: dict) -> dict:
    os.makedirs(_ultras_dir(uid), exist_ok=True)
    with open(_analysis_path(uid, ultra_id), "w", encoding="utf-8") as f:
        json.dump(payload, f)
    return payload


def clean_ultra_name(name: str) -> str:
    """Keep titles short: strip Day N / Place / emoji noise from Strava names."""
    import re

    s = (name or "").strip()
    if not s:
        return "Untitled Ultra"
    s = re.split(r"\s+[—–\-]\s+Day\s*\d+", s, flags=re.I)[0]
    s = re.split(r"\s+Day\s*\d+\b", s, flags=re.I)[0]
    s = re.split(r"\s*[—–\-]\s*\(?\s*Place\b", s, flags=re.I)[0]
    s = re.split(r"\s*\(\s*Place\b", s, flags=re.I)[0]
    # Drop trailing emoji / checkmark flourishes.
    s = re.sub(r"[\U0001F300-\U0001FAFF\u2600-\u27BF✅❌⭐️]+", "", s)
    s = re.sub(r"\s{2,}", " ", s).strip(" -—–|&")
    return s or "Untitled Ultra"


def extract_result_from_name(name: str) -> Optional[str]:
    """Pull placing out of a noisy Strava title when present."""
    import re

    m = re.search(r"Place\s+(\d+)\s*/\s*\d+", name or "", flags=re.I)
    if not m:
        return None
    n = int(m.group(1))
    if n % 100 in (11, 12, 13):
        suf = "th"
    else:
        suf = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suf}"


def sort_activity_ids(activity_ids: List[str], rides_by_id: Dict[str, dict]) -> List[str]:
    """Chronological day order — default unless the rider reordered manually."""
    return sorted(
        activity_ids,
        key=lambda aid: (
            str(rides_by_id.get(aid, {}).get("date") or ""),
            aid,
        ),
    )


def detect_countries_for_activities(uid: str, activity_ids: List[str]) -> List[str]:
    """Infer ISO country codes from member GPS tracks. Automatic first."""
    from . import store as ride_store
    from .util.countries import countries_from_points

    points: List[list] = []
    for aid in activity_ids:
        points.extend(ride_store.get_route_points(uid, aid, max_points=80))
    return countries_from_points(points, max_samples=72)


def create_ultra(
    uid: str,
    *,
    name: str,
    year: Optional[int] = None,
    activity_ids: Optional[List[str]] = None,
    status: str = "completed",
    kind: str = "ultra",
    country: Optional[str] = None,
    country_code: Optional[str] = None,
    country_codes: Optional[List[str]] = None,
    countries_manual: bool = False,
    result: Optional[str] = None,
    finish_place: Optional[str] = None,
    finish_percentile: Optional[float] = None,
    rating: Optional[float] = None,
    cover_url: Optional[str] = None,
    logo_url: Optional[str] = None,
    distance_km: float = 0,
    elevation_gain_m: float = 0,
    duration_s: float = 0,
    date: Optional[str] = None,
    date_start: Optional[str] = None,
    date_end: Optional[str] = None,
    activity_order_manual: bool = False,
) -> dict:
    codes = [c.upper() for c in (country_codes or []) if c and len(str(c).strip()) == 2]
    if not codes and country_code and len(str(country_code).strip()) == 2:
        codes = [str(country_code).strip().upper()]
    result_value = (result if result is not None else finish_place)
    if isinstance(result_value, str):
        result_value = result_value.strip() or None
    ultra = {
        "id": uuid.uuid4().hex[:12],
        "createdAt": time.time(),
        "updatedAt": time.time(),
        "name": clean_ultra_name(name),
        "year": year,
        "kind": kind,  # ultra | race | bikepacking | training
        "status": normalize_status(status, analyzed=status in ("completed", "reviewed")),
        "activityIds": list(activity_ids or []),
        "activityOrderManual": bool(activity_order_manual),
        "country": country,
        "countryCode": codes[0] if codes else country_code,
        "countryCodes": codes,
        "countriesManual": bool(countries_manual) if codes else False,
        "result": result_value,
        "finishPlace": result_value,  # legacy alias
        "finishPercentile": finish_percentile,
        "rating": rating,
        "coverUrl": cover_url,
        "logoUrl": logo_url,
        "distanceKm": distance_km,
        "elevationGainM": elevation_gain_m,
        "durationS": duration_s,
        "rideElapsedTimeS": 0,
        "movingTimeS": 0,
        "dayCount": len(activity_ids or []),
        "date": date,
        "dateStart": _day(date_start) or _day(date),
        "dateEnd": _day(date_end) or _day(date),
        "experience": _empty_experience(),
        "strategies": [],
    }
    ultra["area"] = AREA_PLANNING if ultra["status"] in {
        "draft",
        "planning",
        "ready",
        "in_progress",
    } else AREA_COMPLETED
    return _save(uid, ultra)


def update_ultra(uid: str, ultra_id: str, patch: Dict[str, Any]) -> Optional[dict]:
    ultra = _load(uid, ultra_id)
    if not ultra:
        return None
    allowed = {
        "name",
        "year",
        "kind",
        "status",
        "activityIds",
        "activityOrderManual",
        "country",
        "countryCode",
        "countryCodes",
        "countriesManual",
        "result",
        "finishPlace",
        "finishPercentile",
        "rating",
        "coverUrl",
        "logoUrl",
        "distanceKm",
        "elevationGainM",
        "durationS",
        "movingTimeS",
        "dayCount",
        "date",
        "dateStart",
        "dateEnd",
        "experience",
        "strategies",
    }
    for key, value in patch.items():
        if key in allowed:
            ultra[key] = value
    if "name" in patch and isinstance(patch.get("name"), str):
        ultra["name"] = clean_ultra_name(patch["name"])
    if "result" in patch or "finishPlace" in patch:
        result_value = patch.get("result", patch.get("finishPlace"))
        if isinstance(result_value, str):
            result_value = result_value.strip() or None
        ultra["result"] = result_value
        ultra["finishPlace"] = result_value
    if "dateStart" in patch:
        ultra["dateStart"] = _day(patch.get("dateStart"))
    if "dateEnd" in patch:
        ultra["dateEnd"] = _day(patch.get("dateEnd"))
    if "countryCodes" in patch:
        codes = [c.upper() for c in (patch.get("countryCodes") or []) if c and len(str(c).strip()) == 2]
        ultra["countryCodes"] = codes
        ultra["countryCode"] = codes[0] if codes else None
        if "countriesManual" not in patch:
            ultra["countriesManual"] = True
    if "status" in patch:
        ultra["status"] = normalize_status(ultra.get("status"))
        ultra["area"] = AREA_PLANNING if ultra["status"] in {
            "draft",
            "planning",
            "ready",
            "in_progress",
        } else AREA_COMPLETED
    # Normalize legacy payloads
    if ultra.get("result") is None and ultra.get("finishPlace"):
        ultra["result"] = ultra.get("finishPlace")
    ultra["updatedAt"] = time.time()
    saved = _save(uid, ultra)
    if "activityIds" in patch:
        invalidate_ultra_analysis(uid, ultra_id)
    return saved


def delete_ultra(uid: str, ultra_id: str) -> bool:
    invalidate_ultra_analysis(uid, ultra_id)
    try:
        os.remove(_ultra_path(uid, ultra_id))
        return True
    except OSError:
        return False


def get_ultra(uid: str, ultra_id: str) -> Optional[dict]:
    return _load(uid, ultra_id)


def list_ultras(uid: str) -> List[dict]:
    d = _ultras_dir(uid)
    if not os.path.isdir(d):
        return []
    out: List[dict] = []
    for fname in os.listdir(d):
        if not fname.endswith(".json") or fname.endswith(".analysis.json"):
            continue
        try:
            with open(os.path.join(d, fname), "r", encoding="utf-8") as f:
                out.append(json.load(f))
        except (OSError, json.JSONDecodeError):
            continue
    out.sort(key=lambda u: (u.get("year") or 0, u.get("date") or "", u.get("createdAt") or 0), reverse=True)
    return out


def ultra_from_activities(uid: str, name: str, activities: List[dict], **meta: Any) -> dict:
    """Create an Ultra by aggregating ride/activity summaries."""
    rides_by_id = {a["id"]: a for a in activities}
    activity_ids = [a["id"] for a in activities]
    if not meta.get("activityOrderManual"):
        activity_ids = sort_activity_ids(activity_ids, rides_by_id)
        activities = [rides_by_id[i] for i in activity_ids]

    distance = sum(float(a.get("distanceKm") or 0) for a in activities)
    elev = sum(float(a.get("elevationGainM") or 0) for a in activities)
    # Placeholder — apply_activity_totals overwrites with wall-clock Ultra elapsed.
    duration = _ultra_elapsed_s(activities)
    date, date_start, date_end = _range_from_activities(activities)
    year = None
    if date and len(str(date)) >= 4:
        try:
            year = int(str(date)[:4])
        except ValueError:
            year = None

    country_codes = meta.get("countryCodes")
    countries_manual = bool(meta.get("countriesManual"))
    if not country_codes:
        country_codes = detect_countries_for_activities(uid, activity_ids)
        countries_manual = False

    result = meta.get("result", meta.get("finishPlace"))
    if not result:
        for a in activities:
            result = extract_result_from_name(a.get("name") or "")
            if result:
                break
        if not result:
            result = extract_result_from_name(name)

    ultra = create_ultra(
        uid,
        name=name,
        year=meta.get("year", year),
        activity_ids=activity_ids,
        activity_order_manual=bool(meta.get("activityOrderManual")),
        status=meta.get("status", "reviewed"),
        kind=meta.get("kind", "ultra"),
        distance_km=round(distance, 1),
        elevation_gain_m=round(elev),
        duration_s=duration,
        date=date,
        date_start=meta.get("dateStart") or date_start,
        date_end=meta.get("dateEnd") or date_end,
        country=meta.get("country"),
        country_code=meta.get("countryCode"),
        country_codes=country_codes,
        countries_manual=countries_manual,
        result=result,
        finish_percentile=meta.get("finishPercentile"),
        rating=meta.get("rating"),
        cover_url=meta.get("coverUrl"),
        logo_url=meta.get("logoUrl"),
    )
    apply_activity_totals(ultra, activities)
    return _save(uid, ultra)


def _elev_at_km(km: List[float], elev: List[Optional[float]], target: float) -> Optional[float]:
    """Nearest finite elevation on a stitched profile at ``target`` km."""
    if not km or not elev:
        return None
    best_i = 0
    best_d = abs(km[0] - target)
    for i, x in enumerate(km):
        d = abs(x - target)
        if d < best_d:
            best_d = d
            best_i = i
    v = elev[best_i] if best_i < len(elev) else None
    return round(float(v)) if v is not None else None


def _decimate_elev_profile(
    km: List[float], elev: List[Optional[float]], target: int = 220
) -> tuple:
    n = len(km)
    if n <= target or target <= 0:
        return km, elev
    step = n / target
    out_km: List[float] = []
    out_elev: List[Optional[float]] = []
    i = 0.0
    while i < n:
        idx = int(i)
        out_km.append(km[idx])
        out_elev.append(elev[idx])
        i += step
    if out_km and (out_km[-1] != km[-1] or out_elev[-1] != elev[-1]):
        out_km.append(km[-1])
        out_elev.append(elev[-1])
    return out_km, out_elev


def _ultra_finisher_story(
    uid: str, ultra_id: str, chrono_ids: List[str], days: List[dict]
) -> dict:
    """Lightweight elev profile + overnight markers + NP for Ultra Overview.

    Built from cached ride reports / analysis — never triggers a full re-stitch.
    """
    from . import store as ride_store

    axis_km: List[float] = []
    elev_series: List[Optional[float]] = []
    offset = 0.0
    ride_np: List[float] = []
    reports_seen = 0

    for aid in chrono_ids:
        report = ride_store.get_ride(uid, aid)
        if not report:
            continue
        reports_seen += 1
        ov = report.get("overview") or {}
        np_raw = ov.get("npW")
        if isinstance(np_raw, (int, float)) and np_raw > 0:
            ride_np.append(float(np_raw))

        perf = report.get("performance") or {}
        axis = perf.get("axisKm") or []
        elev_ch = perf.get("elevation") or {}
        series = elev_ch.get("series") if isinstance(elev_ch, dict) else None
        if not axis or not isinstance(series, list) or len(axis) < 2:
            dist = float(ov.get("distanceKm") or 0)
            if dist > 0:
                offset += dist
            continue

        local_end = 0.0
        for i, x in enumerate(axis):
            try:
                kx = float(x)
            except (TypeError, ValueError):
                continue
            local_end = max(local_end, kx)
            e = series[i] if i < len(series) else None
            try:
                ev: Optional[float] = float(e) if e is not None else None
            except (TypeError, ValueError):
                ev = None
            axis_km.append(round(offset + kx, 2))
            elev_series.append(round(ev, 1) if ev is not None else None)
        dist = float(ov.get("distanceKm") or 0)
        offset += local_end if local_end > 0 else dist

    axis_km, elev_series = _decimate_elev_profile(axis_km, elev_series)

    # Overnight sleep: end of each riding day except the finish.
    sleep: List[dict] = []
    cum = 0.0
    for i, day in enumerate(days):
        cum += float(day.get("distanceKm") or 0)
        if i >= len(days) - 1:
            break
        if cum <= 0:
            continue
        sleep.append(
            {
                "dayIndex": int(day.get("dayIndex") or (i + 1)),
                "distanceKm": round(cum, 1),
                "elevationM": _elev_at_km(axis_km, elev_series, cum),
            }
        )

    np_w: Optional[float] = None
    cached = load_ultra_analysis_cache(uid, ultra_id)
    if cached:
        cov = cached.get("overview") or {}
        raw = cov.get("npW")
        if isinstance(raw, (int, float)) and raw > 0:
            np_w = round(float(raw))
    # Fallback only when every analysed member ride has NP (no silent partial mean).
    if np_w is None and reports_seen > 0 and len(ride_np) == reports_seen:
        np_w = round(sum(ride_np) / len(ride_np))

    has_elev = any(v is not None for v in elev_series)
    return {
        "axisKm": axis_km if has_elev else [],
        "elevationM": elev_series if has_elev else [],
        "sleep": sleep,
        "npW": np_w,
    }


def ultra_detail(uid: str, ultra_id: str, rides: List[dict]) -> Optional[dict]:
    """Ultra + ordered days + editorial route. Collection the rider owns."""
    from . import store as ride_store

    ultra = get_ultra(uid, ultra_id)
    if not ultra:
        return None

    # Heal membership: drop deleted rides and refresh derived fields.
    by_id_check = {r["id"]: r for r in rides}
    raw_ids = list(ultra.get("activityIds") or [])
    members_for_heal = [by_id_check[a] for a in raw_ids if a in by_id_check]
    expected_day_count = count_calendar_days(members_for_heal)
    if (
        any(aid not in by_id_check for aid in raw_ids)
        or ultra.get("dayCount") != expected_day_count
        or ultra.get("movingTimeS") is None
        or "dayCount" not in ultra
        or ultra.get("rideElapsedTimeS") is None
    ):
        ultra = recompute_ultra(uid, ultra_id, rides=rides) or ultra

    # Backfill countries from GPS when software can know and rider hasn't overridden.
    if not ultra.get("countriesManual") and not (ultra.get("countryCodes") or []):
        detected = detect_countries_for_activities(uid, ultra.get("activityIds") or [])
        if detected:
            ultra = update_ultra(
                uid,
                ultra_id,
                {"countryCodes": detected, "countriesManual": False},
            ) or ultra

    if ultra.get("result") is None and ultra.get("finishPlace"):
        ultra["result"] = ultra.get("finishPlace")

    by_id = {r["id"]: enrich_summary(r) for r in rides}
    activity_ids = list(ultra.get("activityIds") or [])
    chrono_ids = sort_activity_ids(activity_ids, by_id)

    # Keep day list in rider order when locked; otherwise chronological.
    # Same-calendar-day recordings always collapse into one trip day.
    display_ids = activity_ids if ultra.get("activityOrderManual") else chrono_ids
    ordered = [by_id[aid] for aid in display_ids if aid in by_id]
    days = [
        merge_day_summary(group, i + 1)
        for i, group in enumerate(group_activities_by_calendar_day(ordered))
    ]

    # Map plate always stitches recordings chronologically as separate segments
    # (never draw a teleport line across overnight or mid-day gaps).
    route_segments: List[List[list]] = []
    for aid in chrono_ids:
        pts = ride_store.get_route_points(uid, aid, max_points=280)
        if len(pts) >= 2:
            route_segments.append(pts)

    flat: List[list] = [p for seg in route_segments for p in seg]

    from .util.geo import decimate_points

    story = _ultra_finisher_story(uid, ultra_id, chrono_ids, days)
    if story.get("npW") is not None:
        ultra = {**ultra, "npW": story["npW"]}
    else:
        ultra = {**ultra, "npW": None}

    claimed = claimed_activity_ids(uid, except_ultra_id=ultra_id)
    return {
        "ultra": ultra,
        "days": days,
        "route": {
            "points": decimate_points(flat, 600) if flat else [],
            "segments": route_segments,
            "elevation": {
                "axisKm": story["axisKm"],
                "elevationM": story["elevationM"],
            },
            "sleep": story["sleep"],
        },
        "library": [
            enrich_summary(r)
            for r in rides
            if r.get("id") not in set(activity_ids) and r.get("id") not in claimed
        ],
    }


def suggest_ultra_groups(rides: List[dict], claimed: set[str]) -> List[dict]:
    """Heuristic only — never creates Ultras. Software suggests; humans decide.

    Groups Library source days that look related (shared name stem before
    " - Day" / " Day " patterns, or identical name prefix).
    """
    import re

    buckets: dict[str, List[dict]] = {}
    for r in rides:
        rid = r.get("id")
        if not rid or rid in claimed:
            continue
        name = (r.get("name") or "").strip()
        if not name:
            continue
        stem = re.split(r"\s+[—–\-]\s+Day\s*\d+", name, flags=re.I)[0]
        stem = re.split(r"\s+Day\s*\d+\b", stem, flags=re.I)[0].strip()
        if len(stem) < 4:
            continue
        key = stem.lower()
        buckets.setdefault(key, []).append(r)

    out: List[dict] = []
    for key, group in buckets.items():
        if len(group) < 2:
            continue
        group = sorted(group, key=lambda x: x.get("date") or "")
        out.append(
            {
                "label": group[0].get("name", "").split(" - ")[0].split(" — ")[0].strip()
                or key,
                "activityIds": [g["id"] for g in group],
                "count": len(group),
                "message": "These source days look like they belong to the same Ultra.",
            }
        )
    out.sort(key=lambda g: -g["count"])
    return out[:5]


def cabinet_payload(uid: str, rides: List[dict]) -> dict:
    """Ultras are only those the rider created. Everything else stays in Library.

    Never auto-creates Ultras. Optional suggestions are hints only.
    """
    rides_by_id = {r["id"] for r in rides}
    for u in list_ultras(uid):
        ids = list(u.get("activityIds") or [])
        needs_totals = u.get("rideElapsedTimeS") is None or u.get("movingTimeS") is None
        if needs_totals or any(aid not in rides_by_id for aid in ids):
            recompute_ultra(uid, u["id"], rides=rides)

    ultras = list_ultras(uid)
    claimed = claimed_activity_ids(uid)

    library: List[dict] = []
    for r in rides:
        enriched = enrich_summary(r)
        if enriched.get("id") in claimed:
            continue
        library.append(enriched)

    planning_ultras = [u for u in ultras if u.get("area") == AREA_PLANNING]
    completed_ultras = [u for u in ultras if u.get("area") != AREA_PLANNING]

    return {
        "planningUltras": planning_ultras,
        "completedUltras": completed_ultras,
        "ungroupedRides": library,
        "plannedRoutes": [],  # filled by get_cabinet — keep key stable for older callers
        "suggestions": suggest_ultra_groups(library, claimed),
    }
