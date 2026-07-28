"""Setup readiness checklist — what a new developer sees before first login."""

from __future__ import annotations

import socket
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from .config import env_path, get_config
from .oauth_origin import (
    _is_forced_public_origin,
    google_redirect_uri,
    provider_redirect_uri,
)


def lan_ip() -> Optional[str]:
    """Best-effort local Wi‑Fi IPv4 (never 127.0.0.1)."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        if ip and not ip.startswith("127."):
            return ip
    except OSError:
        pass
    return None


def _check(id_: str, ok: bool, label: str, detail: str = "", fix: str = "") -> dict:
    return {"id": id_, "ok": ok, "label": label, "detail": detail, "fix": fix}


def build_setup_status(origin: Optional[str] = None) -> Dict[str, Any]:
    cfg = get_config()
    # Prefer configured public HTTPS origin (rydn.bike / named tunnel)
    if cfg.app_origin and _is_forced_public_origin(cfg.app_origin):
        origin = cfg.app_origin.rstrip("/")
    else:
        origin = (origin or cfg.app_origin).rstrip("/")

    ip = lan_ip()
    public = _is_forced_public_origin(origin)
    public_host = (urlparse(origin).hostname or "") if public else None

    google_id = cfg.google_client_id
    google_secret = cfg.google_client_secret
    strava_id = cfg.strava_client_id
    strava_secret = cfg.strava_client_secret

    google_id_format = bool(google_id) and google_id.endswith(".apps.googleusercontent.com")
    strava_id_format = bool(strava_id) and strava_id.isdigit()

    # OAuth registration targets — permanent HTTPS when configured
    if public and public_host:
        google_origins = [origin]
        google_redirects = [f"{origin}/api/auth/google/callback"]
        strava_domain = public_host
        strava_full = f"{origin}/api/providers/strava/callback"
        phone_url = origin
    else:
        google_origins = ["http://localhost:5180"]
        google_redirects = ["http://localhost:5180/api/auth/google/callback"]
        strava_domain = "localhost"
        strava_full = "http://localhost:5180/api/providers/strava/callback"
        phone_url = f"http://{ip}:5180" if ip else None

    checks: List[dict] = [
        _check("env_file", True, ".env file", env_path()),
        _check(
            "google_client_id",
            bool(google_id),
            "Google Client ID loaded",
            "SET" if google_id else "empty",
            fix="Paste GOOGLE_CLIENT_ID into backend/.env" if not google_id else "",
        ),
        _check(
            "google_client_secret",
            bool(google_secret),
            "Google Secret loaded",
            "SET" if google_secret else "empty",
            fix="Paste GOOGLE_CLIENT_SECRET into backend/.env" if not google_secret else "",
        ),
        _check(
            "google_id_format",
            (not google_id) or google_id_format,
            "Google Client ID format",
            "looks valid" if google_id_format else ("missing" if not google_id else "unexpected format"),
            fix="Should end with .apps.googleusercontent.com" if google_id and not google_id_format else "",
        ),
        _check(
            "strava_client_id",
            bool(strava_id),
            "Strava Client ID loaded",
            "SET" if strava_id else "empty",
            fix="Paste STRAVA_CLIENT_ID into backend/.env" if not strava_id else "",
        ),
        _check(
            "strava_client_secret",
            bool(strava_secret),
            "Strava Secret loaded",
            "SET" if strava_secret else "empty",
            fix="Paste STRAVA_CLIENT_SECRET into backend/.env" if not strava_secret else "",
        ),
        _check(
            "strava_id_format",
            (not strava_id) or strava_id_format,
            "Strava Client ID format",
            "looks valid" if strava_id_format else ("missing" if not strava_id else "should be numeric"),
            fix="Strava Client ID is usually a number" if strava_id and not strava_id_format else "",
        ),
        _check(
            "tunnel",
            public,
            "Public HTTPS origin",
            origin if public else "not set — ULTRA_APP_ORIGIN should be https://rydn.bike",
            fix="Set ULTRA_APP_ORIGIN=https://rydn.bike and run the named Cloudflare Tunnel" if not public else "",
        ),
        _check("redirect_urls", True, "Redirect URLs (register these)", "ready to copy"),
        _check("backend", True, "Backend reachable", "this process"),
        _check(
            "phone_url",
            bool(phone_url),
            "Phone URL",
            phone_url or "waiting for https://rydn.bike",
        ),
    ]

    missing = [
        c
        for c in checks
        if not c["ok"] and c["id"] not in ("redirect_urls", "backend", "env_file", "tunnel")
    ]
    ready_for_google = bool(google_id and google_secret)
    ready_for_strava = bool(strava_id and strava_secret)

    return {
        "ready": ready_for_google,
        "readyForGoogle": ready_for_google,
        "readyForStrava": ready_for_strava,
        "tunnelActive": public,
        "envPath": env_path(),
        "lanIp": ip,
        "desktopUrl": "http://localhost:5180",
        "tunnelUrl": origin if public else None,
        "phoneUrl": phone_url,
        "backendUrl": "http://127.0.0.1:8100",
        "origin": origin,
        "googleRedirectUri": google_redirect_uri(origin),
        "stravaRedirectUri": provider_redirect_uri(origin, "strava"),
        "register": {
            "googleOrigins": google_origins,
            "googleRedirectUris": google_redirects,
            "stravaCallbackDomain": strava_domain,
            "stravaCallbackDomainDesktop": "localhost",
            "stravaFullRedirect": strava_full,
        },
        "checks": checks,
        "nextStep": _next_step(ready_for_google, ready_for_strava, public),
        "missingCount": len(missing),
    }


def _next_step(google: bool, strava: bool, public: bool) -> str:
    from .config import get_config

    cfg = get_config()
    if not public:
        return f"Set PUBLIC_URL={cfg.public_url or 'https://rydn.bike'} and run ./dev.sh"
    if not google:
        return (
            "Paste GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET into ultra-analytics/.env. "
            f"Register {cfg.app_url} and {cfg.google_redirect_uri} in Google Cloud."
        )
    if not strava:
        from urllib.parse import urlparse

        host = urlparse(cfg.app_url).hostname or "rydn.bike"
        return f"Set Strava Authorization Callback Domain to {host}, then Continue with Google."
    return f"Open {cfg.app_url} → Continue with Google → Connect Strava."
