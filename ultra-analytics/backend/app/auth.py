"""Authentication — Continue with Google, plus a local dev fallback.

Deliberately minimal: one provider (Google), one session cookie (60 days).
When Google credentials aren't configured, ``/api/auth/dev-login`` creates a
local account so the app is usable while you finish SETUP.md.

OAuth redirect URIs are derived from the request Host so the same flow works on
``localhost`` (desktop) and ``http://192.168.x.x:5180`` (phone on Wi‑Fi).
"""

from __future__ import annotations

import secrets
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse

from .config import get_config
from .cookies import clear_cookie, cookie_kwargs
from .oauth_origin import google_redirect_uri, provider_redirect_uri, request_origin
from .users import (
    COOKIE_NAME,
    get_user,
    get_or_create_dev_user,
    parse_weight_kg,
    public_user,
    read_session,
    save_user,
    sign_session,
    upsert_google_user,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

_STATE_COOKIE = "ultra_oauth_state"
_ORIGIN_COOKIE = "ultra_oauth_origin"
_GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
_GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"
_GOOGLE_USERINFO = "https://openidconnect.googleapis.com/v1/userinfo"


def _set_session(response: Response, uid: str) -> None:
    """Persistent signed session — survives refresh and browser restarts."""
    response.set_cookie(
        COOKIE_NAME,
        sign_session(uid),
        **cookie_kwargs(60 * 60 * 24 * 60),  # 60 days
    )


def current_user(request: Request) -> dict:
    """FastAPI dependency: the signed-in user, or 401."""
    uid = read_session(request.cookies.get(COOKIE_NAME))
    user = get_user(uid) if uid else None
    if not user:
        raise HTTPException(status_code=401, detail="Not signed in.")
    return user


@router.get("/config")
def config(request: Request) -> dict:
    from .setup_status import build_setup_status

    cfg = get_config()
    origin = request_origin(request)
    status = build_setup_status(origin)
    return {
        "googleEnabled": cfg.google_enabled,
        "stravaEnabled": cfg.strava_enabled,
        "origin": origin,
        "googleRedirectUri": google_redirect_uri(origin),
        "stravaRedirectUri": provider_redirect_uri(origin, "strava"),
        "setup": status,
    }


@router.get("/setup")
def setup(request: Request) -> dict:
    """Full readiness checklist for onboarding / setup.sh."""
    from .setup_status import build_setup_status

    return build_setup_status(request_origin(request))


@router.get("/me")
def me(request: Request) -> JSONResponse:
    uid = read_session(request.cookies.get(COOKIE_NAME))
    user = get_user(uid) if uid else None
    if not user:
        raise HTTPException(status_code=401, detail="Not signed in.")
    return JSONResponse(public_user(user))


@router.post("/logout")
def logout() -> JSONResponse:
    resp = JSONResponse({"ok": True})
    clear_cookie(resp, COOKIE_NAME)
    return resp


@router.post("/onboarded")
def mark_onboarded(request: Request) -> JSONResponse:
    """Record that the user has passed the first-launch provider prompt."""
    import time

    user = current_user(request)
    if not user.get("onboardedAt"):
        user["onboardedAt"] = time.time()
        save_user(user)
    return JSONResponse(public_user(user))


@router.patch("/profile")
async def update_profile(request: Request) -> JSONResponse:
    """Update editable profile fields (body weight for W/kg). Pass weightKg: null to clear."""
    user = current_user(request)
    try:
        body = await request.json()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Invalid JSON body.") from e
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Expected a JSON object.")

    if "weightKg" in body:
        try:
            user["weightKg"] = parse_weight_kg(body.get("weightKg"))
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    save_user(user)
    return JSONResponse(public_user(user))


@router.post("/dev-login")
def dev_login() -> JSONResponse:
    """Local, credential-free sign-in. Only when Google isn't configured."""
    if get_config().google_enabled:
        raise HTTPException(status_code=400, detail="Use Continue with Google.")
    user = get_or_create_dev_user()
    resp = JSONResponse(public_user(user))
    _set_session(resp, user["id"])
    return resp


@router.get("/google/login")
def google_login(request: Request) -> RedirectResponse:
    cfg = get_config()
    if not cfg.google_enabled:
        raise HTTPException(status_code=400, detail="Google sign-in is not configured.")
    origin = request_origin(request)
    redirect_uri = google_redirect_uri(origin)
    state = secrets.token_urlsafe(24)
    params = {
        "client_id": cfg.google_client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "access_type": "online",
        "prompt": "select_account",
        "include_granted_scopes": "true",
    }
    resp = RedirectResponse(f"{_GOOGLE_AUTH}?{urlencode(params)}")
    kw = cookie_kwargs(600)
    resp.set_cookie(_STATE_COOKIE, state, **kw)
    resp.set_cookie(_ORIGIN_COOKIE, origin, **kw)
    return resp


@router.get("/google/callback")
async def google_callback(request: Request, code: str = "", state: str = "") -> RedirectResponse:
    cfg = get_config()
    origin = (request.cookies.get(_ORIGIN_COOKIE) or request_origin(request)).rstrip("/")
    expected = request.cookies.get(_STATE_COOKIE)
    if not code or not state or state != expected:
        return RedirectResponse(f"{origin}/?auth_error=state")

    redirect_uri = google_redirect_uri(origin)
    async with httpx.AsyncClient(timeout=15) as client:
        token_res = await client.post(
            _GOOGLE_TOKEN,
            data={
                "code": code,
                "client_id": cfg.google_client_id,
                "client_secret": cfg.google_client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        if token_res.status_code != 200:
            return RedirectResponse(f"{origin}/?auth_error=token")
        access_token = token_res.json().get("access_token")
        info_res = await client.get(
            _GOOGLE_USERINFO, headers={"Authorization": f"Bearer {access_token}"}
        )
        if info_res.status_code != 200:
            return RedirectResponse(f"{origin}/?auth_error=userinfo")
        info = info_res.json()

    user = upsert_google_user(
        sub=info["sub"],
        email=info.get("email", ""),
        name=info.get("name", ""),
        picture=info.get("picture", ""),
    )
    resp = RedirectResponse(f"{origin}/")
    clear_cookie(resp, _STATE_COOKIE)
    clear_cookie(resp, _ORIGIN_COOKIE)
    _set_session(resp, user["id"])
    return resp
