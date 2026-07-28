#!/usr/bin/env python3
"""Central URL resolution for Ultra.

Reads ``ultra-analytics/.env`` (and falls back to ``backend/.env``).

Canonical vars:
  PUBLIC_URL     marketing / default public site
  APP_URL        SPA origin (OAuth browser origin) — defaults to PUBLIC_URL
  API_URL        API origin — defaults to PUBLIC_URL (same-origin /api)
  MARKETING_URL  marketing site — defaults to PUBLIC_URL

Derived (never hardcode these in app code):
  google_redirect_uri, strava_redirect_uri, strava_callback_domain, …
"""

from __future__ import annotations

import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Optional
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
CENTRAL_ENV = ROOT / ".env"
BACKEND_ENV = ROOT / "backend" / ".env"
FRONTEND_ENV_LOCAL = ROOT / "frontend" / ".env.local"


def _parse(path: Path) -> Dict[str, str]:
    out: Dict[str, str] = {}
    if not path.exists():
        return out
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key:
            out[key] = val
    return out


def load_env() -> Dict[str, str]:
    """Merge central .env over backend/.env over process env (central wins)."""
    merged: Dict[str, str] = {}
    merged.update(_parse(BACKEND_ENV))
    merged.update(_parse(CENTRAL_ENV))
    # process env overrides for CI / one-off
    for key, val in os.environ.items():
        if key in (
            "PUBLIC_URL",
            "APP_URL",
            "API_URL",
            "MARKETING_URL",
            "ULTRA_APP_ORIGIN",
            "PORT_FE",
            "PORT_BE",
            "TUNNEL_NAME",
            "TUNNEL_HOSTNAME",
            "GOOGLE_CLIENT_ID",
            "GOOGLE_CLIENT_SECRET",
            "STRAVA_CLIENT_ID",
            "STRAVA_CLIENT_SECRET",
        ):
            if val.strip():
                merged[key] = val.strip()
    return merged


def _strip(url: str) -> str:
    return (url or "").rstrip("/")


@dataclass(frozen=True)
class Urls:
    public_url: str
    app_url: str
    api_url: str
    marketing_url: str
    port_fe: int
    port_be: int
    tunnel_name: str
    tunnel_hostname: str
    google_client_id: str
    google_client_secret: str
    strava_client_id: str
    strava_client_secret: str

    @property
    def google_redirect_uri(self) -> str:
        return f"{self.app_url}/api/auth/google/callback"

    @property
    def strava_redirect_uri(self) -> str:
        return f"{self.app_url}/api/providers/strava/callback"

    @property
    def strava_callback_domain(self) -> str:
        host = urlparse(self.app_url).hostname or ""
        return host

    @property
    def google_js_origin(self) -> str:
        return self.app_url

    @property
    def local_app_url(self) -> str:
        return f"http://localhost:{self.port_fe}"

    @property
    def local_api_url(self) -> str:
        return f"http://127.0.0.1:{self.port_be}"

    @property
    def api_base_for_frontend(self) -> str:
        """Empty string = same-origin /api (tunnel & simple deploys)."""
        if self.api_url == self.app_url:
            return ""
        return self.api_url

    def as_dict(self) -> Dict[str, str]:
        return {
            "PUBLIC_URL": self.public_url,
            "APP_URL": self.app_url,
            "API_URL": self.api_url,
            "MARKETING_URL": self.marketing_url,
            "ULTRA_APP_ORIGIN": self.app_url,  # back-compat
            "GOOGLE_REDIRECT_URI": self.google_redirect_uri,
            "STRAVA_REDIRECT_URI": self.strava_redirect_uri,
            "STRAVA_CALLBACK_DOMAIN": self.strava_callback_domain,
            "PORT_FE": str(self.port_fe),
            "PORT_BE": str(self.port_be),
            "TUNNEL_NAME": self.tunnel_name,
            "TUNNEL_HOSTNAME": self.tunnel_hostname,
            "VITE_PUBLIC_URL": self.app_url,
            "VITE_API_BASE": self.api_base_for_frontend,
            "VITE_MARKETING_URL": self.marketing_url,
        }


