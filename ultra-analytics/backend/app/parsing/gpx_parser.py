"""GPX parser.

GPX is the leanest source (often just time + position + elevation), but many
head units embed HR/cadence/power/temperature via the Garmin TrackPointExtension.
"""

from __future__ import annotations

from typing import Optional

import gpxpy

from ..models import Activity, Sample


def _ext_value(point, *local_names: str) -> Optional[float]:
    for ext in getattr(point, "extensions", []) or []:
        for child in ext.iter():
            tag = child.tag.split("}")[-1].lower()
            if tag in local_names and child.text:
                try:
                    return float(child.text)
                except ValueError:
                    return None
    return None


def parse_gpx(path: str, source_file: str) -> Activity:
    activity = Activity(source_file=source_file)
    with open(path, "r", encoding="utf-8", errors="ignore") as handle:
        gpx = gpxpy.parse(handle)

    for track in gpx.tracks:
        for segment in track.segments:
            for point in segment.points:
                if point.time is None:
                    continue
                hr = _ext_value(point, "hr", "heartrate")
                cad = _ext_value(point, "cad", "cadence")
                power = _ext_value(point, "power", "watts")
                temp = _ext_value(point, "atemp", "temp", "temperature")
                activity.samples.append(
                    Sample(
                        t=point.time.timestamp(),
                        lat=point.latitude,
                        lon=point.longitude,
                        ele=point.elevation,
                        power=power,
                        hr=int(hr) if hr is not None else None,
                        cadence=int(cad) if cad is not None else None,
                        temp=temp,
                    )
                )
    return activity
