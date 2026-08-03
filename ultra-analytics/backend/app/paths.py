"""Filesystem roots — local defaults, Railway volume via ULTRA_DATA_DIR.

File JSON storage today; swapping to Postgres later should only touch store
modules that read these paths, not request handlers.
"""

from __future__ import annotations

import os


def data_root() -> str:
    """Writable application data (users, rides, routes, secret, caches)."""
    override = (os.environ.get("ULTRA_DATA_DIR") or "").strip()
    if override:
        return os.path.abspath(override)
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data"))


def users_dir() -> str:
    return os.path.join(data_root(), "users")


def cache_dir(*parts: str) -> str:
    return os.path.join(data_root(), "cache", *parts)


def secret_path() -> str:
    return os.path.join(data_root(), ".secret")


def frontend_dist() -> str:
    """Built SPA directory (production image). Empty / missing = API-only."""
    override = (os.environ.get("FRONTEND_DIST") or "").strip()
    if override:
        return os.path.abspath(override)
    return os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist")
    )
