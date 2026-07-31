#!/usr/bin/env python3
"""Ultra doctor — validate local + tunnel + OAuth setup.

Exit 0 if healthy enough to develop; exit 1 listing every failure.
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, List, Optional
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from urls import load_env, resolve, sync_derived_env_files  # noqa: E402

CF_DIR = Path.home() / ".cloudflared"


@dataclass
class Check:
    id: str
    ok: bool
    label: str
    detail: str = ""
    fix: str = ""


def dns_resolves(host: str) -> tuple[bool, str]:
    try:
        infos = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
        addrs = sorted({i[4][0] for i in infos})
        return True, ", ".join(addrs[:4])
    except socket.gaierror:
        pass
    # Fallback: query Cloudflare DNS (local stub resolvers often lag on new zones)
    try:
        res = subprocess.run(
            ["dig", "+short", host, "A", "@1.1.1.1"],
            text=True,
            capture_output=True,
            timeout=5,
        )
        addrs = [l.strip() for l in (res.stdout or "").splitlines() if l.strip()]
        if addrs:
            return True, f"{', '.join(addrs[:4])} (via 1.1.1.1)"
        return False, "no A record at 1.1.1.1"
    except Exception as e:  # noqa: BLE001
        return False, str(e)


def http_ok(url: str, timeout: float = 5.0, host_hint: str | None = None) -> tuple[bool, str]:
    host_hint = host_hint or (urlparse(url).hostname or None)
    try:
        req = urllib.request.Request(url, method="GET", headers={"User-Agent": "ultra-doctor/1"})
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return True, f"HTTP {res.status}"
    except urllib.error.HTTPError as e:
        if e.code < 500:
            return True, f"HTTP {e.code}"
        return False, f"HTTP {e.code}"
    except Exception as first:  # noqa: BLE001
        # If local DNS fails but public DNS works, curl via --resolve
        if host_hint:
            try:
                dig = subprocess.run(
                    ["dig", "+short", host_hint, "A", "@1.1.1.1"],
                    text=True,
                    capture_output=True,
                    timeout=5,
                )
                ip = next((l.strip() for l in (dig.stdout or "").splitlines() if l.strip()), None)
                if ip:
                    curl = subprocess.run(
                        [
                            "curl",
                            "-sI",
                            "--max-time",
                            str(int(timeout)),
                            "--resolve",
                            f"{host_hint}:443:{ip}",
                            url,
                        ],
                        text=True,
                        capture_output=True,
                    )
                    line = (curl.stdout or "").splitlines()[:1]
                    if curl.returncode == 0 and line:
                        return True, f"{line[0].strip()} (via 1.1.1.1)"
            except Exception:  # noqa: BLE001
                pass
        return False, str(first)


def tcp_ok(host: str, port: int, timeout: float = 1.5) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def which_cloudflared() -> Optional[str]:
    for c in (shutil.which("cloudflared"), "/opt/homebrew/bin/cloudflared"):
        if c and Path(c).exists():
            return c
    return None


def cloudflared_connections(cf: str, name: str) -> tuple[bool, str]:
    res = subprocess.run([cf, "tunnel", "info", name], text=True, capture_output=True)
    out = (res.stdout or "") + (res.stderr or "")
    if res.returncode != 0:
        return False, out.strip()[:200] or "tunnel info failed"
    lowered = out.lower()
    if "no active connection" in lowered or "0 connections" in lowered:
        return False, "tunnel exists but no active connections (is ./dev.sh running?)"
    if "connindex" in lowered or "active connection" in lowered or "registered tunnel connection" in lowered:
        return True, "active connection reported"
    # Newer CLI formats vary — if info succeeds, soft-pass with note
    if name in out or "tunnel" in lowered:
        return True, "tunnel info OK (start ./dev.sh if HTTPS fails)"
    return False, out.strip()[:200]


def main() -> int:
    print("")
    print("Ultra doctor")
    print("────────────")
    try:
        sync_derived_env_files()
    except Exception as e:  # noqa: BLE001
        print(f"✖ Could not sync env: {e}")
        return 1

    u = resolve()
    checks: List[Check] = []

    def add(cid: str, ok: bool, label: str, detail: str = "", fix: str = "") -> None:
        checks.append(Check(cid, ok, label, detail, fix))

    # --- env ---
    add(
        "public_url",
        u.public_url.startswith("https://"),
        "PUBLIC_URL is HTTPS",
        u.public_url,
        "Set PUBLIC_URL=https://rydn.bike in ultra-analytics/.env",
    )
    add(
        "app_url",
        u.app_url.startswith("https://"),
        "APP_URL is HTTPS",
        u.app_url,
        "Set APP_URL or PUBLIC_URL in .env",
    )
    add(
        "google_id",
        bool(u.google_client_id),
        "GOOGLE_CLIENT_ID set",
        "SET" if u.google_client_id else "empty",
        "Paste into ultra-analytics/.env then ./dev.sh",
    )
    add(
        "google_secret",
        bool(u.google_client_secret),
        "GOOGLE_CLIENT_SECRET set",
        "SET" if u.google_client_secret else "empty",
        "Paste into ultra-analytics/.env",
    )
    add(
        "google_format",
        (not u.google_client_id) or u.google_client_id.endswith(".apps.googleusercontent.com"),
        "Google Client ID format",
        "ok" if u.google_client_id.endswith(".apps.googleusercontent.com") else "unexpected",
        "Should end with .apps.googleusercontent.com",
    )
    env_map = load_env()
    maps_key = (env_map.get("GOOGLE_MAPS_API_KEY") or env_map.get("GOOGLE_API_KEY") or "").strip()
    add(
        "google_maps_key",
        bool(maps_key),
        "GOOGLE_MAPS_API_KEY set (server-side)",
        "SET" if maps_key else "empty",
        "Paste into ultra-analytics/.env (never VITE_*)",
    )
    add(
        "strava_id",
        bool(u.strava_client_id),
        "STRAVA_CLIENT_ID set",
        "SET" if u.strava_client_id else "empty",
        "Paste into ultra-analytics/.env",
    )
    add(
        "strava_secret",
        bool(u.strava_client_secret),
        "STRAVA_CLIENT_SECRET set",
        "SET" if u.strava_client_secret else "empty",
        "Paste into ultra-analytics/.env",
    )

    # --- cloudflared ---
    cf = which_cloudflared()
    add("cloudflared", bool(cf), "cloudflared installed", cf or "missing", "brew install cloudflared")
    cert = CF_DIR / "cert.pem"
    add("cf_login", cert.exists(), "Cloudflare login", str(cert) if cert.exists() else "missing", "cloudflared tunnel login")
    cfg = CF_DIR / "config.yml"
    add("cf_config", cfg.exists(), "Tunnel config.yml", str(cfg) if cfg.exists() else "missing", "./scripts/ensure_tunnel.py")

    if cf:
        res = subprocess.run([cf, "tunnel", "list"], text=True, capture_output=True)
        has_tunnel = u.tunnel_name in (res.stdout or "")
        add(
            "tunnel_exists",
            has_tunnel,
            f"Tunnel '{u.tunnel_name}' exists",
            "yes" if has_tunnel else "no",
            f"python3 scripts/ensure_tunnel.py",
        )
        if has_tunnel:
            conn_ok, conn_detail = cloudflared_connections(cf, u.tunnel_name)
            add("tunnel_running", conn_ok, "Tunnel connected", conn_detail, "Run ./dev.sh")
    else:
        add("tunnel_exists", False, f"Tunnel '{u.tunnel_name}' exists", "skipped", "Install cloudflared first")
        add("tunnel_running", False, "Tunnel connected", "skipped", "Install cloudflared first")

    # --- DNS / HTTPS ---
    host = u.tunnel_hostname
    dns_ok, dns_detail = dns_resolves(host)
    add("dns", dns_ok, f"DNS resolves {host}", dns_detail, "Add domain to Cloudflare + route dns (see SETUP.md)")

    https_ok, https_detail = http_ok(u.app_url)
    add(
        "https",
        https_ok,
        f"HTTPS {u.app_url}",
        https_detail,
        "Start ./dev.sh so the tunnel has a local origin; check SSL mode Full in Cloudflare",
    )

    api_public = f"{u.api_url.rstrip('/')}/api/health"
    api_pub_ok, api_pub_detail = http_ok(api_public)
    add("api_public", api_pub_ok, "Public API /api/health", api_pub_detail, "Tunnel + frontend proxy must be up")

    # --- local processes ---
    be_ok = tcp_ok("127.0.0.1", u.port_be)
    add("backend_local", be_ok, f"Backend :{u.port_be}", "listening" if be_ok else "down", "Run ./dev.sh")
    fe_ok = tcp_ok("127.0.0.1", u.port_fe)
    add("frontend_local", fe_ok, f"Frontend :{u.port_fe}", "listening" if fe_ok else "down", "Run ./dev.sh")

    if be_ok:
        local_api_ok, local_api_detail = http_ok(f"{u.local_api_url}/api/health")
        add("api_local", local_api_ok, "Local API health", local_api_detail, "Check backend logs")
    else:
        add("api_local", False, "Local API health", "backend down", "Run ./dev.sh")

    # --- OAuth registration reminders (can't auto-verify Google/Strava consoles) ---
    add(
        "google_oauth_manual",
        True,
        "Google OAuth URIs (manual)",
        f"origin={u.google_js_origin}  redirect={u.google_redirect_uri}",
        "Register these in Google Cloud → Credentials → your Web client",
    )
    add(
        "strava_oauth_manual",
        True,
        "Strava callback domain (manual)",
        u.strava_callback_domain,
        "strava.com/settings/api → Authorization Callback Domain",
    )

    # print
    failed = [c for c in checks if not c.ok]
    for c in checks:
        mark = "✓" if c.ok else "✖"
        line = f"  {mark} {c.label}"
        if c.detail:
            line += f" — {c.detail}"
        print(line)
        if not c.ok and c.fix:
            print(f"      fix: {c.fix}")

    print("")
    print("OAuth values to register (never change again):")
    print(f"  Google JS origin:     {u.google_js_origin}")
    print(f"  Google redirect URI:  {u.google_redirect_uri}")
    print(f"  Strava callback host: {u.strava_callback_domain}")
    print("")
    print(f"  App:  {u.app_url}")
    print(f"  API:  {u.api_url}")
    print("")

    # Soft failures: tunnel_running / https when doctor run without stack — still exit 1
    critical = [
        c
        for c in failed
        if c.id
        not in (
            "google_oauth_manual",
            "strava_oauth_manual",
        )
    ]
    if critical:
        print(f"Result: {len(critical)} issue(s). Fix the ✖ lines above, then re-run ./doctor.sh")
        return 1
    print("Result: healthy")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
