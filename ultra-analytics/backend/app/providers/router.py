"""HTTP surface for ride providers — one generic router for all of them.

Routes are provider-agnostic: /api/providers, /api/providers/{id}/connect,
/callback, /sync. Auth stays in its own module; this only deals with *where rides
come from*.

Redirect URIs follow the browser origin (localhost or LAN IP) so phone OAuth
returns to the same host the user opened.

Provider OAuth uses industry-standard CSRF protection: a random ``state`` value
stored in an HttpOnly cookie, bound to the signed-in session that started connect.
"""

from __future__ import annotations

import secrets
import time
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse, Response

from .. import store
from ..analysis.report import build_report
from ..auth import current_user
from ..config import get_config
from ..cookies import clear_cookie, cookie_kwargs
from ..oauth_origin import provider_redirect_uri, request_origin
from ..users import COOKIE_NAME, get_user, read_session, save_user
from ..util.http_errors import MSG_SYNC
from ..util.logging_util import log_exception
from . import get_provider, list_providers

router = APIRouter(prefix="/api/providers", tags=["providers"])

_ORIGIN_COOKIE = "ultra_provider_origin"
_STATE_COOKIE = "ultra_provider_oauth_state"
_UID_COOKIE = "ultra_provider_oauth_uid"
_OAUTH_COOKIE_MAX_AGE = 600


def _clear_oauth_cookies(resp: RedirectResponse) -> None:
    clear_cookie(resp, _ORIGIN_COOKIE)
    clear_cookie(resp, _STATE_COOKIE)
    clear_cookie(resp, _UID_COOKIE)


def _connection(user: dict, pid: str) -> Optional[dict]:
    return (user.get("providers") or {}).get(pid)


def _store_connection(user: dict, pid: str, connection: dict) -> None:
    user.setdefault("providers", {})[pid] = connection
    save_user(user)


@router.get("")
def providers_status(user: dict = Depends(current_user)) -> JSONResponse:
    return JSONResponse([p.status(_connection(user, p.id)) for p in list_providers()])


@router.get("/{pid}/oauth-debug")
def oauth_debug(pid: str, request: Request, user: dict = Depends(current_user)) -> JSONResponse:
    """Exact OAuth authorize URL Ultra would send — gated behind ULTRA_OAUTH_DEBUG."""
    from urllib.parse import parse_qs, urlparse

    if not get_config().oauth_debug:
        raise HTTPException(status_code=404, detail="Not found.")
    provider = get_provider(pid)
    if not provider:
        raise HTTPException(status_code=404, detail="Unknown provider.")
    origin = request_origin(request)
    redirect_uri = provider_redirect_uri(origin, pid)
    # Placeholder state only — real connect uses a random CSRF token.
    authorize = provider.authorize_url(state="debug-state", redirect_uri=redirect_uri)
    parsed = urlparse(redirect_uri)
    qs = parse_qs(urlparse(authorize).query)
    return JSONResponse(
        {
            "provider": pid,
            "origin": origin,
            "redirect_uri": redirect_uri,
            "redirect_uri_host": parsed.hostname,
            "redirect_uri_from_authorize_query": (qs.get("redirect_uri") or [None])[0],
            "authorize_url": authorize,
            "strava_callback_domain_must_be": parsed.hostname,
            "hint": (
                "In Strava → settings/api → Authorization Callback Domain, paste ONLY the host "
                f"(no https://): {parsed.hostname}"
            ),
        }
    )


