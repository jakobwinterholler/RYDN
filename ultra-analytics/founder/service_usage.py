"""Summarize outbound API usage + infra limits for the founder dashboard."""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Any, Optional


def _backend_on_path() -> None:
    backend = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend"))
    if backend not in sys.path:
        sys.path.insert(0, backend)


def _day_keys(n: int) -> list[str]:
    today = datetime.now(timezone.utc).date()
    return [(today - timedelta(days=i)).isoformat() for i in range(n)]


def _sum_range(days: dict[str, Any], keys: list[str]) -> dict[str, dict[str, int]]:
    out: dict[str, dict[str, int]] = {}
    for day in keys:
        bucket = days.get(day) or {}
        if not isinstance(bucket, dict):
            continue
        for service, counts in bucket.items():
            if not isinstance(counts, dict):
                continue
            row = out.setdefault(str(service), {"ok": 0, "err": 0, "total": 0})
            ok = int(counts.get("ok") or 0)
            err = int(counts.get("err") or 0)
            row["ok"] += ok
            row["err"] += err
            row["total"] += ok + err
    return out


def _pct(used: int, soft: Optional[int]) -> Optional[float]:
    if soft is None or soft <= 0:
        return None
    return round(100.0 * used / soft, 1)


def load_railway_meta(data_dir: str) -> dict[str, Any]:
    path = os.path.join(data_dir, "usage", "railway_meta.json")
    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
        return raw if isinstance(raw, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def build_service_usage(data_dir: str) -> dict[str, Any]:
    _backend_on_path()
    from app.util.usage_meter import SERVICE_LIMITS, read_store

    store = read_store(data_dir)
    days = store.get("days") if isinstance(store.get("days"), dict) else {}
    today_keys = _day_keys(1)
    week_keys = _day_keys(7)
    month_keys = _day_keys(30)

    today = _sum_range(days, today_keys)
    week = _sum_range(days, week_keys)
    month = _sum_range(days, month_keys)

    services: list[dict[str, Any]] = []
    # Union of known services + anything seen in the meter
    keys = set(SERVICE_LIMITS.keys()) | set(month.keys())
    for key in sorted(keys):
        meta = SERVICE_LIMITS.get(key) or {
            "label": key,
            "note": "",
            "softDaily": None,
        }
        t = today.get(key) or {"ok": 0, "err": 0, "total": 0}
        w = week.get(key) or {"ok": 0, "err": 0, "total": 0}
        m = month.get(key) or {"ok": 0, "err": 0, "total": 0}
        soft = meta.get("softDaily")
        services.append(
            {
                "key": key,
                "label": meta.get("label") or key,
                "note": meta.get("note") or "",
                "softDaily": soft,
                "today": t,
                "last7d": w,
                "last30d": m,
                "todayPctOfSoftDaily": _pct(int(t["total"]), soft if isinstance(soft, int) else None),
                "warn": bool(
                    isinstance(soft, int)
                    and soft > 0
                    and int(t["total"]) >= int(soft * 0.8)
                ),
            }
        )

    # Sort: most used in 30d first, then label
    services.sort(key=lambda s: (-int(s["last30d"]["total"]), str(s["label"])))

    railway = load_railway_meta(data_dir)
    has_meter = bool(days)

    return {
        "hasMeter": has_meter,
        "meterUpdatedAt": store.get("updatedAt"),
        "dayCount": len(days),
        "services": services,
        "railway": railway,
        "hint": (
            None
            if has_meter
            else "No usage/meter.json in this snapshot yet — deploy the metering build, "
            "use the app a bit, then re-sync."
        ),
    }
