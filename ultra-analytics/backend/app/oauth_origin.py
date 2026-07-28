"""Resolve the browser origin for OAuth redirects.

Supports:
  • Permanent public domain (``https://rydn.bike``) — preferred
  • Named Cloudflare Tunnel hostnames
  • Legacy quick tunnels (``*.trycloudflare.com``)
  • localhost (desktop-only fallback when no public origin is configured)

When ``ULTRA_APP_ORIGIN`` is an ``https://`` public URL, OAuth *always* uses that
origin so Google/Strava redirect URIs stay fixed forever — even if you also open
``http://localhost:5180`` on the desktop.
"""

from __future__ import annotations

from urllib.parse import urlparse

from fastapi import Request

from .config import get_config

_ALLOWED_HOST_SUFFIXES = (
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
)

_TUNNEL_SUFFIXES = (
    ".trycloudflare.com",
    ".cfargotunnel.com",
)


def _is_tunnel_host(host: str) -> bool:
    h = (host or "").lower().split(":")[0]
    return any(h.endswith(s) for s in _TUNNEL_SUFFIXES)


def _is_tunnel_origin(origin: str) -> bool:
    try:
        return _is_tunnel_host(urlparse(origin).hostname or "")
    except Exception:  # noqa: BLE001
        return False


def _is_local_host(host: str) -> bool:
    h = (host or "").lower().split(":")[0]
    return h in _ALLOWED_HOST_SUFFIXES or h.endswith(".local")


def _is_forced_public_origin(origin: str) -> bool:
    """True for permanent HTTPS app origins (rydn.bike, named tunnels, …)."""
    try:
        parsed = urlparse((origin or "").rstrip("/"))
        if parsed.scheme != "https" or not parsed.hostname:
            return False
        return not _is_local_host(parsed.hostname)
    except Exception:  # noqa: BLE001
        return False


def _is_private_or_local(host: str) -> bool:
    h = host.lower().split(":")[0]
    if _is_local_host(h):
        return True
    if _is_tunnel_host(h):
        return True
    # Custom public domains arriving via CF (Host: rydn.bike) are allowed.
    if "." in h and not h.replace(".", "").isdigit():
        # Any hostname with a dot — treated as routable for Host header purposes.
        # Private LAN IPs still handled below.
        pass
    if h.startswith("10.") or h.startswith("192.168."):
        return True
    if h.startswith("172."):
        try:
            second = int(h.split(".")[1])
            return 16 <= second <= 31
        except (IndexError, ValueError):
            return False
    # Public hostname (rydn.bike) — accept when Cloudflare forwards it
    if "." in h and not h[0].isdigit():
        return True
    return False


def request_origin(request: Request) -> str:
    """Origin used for OAuth redirects and post-login return."""
    cfg = get_config()

    def _normalize(origin: str) -> str:
        return origin.replace("://127.0.0.1", "://localhost").rstrip("/")

    # Permanent / tunnel mode: always use the configured public HTTPS origin so
    # registered Google/Strava redirect URIs never drift.
    if cfg.app_origin and _is_forced_public_origin(cfg.app_origin):
        return cfg.app_origin.rstrip("/")

    origin = (request.headers.get("origin") or "").rstrip("/")
    if origin:
        host = urlparse(origin).hostname or ""
        if _is_private_or_local(host):
            return _normalize(origin)

    referer = request.headers.get("referer") or ""
    if referer:
        parsed = urlparse(referer)
        if parsed.scheme and parsed.netloc and _is_private_or_local(parsed.hostname or ""):
            return _normalize(f"{parsed.scheme}://{parsed.netloc}")

    host = (request.headers.get("x-forwarded-host") or request.headers.get("host") or "").strip()
    if host and _is_private_or_local(host.split(":")[0]):
        proto = (request.headers.get("x-forwarded-proto") or "http").split(",")[0].strip()
        host_only = host.split(":")[0]
        if _is_tunnel_host(host_only) or ("." in host_only and not _is_local_host(host_only)):
            proto = "https"
        return _normalize(f"{proto}://{host}")

    return cfg.app_origin.rstrip("/")


def google_redirect_uri(origin: str) -> str:
    cfg = get_config()
    if cfg.google_redirect_uri:
        return cfg.google_redirect_uri.rstrip("/")
    return f"{origin.rstrip('/')}/api/auth/google/callback"


def provider_redirect_uri(origin: str, provider_id: str) -> str:
    cfg = get_config()
    if provider_id == "strava" and cfg.strava_redirect_uri:
        return cfg.strava_redirect_uri.rstrip("/")
    return f"{origin.rstrip('/')}/api/providers/{provider_id}/callback"