@router.get("/{pid}/connect")
def connect(pid: str, request: Request, user: dict = Depends(current_user)) -> Response:
    provider = get_provider(pid)
    if not provider:
        raise HTTPException(status_code=404, detail="Unknown provider.")
    if not provider.enabled():
        raise HTTPException(status_code=400, detail=f"{provider.label} is not configured.")
    origin = request_origin(request)
    redirect_uri = provider_redirect_uri(origin, pid)
    state = secrets.token_urlsafe(24)
    authorize = provider.authorize_url(state=state, redirect_uri=redirect_uri)

    # Always log the exact URL Ultra sends — no guessing when OAuth fails.
    print(
        f"[oauth:{pid}] origin={origin}\n"
        f"[oauth:{pid}] redirect_uri={redirect_uri}\n"
        f"[oauth:{pid}] authorize_url={authorize}",
        flush=True,
    )

    # Optional: return JSON instead of redirecting (?debug=1) — gated.
    if request.query_params.get("debug") == "1":
        if not get_config().oauth_debug:
            raise HTTPException(status_code=404, detail="Not found.")
        from urllib.parse import urlparse as _up

        return JSONResponse(
            {
                "origin": origin,
                "redirect_uri": redirect_uri,
                "redirect_uri_host": _up(redirect_uri).hostname,
                "authorize_url": authorize,
                "state": state,
                "uid": user["id"],
            }
        )

    resp = RedirectResponse(authorize)
    kw = cookie_kwargs(_OAUTH_COOKIE_MAX_AGE)
    resp.set_cookie(_ORIGIN_COOKIE, origin, **kw)
    resp.set_cookie(_STATE_COOKIE, state, **kw)
    # Bind OAuth to the session that started connect (prevents account takeover via state).
    resp.set_cookie(_UID_COOKIE, user["id"], **kw)
    return resp


@router.get("/{pid}/callback")
async def callback(
    pid: str, request: Request, code: str = "", state: str = "", error: str = ""
) -> RedirectResponse:
    origin = (request.cookies.get(_ORIGIN_COOKIE) or request_origin(request)).rstrip("/")
    provider = get_provider(pid)
    if not provider:
        resp = RedirectResponse(f"{origin}/?provider_error=unknown")
        _clear_oauth_cookies(resp)
        return resp
    if error or not code:
        resp = RedirectResponse(f"{origin}/?provider_error={error or 'denied'}")
        _clear_oauth_cookies(resp)
        return resp

    expected_state = request.cookies.get(_STATE_COOKIE)
    intended_uid = request.cookies.get(_UID_COOKIE)
    session_uid = read_session(request.cookies.get(COOKIE_NAME))
    if not state or not expected_state or state != expected_state:
        resp = RedirectResponse(f"{origin}/?provider_error=state")
        _clear_oauth_cookies(resp)
        return resp
    if not intended_uid or not session_uid or session_uid != intended_uid:
        resp = RedirectResponse(f"{origin}/?provider_error=session")
        _clear_oauth_cookies(resp)
        return resp

    user = get_user(session_uid)
    if not user:
        resp = RedirectResponse(f"{origin}/?provider_error=session")
        _clear_oauth_cookies(resp)
        return resp

    redirect_uri = provider_redirect_uri(origin, pid)
    try:
        connection = await provider.exchange_code(code, redirect_uri=redirect_uri)
    except Exception:  # noqa: BLE001
        resp = RedirectResponse(f"{origin}/?provider_error=token")
        _clear_oauth_cookies(resp)
        return resp
    _store_connection(user, pid, connection)
    resp = RedirectResponse(f"{origin}/?connected={pid}")
    _clear_oauth_cookies(resp)
    return resp


