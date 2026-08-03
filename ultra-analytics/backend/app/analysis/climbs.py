"""Climbs — 'Which climbs cost me the most, and did I fade?'

We resample elevation onto an even distance grid (so variable GPS sampling
doesn't distort gradients), detect sustained ascents, then measure each climb
in the terms that matter to an ultra rider: time spent, VAM, and whether your
climbing speed decayed as the race went on.
"""

from __future__ import annotations

import bisect
from typing import List, Optional, Tuple

from .helpers import elevation_gain_loss, fmt_duration, interpolate
from .prepare import PreparedRide

GRID_M = 100.0
MIN_GAIN_M = 35.0
MIN_LEN_M = 500.0
MIN_AVG_GRADE = 2.0
UP_GRADE = 1.0  # a grid cell counts as "up" above this %
BRIDGE_CELLS = 4  # bridge up to 400 m of flat/dip between up-runs


def _clean_profile(ride: PreparedRide) -> Tuple[List[float], List[float]]:
    dist: List[float] = []
    ele: List[float] = []
    for d, e in zip(ride.dist, ride.ele):
        if e is None:
            continue
        if dist and d <= dist[-1]:
            continue
        dist.append(d)
        ele.append(e)
    return dist, ele


def _interp(xs: List[float], ys: List[float], x: float) -> Optional[float]:
    return interpolate(xs, ys, x)


def _range_mean(ride: PreparedRide, values: List[Optional[float]], d0: float, d1: float):
    nums = [v for d, v in zip(ride.dist, values) if v is not None and d0 <= d <= d1]
    return sum(nums) / len(nums) if nums else None


def _walk_in_range(ride: PreparedRide, d0: float, d1: float):
    """Hike-a-bike distance / time / gain within a climb's distance range."""
    dist = 0.0
    dur = 0.0
    gain = 0.0
    for seg in ride.segments:
        if seg.state != "hiking":
            continue
        m = seg.km * 1000.0
        if m < d0 or m > d1:
            continue
        dist += seg.dist
        dur += seg.dur
        a = ride.ele[seg.i0]
        b = ride.ele[seg.i0 + 1] if seg.i0 + 1 < ride.n else None
        if a is not None and b is not None and b > a:
            gain += b - a
    return dist, dur, gain


def _time_at(ride: PreparedRide, target_m: float) -> Optional[float]:
    if not ride.dist:
        return None
    i = bisect.bisect_left(ride.dist, target_m)
    i = min(max(i, 0), ride.n - 1)
    return ride.t[i]


