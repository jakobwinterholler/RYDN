"""Lightweight outbound API usage counters (persisted under data/usage/).

Used by the local founder dashboard to watch limited third-party quotas.
Never exposes keys. Failures to write must never break product requests.
"""

from __future__ import annotations

import json
import os
import threading
import time
from datetime import datetime, timezone
from typing import Any, Optional

from ..paths import data_root

_LOCK = threading.Lock()
_KEEP_DAYS = 90

# Soft reference caps (not enforced here) — for founder UI context.
SERVICE_LIMITS: dict[str, dict[str, Any]] = {
    "google_maps.streetview_metadata": {
        "label": "Google Street View Metadata",
        "note": "Billed / quota in Google Cloud (Maps Platform).",
        "softDaily": None,
    },
    "google_maps.js_config": {
        "label": "Google Maps JS (key handoff)",
        "note": "Proxy for Maps JavaScript API loads — billed per map load in GCP.",
        "softDaily": None,
    },
    "google_oauth": {
        "label": "Google OAuth (sign-in)",
        "note": "Usually generous; watch for abuse spikes.",
        "softDaily": None,
    },
    "strava.api": {
        "label": "Strava API",
        "note": "App limits ~200 req / 15 min and ~2,000 / day (check Strava dashboard).",
        "softDaily": 2000,
        "soft15m": 200,
    },
    "strava.oauth": {
        "label": "Strava OAuth",
        "note": "Token exchange / refresh.",
        "softDaily": None,
    },
    "overpass": {
        "label": "Overpass (OSM POIs)",
        "note": "Public mirrors — fair use; 429/504 common under load.",
        "softDaily": None,
    },
    "open_meteo.forecast": {
        "label": "Open-Meteo forecast",
        "note": "Free non-commercial tier; respect rate limits.",
        "softDaily": None,
    },
    "open_meteo.elevation": {
        "label": "Open-Meteo elevation",
        "note": "DEM fill for routes missing elevation.",
        "softDaily": None,
    },
    "opentopodata": {
        "label": "OpenTopoData (SRTM)",
        "note": "Free DEM fallback — keep batches modest.",
        "softDaily": None,
    },
}


def _path() -> str:
    return os.path.join(data_root(), "usage", "meter.json")


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _load_unlocked() -> dict[str, Any]:
    path = _path()
    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
        if isinstance(raw, dict) and isinstance(raw.get("days"), dict):
            return raw
    except (OSError, json.JSONDecodeError):
        pass
    return {"version": 1, "days": {}}


def _prune(days: dict[str, Any]) -> dict[str, Any]:
    if len(days) <= _KEEP_DAYS:
        return days
    keep = sorted(days.keys())[-_KEEP_DAYS:]
    return {k: days[k] for k in keep}


def _save_unlocked(store: dict[str, Any]) -> None:
    path = _path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    store["days"] = _prune(store.get("days") or {})
    store["updatedAt"] = time.time()
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(store, f, indent=2, sort_keys=True)
        f.write("\n")
    os.replace(tmp, path)


def record(service: str, *, ok: bool = True, n: int = 1, op: Optional[str] = None) -> None:
    """Increment a counter. ``service`` is a dotted key (see SERVICE_LIMITS)."""
    if not service or n <= 0:
        return
    key = f"{service}.{op}" if op else service
    field = "ok" if ok else "err"
    try:
        with _LOCK:
            store = _load_unlocked()
            days = store.setdefault("days", {})
            day = days.setdefault(_today(), {})
            bucket = day.setdefault(key, {"ok": 0, "err": 0})
            bucket[field] = int(bucket.get(field) or 0) + int(n)
            _save_unlocked(store)
    except Exception:  # noqa: BLE001
        # Never break the request path for metering.
        return


def read_store(data_dir: Optional[str] = None) -> dict[str, Any]:
    """Read meter JSON (optionally from an explicit data root / snapshot)."""
    if data_dir:
        path = os.path.join(os.path.abspath(data_dir), "usage", "meter.json")
        try:
            with open(path, "r", encoding="utf-8") as f:
                raw = json.load(f)
            return raw if isinstance(raw, dict) else {"version": 1, "days": {}}
        except (OSError, json.JSONDecodeError):
            return {"version": 1, "days": {}}
    with _LOCK:
        return _load_unlocked()
