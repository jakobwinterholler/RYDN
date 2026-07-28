"""Per-user ride library — Phase 1 persistence.

Each user gets a folder on disk:

    data/users/<uid>/rides/<rideId>.json   analysed report (upload or Strava)
    data/users/<uid>/strava.json           lightweight Strava activity index

Strava activities appear on Home instantly as *stubs* (summary only). The full
report is computed lazily the first time a ride's Review is opened, then cached
as a normal ride file. This keeps the initial sync fast and within Strava's rate
limits. Swapping this for a real DB later only touches this file.
"""

from __future__ import annotations

import json
import os
import time
import uuid
from typing import List, Optional

from .lifecycle import enrich_summary
from .paths import users_dir

_USERS_DIR = users_dir()


def _rides_dir(uid: str) -> str:
    return os.path.join(_USERS_DIR, uid, "rides")


def _ride_path(uid: str, ride_id: str) -> str:
    return os.path.join(_rides_dir(uid), f"{ride_id}.json")


def _provider_index_path(uid: str) -> str:
    return os.path.join(_USERS_DIR, uid, "provider_rides.json")


def _ride_type(kind: str, distance_km: float) -> str:
    if kind == "race":
        return "Ultra Race" if distance_km >= 400 else "Race"
    if distance_km >= 200:
        return "Bikepacking"
    return "Training Ride"


def _summary(ride_id: str, saved_at: float, report: dict, source: str) -> dict:
    race = report.get("race", {})
    overview = report.get("overview", {})
    # Finished imports land in Reviewed once analysis exists; stubs stay Completed.
    return enrich_summary(
        {
            "id": ride_id,
            "savedAt": saved_at,
            "source": source,
            "analyzed": True,
            "status": "reviewed",
            "name": race.get("name") or "Untitled ride",
            "kind": race.get("kind", "training"),
            "date": race.get("startTime"),
            "distanceKm": overview.get("distanceKm", 0),
            "elevationGainM": overview.get("elevationGainM", 0),
            "durationS": overview.get("elapsedTimeS", 0),
            "movingTimeS": overview.get("movingTimeS", 0),
            "rideType": _ride_type(race.get("kind", "training"), overview.get("distanceKm", 0)),
        }
    )


# --------------------------------------------------------------------------- #
# analysed rides
# --------------------------------------------------------------------------- #
def save_ride(
    uid: str,
    report: dict,
    source: str = "upload",
    ride_id: Optional[str] = None,
    activities: Optional[list] = None,
) -> dict:
    """Persist analysed report. Optionally cache raw activities for Ultra stitching."""
    os.makedirs(_rides_dir(uid), exist_ok=True)
    rid = ride_id or uuid.uuid4().hex[:12]
    saved_at = time.time()
    payload: dict = {"id": rid, "savedAt": saved_at, "source": source, "report": report}
    if activities is not None:
        payload["activities"] = _activities_to_json(activities)
    elif os.path.isfile(_ride_path(uid, rid)):
        # Preserve previously cached samples when re-saving report-only.
        try:
            with open(_ride_path(uid, rid), "r", encoding="utf-8") as f:
                prev = json.load(f)
            if prev.get("activities") and "activities" not in payload:
                payload["activities"] = prev["activities"]
        except (OSError, json.JSONDecodeError):
            pass
    with open(_ride_path(uid, rid), "w", encoding="utf-8") as f:
        json.dump(payload, f)
    summary = _summary(rid, saved_at, report, source)
    try:
        from . import ultras as ultra_store

        ultra_store.recompute_ultras_containing(uid, rid)
        ultra_store.invalidate_ultras_containing(uid, rid)
    except Exception:  # noqa: BLE001
        pass
    return summary


def get_ride(uid: str, ride_id: str) -> Optional[dict]:
    try:
        with open(_ride_path(uid, ride_id), "r", encoding="utf-8") as f:
            return json.load(f)["report"]
    except (OSError, json.JSONDecodeError, KeyError):
        return None


