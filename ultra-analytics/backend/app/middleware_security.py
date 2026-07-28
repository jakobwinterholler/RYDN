"""Production security middleware — CSP, HSTS, referrer, permissions."""

from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from .config import get_config


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        cfg = get_config()

        # Baseline for all responses
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault(
            "Permissions-Policy",
            "camera=(), microphone=(), geolocation=(), payment=()",
        )
        response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")

        # CSP — allow self + configured API origin + Google Fonts
        connect = "'self'"
        if cfg.api_url and cfg.api_url.rstrip("/") not in (
            cfg.app_url.rstrip("/"),
            cfg.public_url.rstrip("/"),
        ):
            connect += f" {cfg.api_url}"
        for extra in ("https://api.rydn.bike", "https://rydn.bike"):
            if extra not in connect:
                connect += f" {extra}"
        csp = (
            "default-src 'self'; "
            "base-uri 'self'; "
            "form-action 'self' https://accounts.google.com https://www.strava.com; "
            "frame-ancestors 'none'; "
            "object-src 'none'; "
            "img-src 'self' data: blob: https:; "
            "font-src 'self' https://fonts.gstatic.com data:; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "script-src 'self'; "
            f"connect-src {connect}; "
            "worker-src 'self'; "
            "manifest-src 'self'"
        )
        if cfg.is_production:
            csp += "; upgrade-insecure-requests"
        response.headers.setdefault("Content-Security-Policy", csp)

        if cfg.cookie_secure or cfg.is_production:
            response.headers.setdefault(
                "Strict-Transport-Security",
                "max-age=63072000; includeSubDomains; preload",
            )

        return response
