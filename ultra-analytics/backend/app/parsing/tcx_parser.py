"""TCX parser (Garmin Training Center XML).

Handles the common Trackpoint fields plus the Garmin TPX activity extension
that carries Watts and Speed.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional
from xml.etree import ElementTree as ET

from ..models import Activity, Sample

_TCX_NS = "{http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2}"
_EXT_NS = "{http://www.garmin.com/xmlschemas/ActivityExtension/v2}"


def _parse_time(text: Optional[str]) -> Optional[float]:
    if not text:
        return None
    text = text.strip().replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(text).timestamp()
    except ValueError:
        return None


def _float(el) -> Optional[float]:
    if el is None or el.text is None:
        return None
    try:
        return float(el.text)
    except ValueError:
        return None


def parse_tcx(path: str, source_file: str) -> Activity:
    activity = Activity(source_file=source_file)
    tree = ET.parse(path)
    root = tree.getroot()

    for tp in root.iter(f"{_TCX_NS}Trackpoint"):
        t = _parse_time(tp.findtext(f"{_TCX_NS}Time"))
        if t is None:
            continue

        pos = tp.find(f"{_TCX_NS}Position")
        lat = _float(pos.find(f"{_TCX_NS}LatitudeDegrees")) if pos is not None else None
        lon = _float(pos.find(f"{_TCX_NS}LongitudeDegrees")) if pos is not None else None

        hr_el = tp.find(f"{_TCX_NS}HeartRateBpm")
        hr = _float(hr_el.find(f"{_TCX_NS}Value")) if hr_el is not None else None

        cadence = _float(tp.find(f"{_TCX_NS}Cadence"))

        speed = None
        power = None
        ext = tp.find(f"{_TCX_NS}Extensions")
        if ext is not None:
            tpx = ext.find(f"{_EXT_NS}TPX")
            if tpx is not None:
                speed = _float(tpx.find(f"{_EXT_NS}Speed"))
                power = _float(tpx.find(f"{_EXT_NS}Watts"))
                if cadence is None:
                    cadence = _float(tpx.find(f"{_EXT_NS}RunCadence"))

        activity.samples.append(
            Sample(
                t=t,
                lat=lat,
                lon=lon,
                ele=_float(tp.find(f"{_TCX_NS}AltitudeMeters")),
                dist=_float(tp.find(f"{_TCX_NS}DistanceMeters")),
                speed=speed,
                power=power,
                hr=int(hr) if hr is not None else None,
                cadence=int(cadence) if cadence is not None else None,
            )
        )
    return activity