def get_ride_payload(uid: str, ride_id: str) -> Optional[dict]:
    """Full on-disk ride document (report + optional activities)."""
    try:
        with open(_ride_path(uid, ride_id), "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def reconstruct_activity_from_report(report: dict, ride_id: str) -> Optional["Activity"]:
    """Best-effort Activity from a cached report when raw streams were never stored.

    Used for legacy uploads analysed before sample caching. Rebuilt samples are
    dense enough for Ultra stitching; open/re-import is still preferred.
    """
    from datetime import datetime

    from .models import Activity, Sample

    race = report.get("race") or {}
    ov = report.get("overview") or {}
    perf = report.get("performance") or {}
    axis = perf.get("axisKm") or []
    if len(axis) < 2:
        return None

    def _series(key: str) -> list:
        ch = perf.get(key) or {}
        return ch.get("series") or []

    elev = _series("elevation")
    speed = _series("speed")
    power = _series("power")
    hr = _series("hr")
    cadence = _series("cadence")

    start_iso = race.get("startTime")
    try:
        start = datetime.fromisoformat(str(start_iso).replace("Z", "+00:00")).timestamp() if start_iso else None
    except ValueError:
        start = None
    if start is None:
        return None

    elapsed = float(ov.get("elapsedTimeS") or 0)
    if elapsed <= 0:
        return None

    n = len(axis)
    samples = []
    for i in range(n):
        t = start + elapsed * (i / (n - 1))
        km = float(axis[i])
        sp = speed[i] if i < len(speed) else None
        speed_ms = None
        if sp is not None:
            speed_ms = float(sp) / 3.6 if float(sp) > 40 else float(sp)
        # Synthetic track so distance accumulates without GPS (1° lon ≈ 111.32 km).
        lon = km / 111.32
        samples.append(
            Sample(
                t=t,
                lat=0.0,
                lon=lon,
                ele=float(elev[i]) if i < len(elev) and elev[i] is not None else None,
                dist=km * 1000.0,
                speed=speed_ms,
                power=float(power[i]) if i < len(power) and power[i] is not None else None,
                hr=int(hr[i]) if i < len(hr) and hr[i] is not None else None,
                cadence=int(cadence[i]) if i < len(cadence) and cadence[i] is not None else None,
            )
        )
    return Activity(source_file=f"report:{ride_id}", sport="cycling", samples=samples)


def get_activities(uid: str, ride_id: str) -> list:
    """Return cached ``Activity`` list for stitching, or empty if unavailable."""
    payload = get_ride_payload(uid, ride_id)
    if not payload:
        return []
    return _activities_from_json(payload.get("activities") or [])


def has_activities(uid: str, ride_id: str) -> bool:
    acts = get_activities(uid, ride_id)
    return any(a.samples for a in acts)


def get_or_reconstruct_activities(uid: str, ride_id: str) -> list:
    """Cached activities, or reconstruct + persist from report for legacy rides."""
    acts = get_activities(uid, ride_id)
    if acts and any(a.samples for a in acts):
        return acts
    report = get_ride(uid, ride_id)
    if not report:
        return []
    activity = reconstruct_activity_from_report(report, ride_id)
    if not activity:
        return []
    # Persist so Ultra stitching does not reconstruct every time.
    save_ride(
        uid,
        report,
        source=(get_ride_payload(uid, ride_id) or {}).get("source") or "upload",
        ride_id=ride_id,
        activities=[activity],
    )
    return [activity]


def _activities_to_json(activities: list) -> list:
    out = []
    for a in activities:
        out.append(
            {
                "source_file": getattr(a, "source_file", "") or "",
                "sport": getattr(a, "sport", "cycling") or "cycling",
                "samples": [
                    {
                        "t": float(s.t),
                        "lat": s.lat,
                        "lon": s.lon,
                        "ele": s.ele,
                        "dist": s.dist,
                        "speed": s.speed,
                        "power": s.power,
                        "hr": s.hr,
                        "cadence": s.cadence,
                        "temp": s.temp,
                    }
                    for s in (a.samples or [])
                ],
            }
        )
    return out


def _activities_from_json(raw: list) -> list:
    from .models import Activity, Sample

    out = []
    for a in raw or []:
        samples = [
            Sample(
                t=float(s["t"]),
                lat=s.get("lat"),
                lon=s.get("lon"),
                ele=s.get("ele"),
                dist=s.get("dist"),
                speed=s.get("speed"),
                power=s.get("power"),
                hr=s.get("hr"),
                cadence=s.get("cadence"),
                temp=s.get("temp"),
            )
            for s in (a.get("samples") or [])
            if s.get("t") is not None
        ]
        if samples:
            out.append(
                Activity(
                    source_file=a.get("source_file") or "activity",
                    sport=a.get("sport") or "cycling",
                    samples=samples,
                )
            )
    return out


def delete_ride(uid: str, ride_id: str) -> bool:
    ok = False
    try:
        os.remove(_ride_path(uid, ride_id))
        ok = True
    except OSError:
        pass
    # also drop it from the provider index if present
    stubs = _load_provider_index(uid)
    kept = [s for s in stubs if s.get("id") != ride_id]
    if len(kept) != len(stubs):
        _save_provider_index(uid, kept)
        ok = True
    return ok


def list_rides(uid: str) -> List[dict]:
    out: List[dict] = []
    analyzed_ids = set()
    rides_dir = _rides_dir(uid)
    if os.path.isdir(rides_dir):
        for fname in os.listdir(rides_dir):
            if not fname.endswith(".json"):
                continue
            try:
                with open(os.path.join(rides_dir, fname), "r", encoding="utf-8") as f:
                    payload = json.load(f)
                out.append(
                    _summary(payload["id"], payload.get("savedAt", 0), payload["report"], payload.get("source", "upload"))
                )
                analyzed_ids.add(payload["id"])
            except (OSError, json.JSONDecodeError, KeyError):
                continue

    # provider stubs not yet analysed — finished activities awaiting Review
    for stub in _load_provider_index(uid):
        if stub.get("id") in analyzed_ids:
            continue
        out.append(
            enrich_summary(
                {
                    **stub,
                    "analyzed": False,
                    "status": stub.get("status") or "completed",
                }
            )
        )

    out.sort(key=lambda r: (r.get("date") or "", r.get("savedAt") or 0), reverse=True)
    return [enrich_summary(r) for r in out]


# --------------------------------------------------------------------------- #
# provider activity index (stubs from Strava and future providers)
# --------------------------------------------------------------------------- #
def _load_provider_index(uid: str) -> List[dict]:
    try:
        with open(_provider_index_path(uid), "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return []


def _save_provider_index(uid: str, stubs: List[dict]) -> None:
    os.makedirs(os.path.join(_USERS_DIR, uid), exist_ok=True)
    with open(_provider_index_path(uid), "w", encoding="utf-8") as f:
        json.dump(stubs, f)


def merge_provider_stubs(uid: str, stubs: List[dict]) -> int:
    """Merge freshly-fetched provider summaries into the index.

    New rides are added. Existing stubs get metadata refreshed (name, gear,
    photos) without wiping the entry — full analysis remains in the ride file.
    """
    existing = {s["id"]: s for s in _load_provider_index(uid)}
    added = 0
    for stub in stubs:
        prev = existing.get(stub["id"])
        if prev is None:
            existing[stub["id"]] = stub
            added += 1
        else:
            # refresh display fields; keep any richer fields we already had
            for key in (
                "name",
                "distanceKm",
                "elevationGainM",
                "durationS",
                "movingTimeS",
                "rideType",
                "kind",
                "date",
                "hasPhotos",
                "photoCount",
                "photoUrl",
                "gear",
                "gearName",
                "mapPolyline",
            ):
                if stub.get(key) is not None:
                    prev[key] = stub[key]
            existing[stub["id"]] = prev
    _save_provider_index(uid, list(existing.values()))
    return added


def get_stub(uid: str, ride_id: str) -> Optional[dict]:
    for s in _load_provider_index(uid):
        if s.get("id") == ride_id:
            return s
    return None


def has_quality_route(uid: str, ride_id: str) -> bool:
    """True when we have a real track — not sparse stop dots."""
    report = get_ride(uid, ride_id)
    if report and len((report.get("route") or {}).get("points") or []) >= 2:
        return True
    stub = get_stub(uid, ride_id)
    return bool(stub and stub.get("mapPolyline"))


def get_route_points(uid: str, ride_id: str, max_points: int = 360) -> list:
    """Lightweight polyline for editorial Ultra maps — never a full GPS dump.

    Preference order:
    1) analysed route preview
    2) Strava summary polyline (dense enough for atlas plates)
    3) stop locations (last resort — sparse, can look gappy)
    """
    from .util.geo import decode_polyline, decimate_points

    report = get_ride(uid, ride_id)
    if report:
        pts = (report.get("route") or {}).get("points") or []
        if len(pts) >= 2:
            return decimate_points(pts, max_points)

    stub = get_stub(uid, ride_id)
    if stub and stub.get("mapPolyline"):
        decoded = decode_polyline(stub["mapPolyline"])
        if len(decoded) >= 2:
            return decimate_points(decoded, max_points)

    if report:
        stops = ((report.get("stops") or {}).get("stops")) or []
        stop_pts = []
        for s in stops:
            lat, lon = s.get("lat"), s.get("lon")
            if lat is not None and lon is not None:
                stop_pts.append([float(lat), float(lon)])
        if len(stop_pts) >= 2:
            return decimate_points(stop_pts, max_points)
    return []


def set_stub_polyline(uid: str, ride_id: str, polyline: Optional[str]) -> None:
    """Cache a Strava summary polyline on the provider stub for Ultra previews."""
    if not polyline:
        return
    stubs = _load_provider_index(uid)
    changed = False
    for s in stubs:
        if s.get("id") == ride_id:
            if s.get("mapPolyline") != polyline:
                s["mapPolyline"] = polyline
                changed = True
            break
    if changed:
        _save_provider_index(uid, stubs)
