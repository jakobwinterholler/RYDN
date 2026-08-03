"""Assemble the full race report from a ``Race``.

Order matters: stops feed the time ledger and the summary, so we compute them
once and thread the results through.
"""

from __future__ import annotations

from datetime import datetime, timezone

from ..models import Race
from .climbs import analyze_climbs
from .curves import analyze_curves
from .overview import analyze_overview
from .pacing import analyze_pacing
from .performance import analyze_performance
from .prepare import prepare_ride
from .stops import analyze_stops
from .summary import build_summary
from .time_ledger import analyze_time_ledger
from ..util.geo import decimate_points

# Bump when cached reports must be recomputed (e.g. speed-curve semantics).
ANALYSIS_SCHEMA = 3


def _iso(epoch) -> str | None:
    if epoch is None:
        return None
    return datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat()


def _route_preview(ride) -> dict:
    """Editorial polyline for Ultra overview — sparse, never a full GPS dump."""
    pts = []
    for lat, lon in zip(ride.lat, ride.lon):
        if lat is None or lon is None:
            continue
        pts.append([float(lat), float(lon)])
    return {"points": decimate_points(pts, 360)}


def build_report(race: Race) -> dict:
    ride = prepare_ride(race)

    race_meta = {
        "name": race.name,
        "kind": race.kind,
        "fileCount": race.file_count,
        "sources": [a.source_file for a in race.activities],
        "startTime": _iso(race.start_time),
        "endTime": _iso(race.end_time),
        "sampleCount": ride.n,
    }

    overview = analyze_overview(ride)
    performance = analyze_performance(ride)
    curves = analyze_curves(ride)
    climbs = analyze_climbs(ride)
    stops = analyze_stops(ride)
    ledger = analyze_time_ledger(ride, stops)
    pacing = analyze_pacing(ride)
    summary = build_summary(race_meta, overview, performance, climbs, stops, ledger, pacing)

    return {
        "analysisSchema": ANALYSIS_SCHEMA,
        "race": race_meta,
        "overview": overview,
        "performance": performance,
        "curves": curves,
        "climbs": climbs,
        "stops": stops,
        "timeLedger": ledger,
        "pacing": pacing,
        "summary": summary,
        "route": _route_preview(ride),
    }