def resolve(env: Optional[Dict[str, str]] = None) -> Urls:
    e = env if env is not None else load_env()
    public = _strip(e.get("PUBLIC_URL") or e.get("ULTRA_APP_ORIGIN") or "https://rydn.bike")
    app = _strip(e.get("APP_URL") or public)
    api = _strip(e.get("API_URL") or public)
    marketing = _strip(e.get("MARKETING_URL") or public)
    host = e.get("TUNNEL_HOSTNAME") or (urlparse(app).hostname or "rydn.bike")
    return Urls(
        public_url=public,
        app_url=app,
        api_url=api,
        marketing_url=marketing,
        port_fe=int(e.get("PORT_FE") or "5180"),
        port_be=int(e.get("PORT_BE") or "8100"),
        tunnel_name=e.get("TUNNEL_NAME") or "ultra-local",
        tunnel_hostname=host,
        google_client_id=e.get("GOOGLE_CLIENT_ID") or "",
        google_client_secret=e.get("GOOGLE_CLIENT_SECRET") or "",
        strava_client_id=e.get("STRAVA_CLIENT_ID") or "",
        strava_client_secret=e.get("STRAVA_CLIENT_SECRET") or "",
    )


def set_key(text: str, key: str, val: str) -> str:
    pattern = rf"^{re.escape(key)}=.*$"
    line = f"{key}={val}"
    if re.search(pattern, text, re.M):
        return re.sub(pattern, line, text, count=1, flags=re.M)
    if text and not text.endswith("\n"):
        text += "\n"
    return text + line + "\n"


def sync_derived_env_files(urls: Optional[Urls] = None) -> Urls:
    """Write derived keys into backend/.env + frontend/.env.local from central URLs."""
    u = urls or resolve()
    # Ensure central .env exists
    if not CENTRAL_ENV.exists():
        example = ROOT / ".env.example"
        if example.exists():
            CENTRAL_ENV.write_text(example.read_text(encoding="utf-8"), encoding="utf-8")
        else:
            CENTRAL_ENV.write_text(f"PUBLIC_URL={u.public_url}\n", encoding="utf-8")

    # Keep PUBLIC_URL / secrets in central; sync derived into backend for the API process
    be = _parse(BACKEND_ENV)
    # Prefer secrets from whichever file has them
    central = _parse(CENTRAL_ENV)
    for secret in (
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "STRAVA_CLIENT_ID",
        "STRAVA_CLIENT_SECRET",
    ):
        if not central.get(secret) and be.get(secret):
            # migrate secrets up into central once
            ctext = CENTRAL_ENV.read_text(encoding="utf-8") if CENTRAL_ENV.exists() else ""
            CENTRAL_ENV.write_text(set_key(ctext, secret, be[secret]), encoding="utf-8")

    u = resolve()  # reload after possible migration

    be_text = BACKEND_ENV.read_text(encoding="utf-8") if BACKEND_ENV.exists() else "# Ultra backend env (derived)\n"
    for key in (
        "PUBLIC_URL",
        "APP_URL",
        "API_URL",
        "MARKETING_URL",
        "ULTRA_APP_ORIGIN",
        "GOOGLE_REDIRECT_URI",
        "STRAVA_REDIRECT_URI",
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "STRAVA_CLIENT_ID",
        "STRAVA_CLIENT_SECRET",
    ):
        val = u.as_dict().get(key) or getattr(u, key.lower(), None)
        if key.startswith("GOOGLE_CLIENT") or key.startswith("STRAVA_CLIENT"):
            val = {
                "GOOGLE_CLIENT_ID": u.google_client_id,
                "GOOGLE_CLIENT_SECRET": u.google_client_secret,
                "STRAVA_CLIENT_ID": u.strava_client_id,
                "STRAVA_CLIENT_SECRET": u.strava_client_secret,
            }[key]
        else:
            val = u.as_dict()[key]
        be_text = set_key(be_text, key, val)
    BACKEND_ENV.write_text(be_text, encoding="utf-8")

    FRONTEND_ENV_LOCAL.write_text(
        "# Auto-generated from ultra-analytics/.env — do not edit by hand\n"
        f"VITE_PUBLIC_URL={u.app_url}\n"
        f"VITE_API_BASE={u.api_base_for_frontend}\n"
        f"VITE_MARKETING_URL={u.marketing_url}\n",
        encoding="utf-8",
    )
    return u


def main(argv: list[str]) -> int:
    cmd = argv[1] if len(argv) > 1 else "print"
    if cmd == "sync":
        u = sync_derived_env_files()
        print(u.app_url)
        return 0
    if cmd == "json":
        import json

        print(json.dumps(resolve().as_dict(), indent=2))
        return 0
    u = resolve()
    for k, v in u.as_dict().items():
        print(f"{k}={v}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
