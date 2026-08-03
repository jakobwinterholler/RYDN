"""Session / OAuth cookie options — HTTPS-aware, Railway proxy-safe."""

from __future__ import annotations

import os
from typing import Any, Dict, Optional
from urllib.parse import urlparse

from fastapi.responses import Response

from .config import get_config


def _host(url: str) -> str:
    try:
        return (urlparse(url).hostname or "").lower()
    except Exception:  # noqa: BLE001
        return ""


def _parent_cookie_domain(a: str, b: str) -> Optional[str]:
    """If app and API are sibling subdomains (e.g. rydn.bike / api.rydn.bike), share cookies."""
    if not a or not b or a == b:
        return None
    # Prefer shared suffix of form .example.tld
    parts_a = a.split(".")
    parts_b = b.split(".")
    if len(parts_a) < 2 or len(parts_b) < 2:
        return None
    # Take last two labels as registrable-ish domain (rydn.bike)
    base_a = ".".join(parts_a[-2:])
    base_b = ".".join(parts_b[-2:])
    if base_a != base_b:
        return None
    return f".{base_a}"


def cookie_kwargs(max_age: int) -> Dict[str, Any]:
    """HttpOnly cookie flags for session + short-lived OAuth state cookies."""
    cfg = get_config()
    samesite = (os.environ.get("ULTRA_COOKIE_SAMESITE") or "").strip().lower()
    domain = (os.environ.get("ULTRA_COOKIE_DOMAIN") or "").strip()

    if not domain:
        auto = _parent_cookie_domain(_host(cfg.app_url), _host(cfg.api_url))
        if auto:
            domain = auto
            if not samesite:
                samesite = "none"

    if samesite not in ("lax", "strict", "none"):
        samesite = "lax"

    kw: Dict[str, Any] = {
        "max_age": max_age,
        "httponly": True,
        "samesite": samesite,
        "path": "/",
        "secure": cfg.cookie_secure or samesite == "none",
    }
    if domain:
        kw["domain"] = domain
    return kw


def clear_cookie(response: Response, name: str) -> None:
    """Delete a cookie using the same domain/path/samesite used when setting it."""
    kw = cookie_kwargs(0)
    response.delete_cookie(
        name,
        path=kw.get("path", "/"),
        domain=kw.get("domain"),
        secure=bool(kw.get("secure")),
        httponly=bool(kw.get("httponly")),
        samesite=kw.get("samesite"),
    )