@router.post("/{pid}/sync")
async def sync(pid: str, user: dict = Depends(current_user)) -> JSONResponse:
    provider = get_provider(pid)
    if not provider:
        raise HTTPException(status_code=404, detail="Unknown provider.")
    connection = _connection(user, pid)
    if not connection:
        raise HTTPException(status_code=400, detail=f"{provider.label} not connected.")

    def on_refresh(conn: dict) -> None:
        _store_connection(user, pid, conn)

    try:
        token = await provider.valid_token(connection, on_refresh)

        # Athlete + gear (Strava and future providers that implement it)
        gear_map = connection.get("gear") or {}
        if hasattr(provider, "fetch_athlete_and_gear"):
            meta = await provider.fetch_athlete_and_gear(token)  # type: ignore[attr-defined]
            connection["athlete"] = meta.get("athlete") or connection.get("athlete")
            connection["gear"] = meta.get("gear") or {}
            gear_map = connection["gear"]
            _store_connection(user, pid, connection)

        stubs = await provider.list_activity_stubs(token, gear_map=gear_map)

        if hasattr(provider, "enrich_recent_photos"):
            await provider.enrich_recent_photos(token, stubs)  # type: ignore[attr-defined]
    except Exception as exc:  # noqa: BLE001
        log_exception("provider.sync_failed", exc, provider=pid)
        raise HTTPException(status_code=502, detail=MSG_SYNC)

    added = store.merge_provider_stubs(user["id"], stubs)
    connection["lastSyncAt"] = time.time()
    _store_connection(user, pid, connection)

    # Newest first names for the sync UI
    names = [s.get("name") or "Ride" for s in stubs[:8]]
    return JSONResponse(
        {
            "added": added,
            "fetched": len(stubs),
            "names": names,
            "athlete": connection.get("athlete"),
        }
    )


async def ensure_map_polylines(user: dict, activity_ids: List[str], limit: int = 8) -> int:
    """Backfill Strava summary polylines for Ultra route previews.

    Cheap per-activity calls — only for members still missing a polyline/route.
    """
    filled = 0
    for aid in activity_ids:
        if filled >= limit:
            break
        if store.has_quality_route(user["id"], aid):
            continue
        stub = store.get_stub(user["id"], aid)
        if not stub or stub.get("provider") != "strava" or not stub.get("externalId"):
            continue
        provider = get_provider("strava")
        if not provider or not hasattr(provider, "fetch_map_polyline"):
            continue
        connection = _connection(user, "strava")
        if not connection:
            continue

        def on_refresh(conn: dict) -> None:
            _store_connection(user, "strava", conn)

        try:
            token = await provider.valid_token(connection, on_refresh)
            poly = await provider.fetch_map_polyline(token, stub["externalId"])  # type: ignore[attr-defined]
            if poly:
                store.set_stub_polyline(user["id"], aid, poly)
                filled += 1
        except Exception:  # noqa: BLE001
            continue
    return filled


async def analyze_provider_ride(user: dict, ride_id: str) -> Optional[dict]:
    """Lazy: fetch a provider stub's streams, analyse, cache as a normal ride."""
    stub = store.get_stub(user["id"], ride_id)
    if not stub:
        return None
    provider = get_provider(stub.get("provider", ""))
    if not provider:
        raise HTTPException(status_code=400, detail="Unknown provider for this ride.")
    connection = _connection(user, provider.id)
    if not connection:
        raise HTTPException(status_code=400, detail=f"{provider.label} not connected.")

    def on_refresh(conn: dict) -> None:
        _store_connection(user, provider.id, conn)

    try:
        token = await provider.valid_token(connection, on_refresh)
        streams = await provider.fetch_streams(token, stub["externalId"])
    except Exception as exc:  # noqa: BLE001
        log_exception("provider.fetch_failed", exc, provider=provider.id, ride_id=ride_id)
        raise HTTPException(
            status_code=502,
            detail=f"Could not fetch this ride from {provider.label}. Try again in a moment.",
        )

    try:
        race = provider.streams_to_race(stub, streams)
    except ValueError:
        raise HTTPException(
            status_code=422,
            detail="This activity could not be analysed. It may be incomplete on the provider.",
        )
    report = build_report(race)
    # Attach light Strava metadata onto the report for Review
    if stub.get("gearName"):
        report.setdefault("meta", {})["gear"] = stub["gearName"]
    if stub.get("photoUrl"):
        report.setdefault("meta", {})["photoUrl"] = stub["photoUrl"]
    store.save_ride(user["id"], report, source=provider.id, ride_id=ride_id, activities=race.activities)
    return report
