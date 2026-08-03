"""Generate a synthetic 2-day ultra (Day1.gpx + Day2.gpx) for smoke-testing.

Not shipped data — just enough realism (climbs, stops, an overnight gap between
files, HR drift and a second-day fade) to exercise every analyzer without
needing a real race file.

Usage:  python -m tests.make_sample [output_dir]
"""

from __future__ import annotations

import math
import os
import sys
from datetime import datetime, timedelta, timezone

DT = 5  # seconds per sample
M_PER_DEG = 111_320.0
BASE_LAT = 47.0
LON = 11.0


def _grade_at(km: float) -> float:
    """A profile with a few real climbs."""
    g = 0.0
    for center, width, height in [(40, 15, 0.06), (110, 20, 0.05), (170, 12, 0.07), (240, 25, 0.045)]:
        g += height * math.exp(-((km - center) ** 2) / (2 * (width / 2) ** 2))
    # rolling terrain
    g += 0.01 * math.sin(km / 3.0)
    return g


def _write_gpx(path: str, points: list[dict]) -> None:
    header = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<gpx version="1.1" creator="UltraAnalyticsSample" '
        'xmlns="http://www.topografix.com/GPX/1/1" '
        'xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">\n'
        "<trk><name>Synthetic Ultra</name><trkseg>\n"
    )
    body = []
    for p in points:
        body.append(
            f'<trkpt lat="{p["lat"]:.6f}" lon="{p["lon"]:.6f}">'
            f'<ele>{p["ele"]:.1f}</ele>'
            f'<time>{p["time"]}</time>'
            f"<extensions><gpxtpx:TrackPointExtension>"
            f'<gpxtpx:hr>{p["hr"]}</gpxtpx:hr>'
            f'<gpxtpx:cad>{p["cad"]}</gpxtpx:cad>'
            f"</gpxtpx:TrackPointExtension>"
            f'<power>{p["power"]}</power>'
            f"</extensions></trkpt>\n"
        )
    footer = "</trkseg></trk></gpx>\n"
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(header)
        fh.writelines(body)
        fh.write(footer)


def _simulate(
    start: datetime,
    hours: float,
    start_km: float,
    ele: float,
    fade: float,
    stops: list,
    habs: list | None = None,
):
    points = []
    t = start
    km = start_km
    end = start + timedelta(hours=hours)
    stop_idx = 0
    hab_idx = 0
    habs = habs or []
    while t < end:
        # Are we inside a scheduled stop?
        if stop_idx < len(stops) and km >= stops[stop_idx][0]:
            stop_km, stop_min = stops[stop_idx]
            stop_end = t + timedelta(minutes=stop_min)
            # emit stationary samples
            while t < stop_end:
                points.append(_point(km, ele, t, moving=False))
                t += timedelta(seconds=DT)
            stop_idx += 1
            continue

        # Are we inside a scheduled hike-a-bike section? (steep, slow, no power)
        if hab_idx < len(habs) and km >= habs[hab_idx][0]:
            _hab_km, hab_min = habs[hab_idx]
            hab_end = t + timedelta(minutes=hab_min)
            while t < hab_end:
                walk_kmh = 3.3
                d_km = walk_kmh / 3600.0 * DT
                km += d_km
                ele += 0.16 * d_km * 1000.0  # ~16% grade, unrideable
                points.append(_point(km, ele, t, moving=True, walking=True))
                t += timedelta(seconds=DT)
            hab_idx += 1
            continue

        grade = _grade_at(km)
        flat_speed = 30.0 * fade  # km/h
        speed = max(6.0, flat_speed - grade * 220.0)  # slower uphill
        speed = min(speed, 65.0 if grade < -0.02 else speed)
        d_km = speed / 3600.0 * DT
        km += d_km
        ele += grade * d_km * 1000.0
        ele = max(80.0, ele)
        points.append(_point(km, ele, t, moving=True, speed=speed, grade=grade, fade=fade))
        t += timedelta(seconds=DT)
    return points, km, ele


def _point(km, ele, t, moving, speed=0.0, grade=0.0, fade=1.0, walking=False):
    lat = BASE_LAT + (km * 1000.0) / M_PER_DEG
    if walking:
        # pushing the bike: near-zero cadence/power, elevated HR
        power, hr, cad = 15, 152, 0
    elif moving:
        power = int(max(90, min(360, (150 + grade * 1400) * fade)))
        # HR drifts up as the day goes on (fatigue) and with power
        drift = (t.hour + t.minute / 60.0)
        hr = int(min(180, 110 + power * 0.12 + drift * 0.6))
        cad = int(max(60, 88 - grade * 120))
    else:
        power, hr, cad = 0, 95, 0
    return {"lat": lat, "lon": LON, "ele": ele, "time": _iso(t), "hr": hr, "cad": cad, "power": power}


def _iso(t: datetime) -> str:
    return t.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def main() -> None:
    out_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "sample_data")
    out_dir = os.path.abspath(out_dir)
    os.makedirs(out_dir, exist_ok=True)

    # Day 1: strong start (fade=1.0), two resupply stops.
    day1_start = datetime(2026, 6, 1, 6, 0, tzinfo=timezone.utc)
    day1, km, ele = _simulate(
        day1_start, hours=9.0, start_km=0.0, ele=520.0, fade=1.0,
        # two real resupplies (12/22 min) plus a couple of brief breaks
        # (smoke/drink, ~3 min) that must NOT count as resupplies.
        stops=[(35.0, 3.0), (70.0, 12.0), (100.0, 3.0), (150.0, 22.0)],
        habs=[(110.0, 9.0)],  # a 9-min hike-a-bike up an unrideable pitch
    )
    # Day 2: after overnight gap, faded legs (fade=0.86), one long stop + a break.
    day2_start = datetime(2026, 6, 2, 5, 30, tzinfo=timezone.utc)
    day2, km, ele = _simulate(
        day2_start, hours=7.5, start_km=km, ele=ele, fade=0.86,
        stops=[(km + 30.0, 3.0), (km + 60.0, 35.0)],
    )

    _write_gpx(os.path.join(out_dir, "Day1.gpx"), day1)
    _write_gpx(os.path.join(out_dir, "Day2.gpx"), day2)
    print(f"Wrote sample race to {out_dir} ({len(day1)} + {len(day2)} points, ~{km:.0f} km).")


if __name__ == "__main__":
    main()
