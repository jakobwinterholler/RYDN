"""Strava ride provider.

Connect once; activity *summaries* import fast (Home fills up); each ride's full
per-second streams are fetched lazily on first Review open, then cached. Strava
streams map onto the canonical Sample/Activity/Race so every analyzer is
source-agnostic.
"""

from __future__ import annotations

import time
from datetime import datetime
from typing import Callable, Dict, List, Optional
from urllib.parse import urlencode

import httpx

from ..config import get_config
from ..models import Activity, Race, Sample
from ..util.usage_meter import record as record_usage
from .base import RideProvider

_AUTH = "https://www.strava.com/oauth/authorize"
_TOKEN = "https://www.strava.com/oauth/token"
_API = "https://www.strava.com/api/v3"

_RIDE_TYPES = {
    "Ride",
    "VirtualRide",
    "GravelRide",
    "MountainBikeRide",
    "EBikeRide",
    "EMountainBikeRide",
}


def _ride_kind(distance_km: float) -> str:
    return "race" if distance_km >= 300 else "training"


def _ride_type_label(kind: str, distance_km: float) -> str:
    if kind == "race":
        return "Ultra Race" if distance_km >= 400 else "Race"
    if distance_km >= 200:
        return "Bikepacking"
    return "Training Ride"


def _epoch(iso: Optional[str]) -> float:
    if not iso:
        return 0.0
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


