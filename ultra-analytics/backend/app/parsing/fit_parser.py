"""FIT parser (Garmin / Coros / Wahoo head units).

FIT is the richest source: power, HR, cadence, temperature, device distance and
speed. We read only the ``record`` messages and map fields into ``Sample``.
"""

from __future__ import annotations

from typing import Optional

import fitdecode

from ..models import Activity, Sample

# semicircles -> degrees
_SEMI = 180.0 / (2 ** 31)


def _num(value) -> Optional[float]:
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    if f != f:  # NaN
        return None
    return f


def parse_fit(path: str, source_file: str) -> Activity:
    activity = Activity(source_file=source_file)
    with fitdecode.FitReader(path) as reader:
        for frame in reader:
            if frame.frame_type != fitdecode.FIT_FRAME_DATA:
                continue
            if frame.name != "record":
                continue

            def get(name: str):
                try:
                    if frame.has_field(name):
                        return frame.get_value(name, fallback=None)
                except (KeyError, ValueError):
                    return None
                return None

            ts = get("timestamp")
            if ts is None:
                continue
            t = ts.timestamp()

            lat_semi = get("position_lat")
            lon_semi = get("position_long")
            lat = _num(lat_semi) * _SEMI if lat_semi is not None else None
            lon = _num(lon_semi) * _SEMI if lon_semi is not None else None

            ele = _num(get("enhanced_altitude"))
            if ele is None:
                ele = _num(get("altitude"))

            speed = _num(get("enhanced_speed"))
            if speed is None:
                speed = _num(get("speed"))

            hr = _num(get("heart_rate"))
            cadence = _num(get("cadence"))

            activity.samples.append(
                Sample(
                    t=t,
                    lat=lat,
                    lon=lon,
                    ele=ele,
                    dist=_num(get("distance")),
                    speed=speed,
                    power=_num(get("power")),
                    hr=int(hr) if hr is not None else None,
                    cadence=int(cadence) if cadence is not None else None,
                    temp=_num(get("temperature")),
                )
            )
    return activity
