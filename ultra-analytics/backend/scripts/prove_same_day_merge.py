#!/usr/bin/env python3
"""Prove same-calendar-day merge on real Nach Spanien rides (+ a second fixture).

Run from backend/:
  python scripts/prove_same_day_merge.py
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("ULTRA_DATA_DIR", str(ROOT / "data"))

from app import store, ultras  # noqa: E402


def _end_iso(start: str | None, duration_s: float | None) -> str | None:
    if not start:
        return None
    try:
        s = str(start).replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        dur = float(duration_s or 0)
        return (dt + timedelta(seconds=dur)).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        return None


def _print_days(label: str, days: list[dict]) -> None:
    print(f"\n=== {label} ({len(days)} days) ===")
    for d in days:
        print(
            f"  Day {d['dayIndex']:2d}  rec={d.get('recordingCount', 1)}  "
            f"date={str(d.get('date') or '')[:10]}  "
            f"km={d.get('distanceKm')}  elev={d.get('elevationGainM')}  "
            f"dur={d.get('durationS')}  name={d.get('name')!r}  "
            f"ids={d.get('activityIds') or [d.get('id')]}"
        )


def prove_nach_spanien(uid: str) -> None:
    rides = store.list_rides(uid)
    by_id = {r["id"]: r for r in rides}
    ids = [
        a["id"]
        for a in json.loads((ROOT / "data" / "users" / uid / "provider_rides.json").read_text())
        if "Nach Spanien" in str(a.get("name", "")) and str(a.get("name", "")).startswith("Tag")
    ]
    members = [by_id[i] for i in ids if i in by_id]
    members.sort(key=lambda a: a.get("date") or "")

    print("USER", uid)
    print("Nach Spanien recordings", len(members))

    t1 = by_id["strava_14962129097"]
    t2 = by_id["strava_14962129032"]
    print("\n=== Tag 11 ride evidence ===")
    for r in (t1, t2):
        print(
            {
                "id": r["id"],
                "name": r["name"],
                "date_field": r.get("date"),
                "startTime": r.get("startTime"),
                "durationS": r.get("durationS"),
                "end_computed": _end_iso(r.get("date"), r.get("durationS")),
                "distanceKm": r.get("distanceKm"),
                "elevationGainM": r.get("elevationGainM"),
                "grouping_key": ultras._calendar_day_key(r),
            }
        )

    # BEFORE: old 1 ride = 1 day
    before = [{**a, "dayIndex": i + 1, "recordingCount": 1, "activityIds": [a["id"]]} for i, a in enumerate(members)]
    _print_days("BEFORE (1 ride = 1 day)", before[9:13])

    # AFTER: create / detail through real path
    ultra = ultras.ultra_from_activities(uid, "Nach Spanien", members)
    detail = ultras.ultra_detail(uid, ultra["id"], rides)
    assert detail is not None
    days = detail["days"]
    _print_days("AFTER ultra_detail merge", days[9:12])

    day11 = next(d for d in days if d["dayIndex"] == 11)
    assert day11["recordingCount"] == 2, day11
    assert day11["activityIds"] == ["strava_14962129097", "strava_14962129032"]
    assert abs(float(day11["distanceKm"]) - 92.3) < 0.05
    assert int(day11["elevationGainM"]) == 537
    assert int(day11["durationS"]) == 18387 + 2493
    assert "(1/2)" not in (day11.get("name") or "")
    assert "(2/2)" not in (day11.get("name") or "")
    assert ultra["dayCount"] == 19
    print("\nPASS Nach Spanien: single Day 11, combined stats, clean title")
    print("ultra_id", ultra["id"], "dayCount", ultra["dayCount"])


def prove_second_fixture(uid: str) -> None:
    """Synthetic second Ultra with two same-day rides — proves generality."""
    rides = [
        {
            "id": "fix_same_a",
            "name": "Day 3 (1/2) - Capitals",
            "distanceKm": 40.0,
            "elevationGainM": 200,
            "durationS": 5000,
            "movingTimeS": 4500,
            "date": "2025-06-30T07:00:00Z",
            "analyzed": True,
            "status": "reviewed",
        },
        {
            "id": "fix_same_b",
            "name": "Day 3 (2/2) - Capitals",
            "distanceKm": 12.5,
            "elevationGainM": 80,
            "durationS": 1800,
            "movingTimeS": 1600,
            "date": "2025-06-30T16:00:00Z",
            "analyzed": True,
            "status": "reviewed",
        },
        {
            "id": "fix_next",
            "name": "Day 4 - Capitals",
            "distanceKm": 90.0,
            "elevationGainM": 700,
            "durationS": 20000,
            "movingTimeS": 18000,
            "date": "2025-07-01T08:00:00Z",
            "analyzed": True,
            "status": "reviewed",
        },
    ]
    # Persist only as ultra members via ultra_from_activities + detail with in-memory rides list
    ultra = ultras.ultra_from_activities(uid, "Same-day fixture Capitals", rides)
    detail = ultras.ultra_detail(uid, ultra["id"], rides)
    assert detail is not None
    days = detail["days"]
    _print_days("SECOND FIXTURE after merge", days)
    assert len(days) == 2
    assert days[0]["recordingCount"] == 2
    assert days[0]["distanceKm"] == 52.5
    assert days[0]["elevationGainM"] == 280
    assert days[0]["durationS"] == 6800
    assert days[0]["name"] == "Day 3 - Capitals"
    assert ultra["dayCount"] == 2
    print("PASS second fixture: 3 rides → 2 calendar days")
    # Cleanup fixture ultra
    ultras.delete_ultra(uid, ultra["id"])


def main() -> None:
    uid = "g_110961740720638107491"
    prove_nach_spanien(uid)
    prove_second_fixture(uid)
    print("\nALL PROOFS OK")


if __name__ == "__main__":
    main()