def analyze_climbs(ride: PreparedRide) -> dict:
    dist, ele = _clean_profile(ride)
    if len(dist) < 5:
        return {"question": "Which climbs cost me the most?", "climbs": [], "insight": None}

    total = dist[-1]
    grid = [i * GRID_M for i in range(int(total // GRID_M) + 1)]
    gele = [_interp(dist, ele, g) or 0.0 for g in grid]

    # grade per cell, lightly smoothed
    raw_grade = [0.0]
    for k in range(1, len(gele)):
        raw_grade.append((gele[k] - gele[k - 1]) / GRID_M * 100.0)
    grade = []
    for k in range(len(raw_grade)):
        lo = max(0, k - 2)
        hi = min(len(raw_grade), k + 3)
        grade.append(sum(raw_grade[lo:hi]) / (hi - lo))

    # merge up-runs
    runs: List[Tuple[int, int]] = []
    k = 0
    n = len(grade)
    while k < n:
        if grade[k] >= UP_GRADE:
            start = k
            gap = 0
            end = k
            while k < n:
                if grade[k] >= UP_GRADE:
                    end = k
                    gap = 0
                else:
                    gap += 1
                    if gap > BRIDGE_CELLS:
                        break
                k += 1
            runs.append((start, end))
        else:
            k += 1

    climbs: List[dict] = []
    for start, end in runs:
        d0 = grid[start]
        d1 = grid[min(end, len(grid) - 1)]
        length = d1 - d0
        if length < MIN_LEN_M:
            continue
        gain = 0.0
        for kk in range(start + 1, min(end + 1, len(gele))):
            step = gele[kk] - gele[kk - 1]
            if step > 0:
                gain += step
        if gain < MIN_GAIN_M:
            continue
        avg_grade = gain / length * 100.0
        if avg_grade < MIN_AVG_GRADE:
            continue
        max_grade = max(grade[start : end + 1]) if end >= start else avg_grade

        t0 = _time_at(ride, d0)
        t1 = _time_at(ride, d1)
        dur = (t1 - t0) if (t0 is not None and t1 is not None and t1 > t0) else None
        vam = (gain / (dur / 3600.0)) if dur else None

        walk_dist, walk_time, walk_gain = _walk_in_range(ride, d0, d1)
        walked_pct = (walk_dist / length * 100.0) if length > 0 else 0.0
        rideable_km = max(0.0, (length - walk_dist) / 1000.0)

        climbs.append(
            {
                "startKm": round(d0 / 1000.0, 1),
                "endKm": round(d1 / 1000.0, 1),
                "lengthKm": round(length / 1000.0, 2),
                "gainM": round(gain),
                "avgGradient": round(avg_grade, 1),
                "maxGradient": round(max_grade, 1),
                "timeS": round(dur) if dur else None,
                "tStart": round(t0) if t0 is not None else None,
                "tEnd": round(t1) if t1 is not None else None,
                "vam": round(vam) if vam else None,
                "avgPower": _round(_range_mean(ride, ride.power, d0, d1)),
                "avgHr": _round(_range_mean(ride, ride.hr, d0, d1)),
                "walkedKm": round(walk_dist / 1000.0, 2),
                "rideableKm": round(rideable_km, 2),
                "walkedPct": round(walked_pct),
                "walkedTimeS": round(walk_time),
                "walkedGainM": round(walk_gain),
                "hasHike": walk_dist > 0,
                # difficulty ~ gain weighted by steepness (FIETS-like)
                "score": round(gain * avg_grade / 100.0, 1),
            }
        )

    # rank by time cost
    for c in climbs:
        c["_cost"] = c["timeS"] or 0
    ranked = sorted(range(len(climbs)), key=lambda i: climbs[i]["_cost"], reverse=True)
    for rank, i in enumerate(ranked, start=1):
        climbs[i]["costRank"] = rank
    for i, c in enumerate(climbs, start=1):
        c["index"] = i
        c.pop("_cost", None)

    total_gain = elevation_gain_loss(ride.ele)[0]
    pct_on_foot = (ride.hike_gain_m / total_gain * 100.0) if total_gain > 0 else 0.0

    insight = _fade_insight(climbs)
    return {
        "question": "Which climbs cost me the most, and did I fade?",
        "climbs": climbs,
        "count": len(climbs),
        "pctClimbingOnFoot": round(pct_on_foot, 1),
        "hikeGainM": round(ride.hike_gain_m),
        "insight": insight,
    }


def _round(v: Optional[float]) -> Optional[float]:
    return round(v) if v is not None else None


def _fade_insight(climbs: List[dict]) -> Optional[str]:
    if not climbs:
        return None
    costliest = max(climbs, key=lambda c: c.get("timeS") or 0)
    parts = [
        f"Your costliest climb was #{costliest['index']} at km {costliest['startKm']} "
        f"({costliest['gainM']} m at {costliest['avgGradient']}%), which took "
        f"{fmt_duration(costliest['timeS'])}."
    ]
    walked = [c for c in climbs if c.get("hasHike")]
    if walked:
        parts.append(
            f" {len(walked)} climb(s) included hike-a-bike sections "
            f"(e.g. #{walked[0]['index']}: {walked[0]['walkedPct']}% on foot) — "
            f"that's terrain, not a lack of fitness."
        )

    # Fade is a fitness/pacing signal — exclude climbs largely done on foot,
    # whose VAM reflects walking pace, not the rider fading.
    vam_climbs = [c for c in climbs if c.get("vam") and c.get("walkedPct", 0) < 40]
    if len(vam_climbs) >= 4:
        half = len(vam_climbs) // 2
        early = [c["vam"] for c in vam_climbs[:half]]
        late = [c["vam"] for c in vam_climbs[half:]]
        early_avg = sum(early) / len(early)
        late_avg = sum(late) / len(late)
        if early_avg > 0 and late_avg < early_avg * 0.85:
            drop = (1 - late_avg / early_avg) * 100
            parts.append(
                f" Your climbing rate dropped {drop:.0f}% from the first half of the ride "
                f"({early_avg:.0f} m/h) to the second ({late_avg:.0f} m/h) — a clear fade. "
                f"Recommendation: ride the early climbs easier so the late ones don't collapse."
            )
        else:
            parts.append(
                " Your climbing rate held up well across the ride — good endurance and pacing."
            )
    return "".join(parts)
