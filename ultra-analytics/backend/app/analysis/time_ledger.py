"""Time Ledger — 'Where did every minute go?'

Guarantees that Moving + every stop bucket + brief unaccounted stops == elapsed
time. In an ultra, the ledger is often more decisive than fitness: this makes
the trade-offs impossible to hide from.
"""

from __future__ import annotations

from typing import Dict, List

from .helpers import fmt_duration
from .prepare import PreparedRide

# label -> display colour (frontend uses these directly)
BUCKET_COLORS = {
    "Moving": "#22c55e",
    "Hike-a-bike": "#14b8a6",
    "Sleeping": "#6366f1",
    "Rest / Hotel": "#8b5cf6",
    "Resupply (food & water)": "#f59e0b",
    "Scenic / Photos": "#38bdf8",
    "Brief stops (traffic / nav)": "#94a3b8",
    "Mechanical": "#ef4444",
    "Unknown": "#64748b",
}


def _bucket_for(stop: dict) -> str:
    cat = stop["category"]
    dur_min = stop["durationS"] / 60.0
    if cat == "sleep":
        return "Sleeping"
    if cat == "hotel":
        return "Rest / Hotel"
    if cat == "scenic":
        return "Scenic / Photos"
    if cat == "mechanical":
        return "Mechanical"
    if cat == "traffic":
        return "Brief stops (traffic / nav)"
    if cat in ("resupply", "restaurant", "cafe", "water", "supermarket", "gas station"):
        return "Resupply (food & water)"
    # unknown -> split by how long it was
    if dur_min >= 40:
        return "Rest / Hotel"
    if dur_min >= 3:
        return "Resupply (food & water)"
    return "Brief stops (traffic / nav)"


def analyze_time_ledger(ride: PreparedRide, stops: dict) -> dict:
    elapsed = ride.elapsed_s
    buckets: Dict[str, float] = {"Moving": ride.moving_s}
    if ride.hike_s > 0:
        buckets["Hike-a-bike"] = ride.hike_s

    captured = 0.0
    for stop in stops.get("stops", []):
        label = _bucket_for(stop)
        buckets[label] = buckets.get(label, 0.0) + stop["durationS"]
        captured += stop["durationS"]

    # Any stopped time not big enough to be a "stop" is brief traffic/nav time.
    leftover = elapsed - ride.moving_s - ride.hike_s - captured
    if leftover > 30:
        label = "Brief stops (traffic / nav)"
        buckets[label] = buckets.get(label, 0.0) + leftover

    rows = [
        {
            "label": label,
            "seconds": round(seconds),
            "label_duration": fmt_duration(seconds),
            "pct": round(seconds / elapsed * 100.0, 1) if elapsed > 0 else 0.0,
            "color": BUCKET_COLORS.get(label, "#64748b"),
        }
        for label, seconds in buckets.items()
        if seconds > 0
    ]
    rows.sort(key=lambda r: r["seconds"], reverse=True)

    insight = _ledger_insight(rows, elapsed)
    return {
        "question": "Where did every minute go?",
        "totalS": round(elapsed),
        "movingPct": round(ride.moving_s / elapsed * 100.0, 1) if elapsed > 0 else 0.0,
        "buckets": rows,
        "insight": insight,
    }


def _ledger_insight(rows: List[dict], elapsed: float) -> str:
    moving = next((r for r in rows if r["label"] == "Moving"), None)
    off_bike = [r for r in rows if r["label"] != "Moving"]
    off_total = sum(r["seconds"] for r in off_bike)
    parts = []
    if moving:
        parts.append(
            f"You spent {moving['label_duration']} ({moving['pct']:.0f}%) actually moving. "
        )
    if off_bike:
        biggest = max(off_bike, key=lambda r: r["seconds"])
        parts.append(
            f"Of the {fmt_duration(off_total)} off the bike, the largest slice was "
            f"'{biggest['label']}' ({biggest['label_duration']}). "
        )
        # the two levers in an ultra: sleep and resupply
        levers = [r for r in off_bike if r["label"] in ("Sleeping", "Rest / Hotel", "Resupply (food & water)")]
        if levers:
            lever_total = sum(r["seconds"] for r in levers)
            parts.append(
                f"Sleep/rest and resupply account for {fmt_duration(lever_total)} — these are the "
                f"levers worth optimising; trimming brief stops rarely moves the needle."
            )
    return "".join(parts)