class StravaProvider(RideProvider):
    id = "strava"
    label = "Strava"

    def enabled(self) -> bool:
        return get_config().strava_enabled

    def authorize_url(self, state: str, redirect_uri: Optional[str] = None) -> str:
        cfg = get_config()
        params = {
            "client_id": cfg.strava_client_id,
            "redirect_uri": redirect_uri or cfg.strava_redirect_uri,
            "response_type": "code",
            "approval_prompt": "auto",
            "scope": "read,activity:read_all,profile:read_all",
            "state": state,
        }
        return f"{_AUTH}?{urlencode(params)}"

    async def exchange_code(self, code: str, redirect_uri: Optional[str] = None) -> dict:
        cfg = get_config()
        async with httpx.AsyncClient(timeout=20) as client:
            res = await client.post(
                _TOKEN,
                data={
                    "client_id": cfg.strava_client_id,
                    "client_secret": cfg.strava_client_secret,
                    "code": code,
                    "grant_type": "authorization_code",
                },
            )
        record_usage("strava.oauth", ok=res.is_success)
        res.raise_for_status()
        tok = res.json()
        athlete = tok.get("athlete", {})
        return {
            "athleteId": athlete.get("id"),
            "accessToken": tok["access_token"],
            "refreshToken": tok["refresh_token"],
            "expiresAt": tok["expires_at"],
            "lastSyncAt": None,
            "athlete": _athlete_public(athlete),
            "gear": {},
        }

    async def valid_token(self, connection: dict, on_refresh: Callable[[dict], None]) -> str:
        if connection["expiresAt"] > time.time() + 60:
            return connection["accessToken"]
        cfg = get_config()
        async with httpx.AsyncClient(timeout=20) as client:
            res = await client.post(
                _TOKEN,
                data={
                    "client_id": cfg.strava_client_id,
                    "client_secret": cfg.strava_client_secret,
                    "grant_type": "refresh_token",
                    "refresh_token": connection["refreshToken"],
                },
            )
        record_usage("strava.oauth", ok=res.is_success)
        res.raise_for_status()
        tok = res.json()
        connection["accessToken"] = tok["access_token"]
        connection["refreshToken"] = tok["refresh_token"]
        connection["expiresAt"] = tok["expires_at"]
        on_refresh(connection)
        return connection["accessToken"]

    async def fetch_athlete_and_gear(self, token: str) -> Dict:
        """Athlete profile + bike gear map (id → name)."""
        async with httpx.AsyncClient(timeout=20) as client:
            res = await client.get(
                f"{_API}/athlete",
                headers={"Authorization": f"Bearer {token}"},
            )
            record_usage("strava.api", ok=res.is_success)
            res.raise_for_status()
            athlete = res.json()
        gear: Dict[str, str] = {}
        for bike in athlete.get("bikes") or []:
            if bike.get("id") and bike.get("name"):
                gear[bike["id"]] = bike["name"]
        for shoe in athlete.get("shoes") or []:
            if shoe.get("id") and shoe.get("name"):
                gear[shoe["id"]] = shoe["name"]
        return {"athlete": _athlete_public(athlete), "gear": gear}

    async def enrich_recent_photos(
        self, token: str, stubs: List[dict], limit: int = 25
    ) -> None:
        """Pull primary photo URLs for the newest rides that have photos.

        Strava's activity list only exposes a count — the URL needs a detail
        fetch. We cap this to stay inside rate limits; older rides keep
        ``hasPhotos: true`` without a URL until opened later.
        """
        candidates = [s for s in stubs if s.get("hasPhotos") and not s.get("photoUrl")][:limit]
        if not candidates:
            return
        async with httpx.AsyncClient(timeout=20) as client:
            for stub in candidates:
                try:
                    res = await client.get(
                        f"{_API}/activities/{stub['externalId']}",
                        headers={"Authorization": f"Bearer {token}"},
                        params={"include_all_efforts": "false"},
                    )
                    record_usage("strava.api", ok=res.status_code == 200)
                    if res.status_code == 429:
                        break
                    if res.status_code != 200:
                        continue
                    act = res.json()
                    photos = act.get("photos") or {}
                    primary = photos.get("primary") or {}
                    urls = primary.get("urls") or {}
                    # Prefer a mid-size URL when Strava provides sized keys
                    photo = urls.get("600") or urls.get("100") or next(iter(urls.values()), None)
                    if photo:
                        stub["photoUrl"] = photo
                    gear_id = act.get("gear_id") or stub.get("gear")
                    if gear_id:
                        stub["gear"] = gear_id
                except Exception:  # noqa: BLE001
                    continue

    def _to_stub(self, act: dict, gear_map: Optional[Dict[str, str]] = None) -> dict:
        distance_km = round((act.get("distance") or 0) / 1000.0, 1)
        kind = _ride_kind(distance_km)
        gear_id = act.get("gear_id")
        gear_name = (gear_map or {}).get(gear_id) if gear_id else None
        map_obj = act.get("map") or {}
        polyline = map_obj.get("summary_polyline") or map_obj.get("polyline")
        return {
            "id": f"strava_{act['id']}",
            "provider": self.id,
            "externalId": str(act["id"]),
            "savedAt": 0,
            "source": "strava",
            "analyzed": False,
            "name": act.get("name") or "Strava ride",
            "kind": kind,
            "date": act.get("start_date"),
            "distanceKm": distance_km,
            "elevationGainM": round(act.get("total_elevation_gain") or 0),
            "durationS": round(act.get("elapsed_time") or 0),
            "movingTimeS": round(act.get("moving_time") or 0),
            "rideType": _ride_type_label(kind, distance_km),
            "hasPhotos": (act.get("total_photo_count") or 0) > 0,
            "photoCount": act.get("total_photo_count") or 0,
            "gear": gear_id,
            "gearName": gear_name,
            "mapPolyline": polyline,
        }

    async def list_activity_stubs(self, token: str, gear_map: Optional[Dict[str, str]] = None) -> List[dict]:
        stubs: List[dict] = []
        async with httpx.AsyncClient(timeout=30) as client:
            page = 1
            while page <= 20:  # up to ~4000 activities
                res = await client.get(
                    f"{_API}/athlete/activities",
                    headers={"Authorization": f"Bearer {token}"},
                    params={"per_page": 200, "page": page},
                )
                record_usage("strava.api", ok=res.status_code == 200)
                if res.status_code == 429:
                    break
                res.raise_for_status()
                batch = res.json()
                if not batch:
                    break
                for act in batch:
                    if act.get("type") in _RIDE_TYPES or act.get("sport_type") in _RIDE_TYPES:
                        stubs.append(self._to_stub(act, gear_map))
                page += 1
        # Newest first (Strava usually returns this, but don't rely on it)
        stubs.sort(key=lambda s: s.get("date") or "", reverse=True)
        return stubs

    async def fetch_map_polyline(self, token: str, external_id: str) -> Optional[str]:
        """Summary polyline only — cheap call for Ultra route previews."""
        async with httpx.AsyncClient(timeout=20) as client:
            res = await client.get(
                f"{_API}/activities/{external_id}",
                headers={"Authorization": f"Bearer {token}"},
            )
        record_usage("strava.api", ok=res.status_code == 200)
        if res.status_code != 200:
            return None
        act = res.json()
        map_obj = act.get("map") or {}
        return map_obj.get("summary_polyline") or map_obj.get("polyline")

    async def fetch_streams(self, token: str, external_id: str) -> dict:
        async with httpx.AsyncClient(timeout=60) as client:
            res = await client.get(
                f"{_API}/activities/{external_id}/streams",
                headers={"Authorization": f"Bearer {token}"},
                params={
                    "keys": "time,latlng,distance,altitude,velocity_smooth,heartrate,cadence,watts,temp",
                    "key_by_type": "true",
                },
            )
        record_usage("strava.api", ok=res.is_success)
        res.raise_for_status()
        return res.json()

    def streams_to_race(self, stub: dict, streams: dict) -> Race:
        start = _epoch(stub.get("date"))

        def col(key: str) -> list:
            node = streams.get(key)
            return node.get("data", []) if isinstance(node, dict) else []

        t = col("time")
        latlng = col("latlng")
        dist = col("distance")
        alt = col("altitude")
        vel = col("velocity_smooth")
        hr = col("heartrate")
        cad = col("cadence")
        watts = col("watts")
        temp = col("temp")
        n = len(t)
        if n == 0:
            raise ValueError("This ride has no GPS/sensor stream.")

        def get(seq: list, i: int):
            return seq[i] if i < len(seq) else None

        samples: List[Sample] = []
        for i in range(n):
            ll = get(latlng, i)
            samples.append(
                Sample(
                    t=start + (t[i] or 0),
                    lat=ll[0] if isinstance(ll, list) and len(ll) == 2 else None,
                    lon=ll[1] if isinstance(ll, list) and len(ll) == 2 else None,
                    ele=get(alt, i),
                    dist=get(dist, i),
                    speed=get(vel, i),
                    power=get(watts, i),
                    hr=get(hr, i),
                    cadence=get(cad, i),
                    temp=get(temp, i),
                )
            )
        activity = Activity(source_file=f"strava:{stub['externalId']}", samples=samples)
        return Race(
            name=stub.get("name") or "Strava ride",
            kind=stub.get("kind", "training"),
            activities=[activity],
        )


def _athlete_public(athlete: dict) -> dict:
    return {
        "id": athlete.get("id"),
        "firstname": athlete.get("firstname"),
        "lastname": athlete.get("lastname"),
        "profile": athlete.get("profile") or athlete.get("profile_medium"),
        "city": athlete.get("city"),
        "country": athlete.get("country"),
        "sex": athlete.get("sex"),
        "weight": athlete.get("weight"),
    }
