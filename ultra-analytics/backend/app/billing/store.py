"""Persisted auto-bootstrap results (price id, webhook secret) under data/."""

from __future__ import annotations

import json
import os
import threading
from typing import Any, Optional

from ..paths import data_root

_LOCK = threading.Lock()
_FILE = "stripe_billing.json"


def _path() -> str:
    return os.path.join(data_root(), _FILE)


def load_billing_store() -> dict[str, Any]:
    path = _path()
    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
        return raw if isinstance(raw, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def save_billing_store(data: dict[str, Any]) -> dict[str, Any]:
    path = _path()
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = f"{path}.tmp"
    with _LOCK:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, sort_keys=True)
            f.write("\n")
        os.replace(tmp, path)
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
    return data


def get_stored(key: str) -> Optional[str]:
    val = load_billing_store().get(key)
    return str(val) if val else None
