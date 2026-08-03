"""Format dispatch + race assembly.

``parse_upload`` turns a single file into an ``Activity``. ``build_race``
merges any number of activities into one ``Race`` (multi-day ultras just work).
"""

from __future__ import annotations

import os
from typing import List

from ..models import Activity, Race
from .fit_parser import parse_fit
from .gpx_parser import parse_gpx
from .tcx_parser import parse_tcx


class UnsupportedFormat(Exception):
    pass


def parse_upload(path: str, filename: str) -> Activity:
    ext = os.path.splitext(filename)[1].lower()
    if ext == ".fit":
        activity = parse_fit(path, filename)
    elif ext == ".tcx":
        activity = parse_tcx(path, filename)
    elif ext == ".gpx":
        activity = parse_gpx(path, filename)
    else:
        raise UnsupportedFormat(
            f"Unsupported file type '{ext or filename}'. Upload a .fit, .tcx or .gpx file."
        )

    # Guard against clock glitches: keep samples strictly ordered in time.
    activity.samples.sort(key=lambda s: s.t)
    if not activity.samples:
        raise UnsupportedFormat(
            f"No track points found in {filename}. The file may be empty or corrupt."
        )
    return activity


def build_race(activities: List[Activity], kind: str, name: str) -> Race:
    ordered = sorted(
        [a for a in activities if a.samples],
        key=lambda a: a.start_time or 0.0,
    )
    if not ordered:
        raise UnsupportedFormat("None of the uploaded files contained usable ride data.")
    return Race(name=name, kind=kind, activities=ordered)
