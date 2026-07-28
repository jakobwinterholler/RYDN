#!/usr/bin/env python3
"""Ensure named Cloudflare Tunnel exists + config.yml + DNS route.

Automates everything cloudflared CLI can do. Prints exact dashboard steps
only when human action is required (account login, domain on Cloudflare).
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from urls import resolve, sync_derived_env_files  # noqa: E402

CF_DIR = Path.home() / ".cloudflared"
CERT = CF_DIR / "cert.pem"


def run(cmd: list[str], *, check: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, text=True, capture_output=True, check=check)


def which_cloudflared() -> str | None:
    for candidate in (
        shutil.which("cloudflared"),
        "/opt/homebrew/bin/cloudflared",
        "/usr/local/bin/cloudflared",
    ):
        if candidate and Path(candidate).exists():
            return candidate
    return None


def die(msg: str, code: int = 1) -> None:
    print(f"✖ {msg}", file=sys.stderr)
    sys.exit(code)


def ok(msg: str) -> None:
    print(f"✓ {msg}")


def info(msg: str) -> None:
    print(f"▸ {msg}")


def need_manual(title: str, steps: list[str]) -> None:
    print("")
    print(f"═══ MANUAL STEP REQUIRED: {title} ═══")
    for i, step in enumerate(steps, 1):
        print(f"  {i}. {step}")
    print("═══ Then re-run: ./dev.sh  ═══")
    print("")


def ensure_cloudflared() -> str:
    bin_ = which_cloudflared()
    if bin_:
        ok(f"cloudflared installed ({bin_})")
        return bin_
    need_manual(
        "Install cloudflared",
        [
            "Open Terminal",
            "Run:  brew install cloudflared",
            "Expected: cloudflared version …",
            "Verify:  cloudflared --version",
        ],
    )
    die("cloudflared not installed")


def ensure_logged_in(cf: str) -> None:
    if CERT.exists():
        ok(f"Cloudflare login found ({CERT})")
        return
    need_manual(
        "Log cloudflared into Cloudflare",
        [
            f"Run:  {cf} tunnel login",
            "Browser opens → pick the Cloudflare account that owns your domain",
            "Select domain → Authorize",
            f"Expected: file created at {CERT}",
            "Verify:  ls ~/.cloudflared/cert.pem",
        ],
    )
    die("Not logged into Cloudflare (missing cert.pem)")


def tunnel_list(cf: str) -> list[dict]:
    # Prefer JSON if available
    res = run([cf, "tunnel", "list", "--output", "json"])
    if res.returncode == 0 and res.stdout.strip().startswith("["):
        try:
            return json.loads(res.stdout)
        except json.JSONDecodeError:
            pass
    res = run([cf, "tunnel", "list"])
    rows = []
    for line in res.stdout.splitlines():
        # ID NAME CREATED CONNECTIONS
        m = re.match(r"^([0-9a-f-]{36})\s+(\S+)", line.strip())
        if m:
            rows.append({"id": m.group(1), "name": m.group(2)})
    return rows


def ensure_tunnel(cf: str, name: str) -> str:
    tunnels = tunnel_list(cf)
    for t in tunnels:
        if t.get("name") == name:
            tid = t.get("id") or t.get("ID") or ""
            ok(f"Tunnel '{name}' exists ({tid})")
            return str(tid)
    info(f"Creating tunnel '{name}'…")
    res = run([cf, "tunnel", "create", name])
    if res.returncode != 0:
        die(f"Could not create tunnel:\n{res.stderr or res.stdout}")
    # Parse UUID from output
    m = re.search(r"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})", res.stdout + res.stderr)
    if not m:
        # re-list
        for t in tunnel_list(cf):
            if t.get("name") == name:
                return str(t.get("id") or t.get("ID"))
        die(f"Tunnel created but UUID not found:\n{res.stdout}\n{res.stderr}")
    tid = m.group(1)
    ok(f"Created tunnel '{name}' ({tid})")
    return tid


def credentials_path(tunnel_id: str) -> Path:
    return CF_DIR / f"{tunnel_id}.json"


def ensure_config(tunnel_name: str, tunnel_id: str, hostname: str, port_fe: int) -> Path:
    CF_DIR.mkdir(parents=True, exist_ok=True)
    cred = credentials_path(tunnel_id)
    if not cred.exists():
        die(
            f"Missing credentials file {cred}. "
            f"Re-run: cloudflared tunnel create {tunnel_name}"
        )
    cfg = CF_DIR / "config.yml"
    desired = (
        f"tunnel: {tunnel_name}\n"
        f"credentials-file: {cred}\n"
        f"\n"
        f"ingress:\n"
        f"  - hostname: {hostname}\n"
        f"    service: http://127.0.0.1:{port_fe}\n"
        f"  - hostname: www.{hostname}\n"
        f"    service: http://127.0.0.1:{port_fe}\n"
        f"  - service: http_status:404\n"
    )
    if cfg.exists():
        existing = cfg.read_text(encoding="utf-8")
        if hostname in existing and tunnel_name in existing and str(port_fe) in existing:
            ok(f"config.yml OK ({cfg})")
            return cfg
        # Backup and rewrite to keep one-command working
        backup = CF_DIR / "config.yml.bak"
        backup.write_text(existing, encoding="utf-8")
        info(f"Updated config.yml (backup → {backup})")
    else:
        info(f"Writing {cfg}")
    cfg.write_text(desired, encoding="utf-8")
    ok(f"Wrote {cfg}")
    return cfg


def ensure_dns(cf: str, tunnel_name: str, hostname: str) -> None:
    # cloudflared tunnel route dns is idempotent when record already correct
    info(f"Ensuring DNS CNAME {hostname} → tunnel…")
    res = run([cf, "tunnel", "route", "dns", "--overwrite-dns", tunnel_name, hostname])
    if res.returncode != 0:
        # Older CLIs may lack --overwrite-dns
        res = run([cf, "tunnel", "route", "dns", tunnel_name, hostname])
    out = (res.stdout + res.stderr).strip()
    if res.returncode == 0 or "already exists" in out.lower() or "cname" in out.lower():
        ok(f"DNS route for {hostname}: {out or 'ok'}")
    else:
        need_manual(
            f"Attach DNS for {hostname}",
            [
                "Open https://dash.cloudflare.com → click your site (domain must be Active)",
                "Confirm left nav shows DNS",
                f"In Terminal re-run:  {cf} tunnel route dns {tunnel_name} {hostname}",
                "Or manually: DNS → Records → Add record → Type CNAME → Name @ → "
                f"Target <tunnel-uuid>.cfargotunnel.com → Proxied (orange) → Save",
                f"CLI said: {out}",
            ],
        )
        die(f"DNS route failed for {hostname}")

    www = f"www.{hostname}"
    res2 = run([cf, "tunnel", "route", "dns", "--overwrite-dns", tunnel_name, www])
    if res2.returncode != 0:
        res2 = run([cf, "tunnel", "route", "dns", tunnel_name, www])
    if res2.returncode == 0 or "already" in ((res2.stdout or "") + (res2.stderr or "")).lower():
        ok(f"DNS route for {www}")
    else:
        info(f"www DNS skipped ({(res2.stderr or res2.stdout).strip()[:120]})")


def validate_ingress(cf: str, cfg: Path) -> None:
    res = run([cf, "tunnel", "--config", str(cfg), "ingress", "validate"])
    if res.returncode != 0:
        die(f"ingress validate failed:\n{res.stderr or res.stdout}")
    ok("Tunnel ingress validates")


def main() -> int:
    sync_derived_env_files()
    u = resolve()
    print("")
    print(f"Tunnel bootstrap → {u.app_url} ({u.tunnel_name})")
    print("")

    cf = ensure_cloudflared()
    ensure_logged_in(cf)
    tid = ensure_tunnel(cf, u.tunnel_name)
    cfg = ensure_config(u.tunnel_name, tid, u.tunnel_hostname, u.port_fe)
    ensure_dns(cf, u.tunnel_name, u.tunnel_hostname)
    validate_ingress(cf, cfg)

    print("")
    ok("Tunnel ready. Next: ./dev.sh starts it with the app.")
    print("")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
