"""Runtime configuration from environment + .env files.

Precedence (highest last written into os.environ):
  1. backend/.env
  2. ultra-analytics/.env   ← central URLs + secrets
  3. process environment (Railway variables win when set before start)

URLs derive from PUBLIC_URL / APP_URL / API_URL — never hardcode domains in
application logic. Railway is auto-detected via RAILWAY_* env vars.
"""

from __future__ import annotations

import os
import secrets
import sys
from dataclasses import dataclass
from typing import List, Optional, Tuple

from .paths import secret_path

_BACKEND_ENV = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".env"))
_CENTRAL_ENV = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))
_env_mtime: Optional[Tuple[Optional[float], Optional[float]]] = None
_config: Optional["Config"] = None

# Always-safe production origins (custom domains). No code change when attaching DNS.
_PRODUCTION_ORIGINS = (
    "https://rydn.bike",
    "https://www.rydn.bike",
    "https://api.rydn.bike",
    "https://app.rydn.bike",
)


def env_path() -> str:
    """Path shown in setup UI — prefer central .env."""
    if os.path.exists(_CENTRAL_ENV):
        return _CENTRAL_ENV
    return _BACKEND_ENV


def _parse_env_file(path: str) -> dict[str, str]:
    out: dict[str, str] = {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, val = line.partition("=")
                key = key.strip()
                val = val.strip().strip('"').strip("'")
                if key:
                    out[key] = val
    except OSError:
        pass
    return out


def _mtime(path: str) -> Optional[float]:
    try:
        return os.path.getmtime(path)
    except OSError:
        return None


def _reload_env_if_needed() -> None:
    """Push .env into os.environ when files appear or change.

    Process env (Railway) is never overwritten — only fill missing keys from files.
    """
    global _env_mtime, _config
    stamp = (_mtime(_BACKEND_ENV), _mtime(_CENTRAL_ENV))
    if stamp == _env_mtime and _config is not None:
        return
    merged: dict[str, str] = {}
    for path in (_BACKEND_ENV, _CENTRAL_ENV):
        merged.update(_parse_env_file(path))
    for key, val in merged.items():
        if key not in os.environ or os.environ.get(key, "") == "":
            os.environ[key] = val
    _env_mtime = stamp
    _config = None


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _strip(url: str) -> str:
    return url.rstrip("/")


def on_railway() -> bool:
    return bool(
        _env("RAILWAY_ENVIRONMENT")
        or _env("RAILWAY_PROJECT_ID")
        or _env("RAILWAY_SERVICE_ID")
    )


def detect_env_name() -> str:
    explicit = (_env("ULTRA_ENV") or _env("ENV") or "").lower()
    if explicit in ("development", "production", "test"):
        return explicit
    if on_railway():
        return "production"
    return "development"


@dataclass
class Config:
    public_url: str
    app_url: str
    api_url: str
    marketing_url: str
    app_origin: str
    google_client_id: str
    google_client_secret: str
    google_redirect_uri: str
    google_maps_api_key: str
    strava_client_id: str
    strava_client_secret: str
    strava_redirect_uri: str
    env: str
    cookie_secure: bool
    cors_origins: Tuple[str, ...]
    oauth_debug: bool
    on_railway: bool

    @property
    def google_enabled(self) -> bool:
        return bool(self.google_client_id and self.google_client_secret)

    @property
    def google_maps_enabled(self) -> bool:
        return bool(self.google_maps_api_key)

    @property
    def strava_enabled(self) -> bool:
        return bool(self.strava_client_id and self.strava_client_secret)

    @property
    def is_production(self) -> bool:
        return self.env == "production" or self.public_url.startswith("https://")


def get_config() -> Config:
    global _config
    _reload_env_if_needed()
    if _config is not None:
        return _config

    railway = on_railway()
    env_name = detect_env_name()

    # URL defaults: local tunnel/dev vs production domains.
    default_public = "https://rydn.bike" if env_name == "production" or railway else "http://localhost:5180"
    railway_domain = _env("RAILWAY_PUBLIC_DOMAIN")
    if railway and railway_domain and not _env("PUBLIC_URL"):
        default_public = f"https://{railway_domain}"

    public = _strip(_env("PUBLIC_URL") or _env("ULTRA_APP_ORIGIN") or default_public)
    app = _strip(_env("APP_URL") or public)
    # Prefer explicit API_URL; production also accepts api.rydn.bike via CORS even if same service.
    api = _strip(_env("API_URL") or public)
    marketing = _strip(_env("MARKETING_URL") or public)

    google_redirect = _env("GOOGLE_REDIRECT_URI") or f"{api}/api/auth/google/callback"
    strava_redirect = _env("STRAVA_REDIRECT_URI") or f"{api}/api/providers/strava/callback"

    secure_flag = _env("ULTRA_COOKIE_SECURE").lower()
    if secure_flag in ("1", "true", "yes"):
        cookie_secure = True
    elif secure_flag in ("0", "false", "no"):
        cookie_secure = False
    else:
        cookie_secure = (
            env_name == "production"
            or app.startswith("https://")
            or public.startswith("https://")
            or railway
        )

    origins: list[str] = []
    for raw in (
        app,
        public,
        api,
        "http://localhost:5180",
        "http://127.0.0.1:5180",
        *(_PRODUCTION_ORIGINS if env_name == "production" or railway else ()),
    ):
        if raw and raw not in origins:
            origins.append(raw)
    if railway_domain:
        rd = f"https://{railway_domain}"
        if rd not in origins:
            origins.append(rd)
    for part in _env("CORS_ORIGINS").split(","):
        o = _strip(part)
        if o and o not in origins:
            origins.append(o)

    oauth_debug = _env("ULTRA_OAUTH_DEBUG").lower() in ("1", "true", "yes")
    if env_name == "development" and not _env("ULTRA_OAUTH_DEBUG"):
        oauth_debug = True
    if env_name == "production":
        oauth_debug = _env("ULTRA_OAUTH_DEBUG").lower() in ("1", "true", "yes")

    _config = Config(
        public_url=public,
        app_url=app,
        api_url=api,
        marketing_url=marketing,
        app_origin=app,
        google_client_id=_env("GOOGLE_CLIENT_ID"),
        google_client_secret=_env("GOOGLE_CLIENT_SECRET"),
        google_redirect_uri=_strip(google_redirect),
        # Maps Platform (Street View Metadata / Places) — never ship to the browser.
        google_maps_api_key=_env("GOOGLE_MAPS_API_KEY") or _env("GOOGLE_API_KEY"),
        strava_client_id=_env("STRAVA_CLIENT_ID"),
        strava_client_secret=_env("STRAVA_CLIENT_SECRET"),
        strava_redirect_uri=_strip(strava_redirect),
        env=env_name,
        cookie_secure=cookie_secure,
        cors_origins=tuple(origins),
        oauth_debug=oauth_debug,
        on_railway=railway,
    )
    return _config


_secret: Optional[str] = None


def get_secret() -> str:
    """Signing key for session cookies. Stable across restarts."""
    global _secret
    if _secret:
        return _secret
    _reload_env_if_needed()
    env = _env("ULTRA_SECRET")
    if env:
        _secret = env
        return _secret
    path = secret_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            _secret = f.read().strip()
            return _secret
    if detect_env_name() == "production" or on_railway():
        raise RuntimeError(
            "FATAL: ULTRA_SECRET is required in production. "
            "Set it in Railway → Variables (long random string). "
            "Generate with: python3 -c \"import secrets; print(secrets.token_urlsafe(48))\""
        )
    generated = secrets.token_urlsafe(48)
    with open(path, "w", encoding="utf-8") as f:
        f.write(generated)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    _secret = generated
    return _secret


def validate_startup() -> List[str]:
    """Return human-readable problems. Raises on hard production failures."""
    from .paths import data_root, frontend_dist
    from .util.logging_util import log_event

    cfg = get_config()
    warnings: List[str] = []
    root = data_root()

    # Data directory
    try:
        os.makedirs(root, exist_ok=True)
        probe = os.path.join(root, ".write_probe")
        with open(probe, "w", encoding="utf-8") as f:
            f.write("ok")
        os.remove(probe)
    except OSError as exc:
        msg = f"Data directory not writable ({root}): {exc}"
        if cfg.is_production:
            raise RuntimeError(f"FATAL: {msg}") from exc
        warnings.append(msg)

    if cfg.on_railway and root.rstrip("/") == "/data" and not os.path.ismount("/data"):
        warnings.append(
            "WARNING: /data is not a mounted volume. Attach a Railway volume at /data "
            "or data will be wiped on every redeploy."
        )

    # Secrets
    try:
        get_secret()
    except RuntimeError:
        raise

    if cfg.is_production and not cfg.google_enabled:
        warnings.append(
            "WARNING: GOOGLE_CLIENT_ID/SECRET missing — Google sign-in disabled until set."
        )
    if cfg.is_production and not cfg.strava_enabled:
        warnings.append(
            "WARNING: STRAVA_CLIENT_ID/SECRET missing — Strava sync disabled until set."
        )

    dist = frontend_dist()
    if cfg.is_production and not (
        os.path.isdir(dist) and os.path.isfile(os.path.join(dist, "index.html"))
    ):
        warnings.append(
            f"WARNING: Frontend dist missing at {dist} — API-only mode (no SPA)."
        )

    for w in warnings:
        log_event("app.startup_warning", message=w)
        print(w, file=sys.stderr)

    return warnings


def ensure_env_file(lan_ip: str = "") -> Tuple[str, bool]:
    """Create central .env from the template if missing. Returns (path, created)."""
    central = _CENTRAL_ENV
    if os.path.exists(central):
        return central, False
    example = os.path.join(os.path.dirname(central), ".env.example")
    if os.path.exists(example):
        text = open(example, "r", encoding="utf-8").read()
    else:
        text = _default_env_template()
    with open(central, "w", encoding="utf-8") as f:
        f.write(text)
    return central, True


def _default_env_template() -> str:
    return """# Ultra — central config. Application code derives all URLs from these.

PUBLIC_URL=https://rydn.bike

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
# Server-side only — Street View Metadata / Places (never expose to Vite/frontend)
GOOGLE_MAPS_API_KEY=
STRAVA_CLIENT_ID=
STRAVA_CLIENT_SECRET=
ULTRA_SECRET=
"""
