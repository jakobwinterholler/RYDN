"""Turn a raw ``Race`` into one clean, analysis-ready timeline.

This is the single source of truth for distance, speed, elevation and how every
second is spent. Movement is classified into **three** states — the ultra-cycling
reality that generic tools miss:

    riding   — pedalling along the route
    hiking   — hike-a-bike: pushing/carrying the bike, still progressing on foot
    stopped  — off the bike, not progressing (resupply, sleep, …)

Hike-a-bike is detected from a combination of very low forward speed while still
progressing, a sustained steep uphill gradient, and (when the sensors exist)
near-zero cadence and low/zero power. It is confirmed only when *sustained*, so a
single slow steep sample never counts. Every downstream analyzer reads these
states, so the accounting stays consistent everywhere.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional

from ..models import Race
from ..util.geo import haversine_m, moving_average

# --- movement thresholds --------------------------------------------------
# Below this forward speed (and not advancing) the rider is stopped.
STOP_MS = 0.5  # ~1.8 km/h
# Minimum riding speed used by pacing (see pacing.py).
MOVE_MS = 0.8
# A recording gap longer than this is an auto-pause / off-bike gap.
GAP_S = 30.0
GAP_MOVE_MS = 1.5
MAX_SANE_MS = 30.0  # discard GPS speed spikes

# --- hike-a-bike detection ------------------------------------------------
HAB_MAX_MS = 2.1  # ceiling ~7.5 km/h: you don't push a bike faster than this
HAB_MIN_MS = 0.35  # floor: still clearly progressing, not stopped
HAB_GRADE = 9.0  # % — hike-a-bike happens on steep, often unrideable pitches
HAB_CADENCE = 20  # rpm — near-zero pedalling
HAB_POWER = 60  # W — little to no drivetrain power
MIN_HAB_S = 25.0  # a hike section must last at least this long
MIN_HAB_M = 30.0  # …and cover at least this distance
HAB_BRIDGE_S = 12.0  # bridge brief remounts within a hike section


@dataclass
class Segment:
    """The interval between two consecutive samples (or across a gap)."""

    t0: float
    t1: float
    dur: float
    dist: float  # metres covered (0 when stopped)
    state: str  # "riding" | "hiking" | "stopped"
    lat: Optional[float]
    lon: Optional[float]
    km: float  # cumulative distance at the start of the segment (km)
    i0: int  # global sample index at the start of the segment
    is_gap: bool = False

    @property
    def moving(self) -> bool:
        """Progressing along the route (riding OR hiking) — i.e. not a stop."""
        return self.state != "stopped"


@dataclass
class PreparedRide:
    t: List[float] = field(default_factory=list)
    lat: List[Optional[float]] = field(default_factory=list)
    lon: List[Optional[float]] = field(default_factory=list)
    ele: List[Optional[float]] = field(default_factory=list)  # smoothed
    dist: List[float] = field(default_factory=list)  # cumulative metres
    speed: List[Optional[float]] = field(default_factory=list)  # m/s
    power: List[Optional[float]] = field(default_factory=list)
    hr: List[Optional[float]] = field(default_factory=list)
    cadence: List[Optional[float]] = field(default_factory=list)
    temp: List[Optional[float]] = field(default_factory=list)
    grade: List[Optional[float]] = field(default_factory=list)  # % per sample
    sample_state: List[str] = field(default_factory=list)  # per-sample movement state
    segments: List[Segment] = field(default_factory=list)

    total_distance_m: float = 0.0
    elapsed_s: float = 0.0
    moving_s: float = 0.0  # riding time only
    hike_s: float = 0.0
    hike_distance_m: float = 0.0
    hike_gain_m: float = 0.0

    @property
    def n(self) -> int:
        return len(self.t)

    @property
    def ride_distance_m(self) -> float:
        return max(0.0, self.total_distance_m - self.hike_distance_m)


def _seg_distance(a, b) -> float:
    if a.dist is not None and b.dist is not None and b.dist >= a.dist:
        return b.dist - a.dist
    if None not in (a.lat, a.lon, b.lat, b.lon):
        return haversine_m(a.lat, a.lon, b.lat, b.lon)
    return 0.0


def _compute_grade(dist: List[float], ele: List[Optional[float]]) -> List[Optional[float]]:
    n = len(dist)
    grade: List[Optional[float]] = [None] * n
    for i in range(n):
        a = i
        b = i
        while a > 0 and dist[i] - dist[a] < 60:
            a -= 1
        while b < n - 1 and dist[b] - dist[i] < 60:
            b += 1
        dd = dist[b] - dist[a]
        ea, eb = ele[a], ele[b]
        if dd > 0 and ea is not None and eb is not None:
            grade[i] = (eb - ea) / dd * 100.0
    return grade


def prepare_ride(race: Race) -> PreparedRide:
    ride = PreparedRide()
    cumulative = 0.0
    prev_sample = None
    prev_same_activity = False

    for act in race.activities:
        for s in act.samples:
            if prev_sample is not None:
                dt = s.t - prev_sample.t
                if dt <= 0:
                    continue
                dd = _seg_distance(prev_sample, s)
                if dt > 0 and (dd / dt) > MAX_SANE_MS:
                    dd = 0.0

                inter_activity = not prev_same_activity
                is_gap = inter_activity or dt > GAP_S
                if inter_activity:
                    # Never count the jump between recordings as distance.
                    dd = 0.0
                if is_gap:
                    moving = (dd / dt) >= GAP_MOVE_MS if dt > 0 else False
                else:
                    dev = prev_sample.speed
                    v = dev if (dev is not None and dev <= MAX_SANE_MS) else (dd / dt)
                    moving = v >= STOP_MS

                if moving:
                    cumulative += dd

                ride.segments.append(
                    Segment(
                        t0=prev_sample.t,
                        t1=s.t,
                        dur=dt,
                        dist=dd if moving else 0.0,
                        state="riding" if moving else "stopped",
                        lat=prev_sample.lat,
                        lon=prev_sample.lon,
                        km=cumulative / 1000.0,
                        i0=len(ride.t) - 1,
                        is_gap=is_gap,
                    )
                )

            ride.t.append(s.t)
            ride.lat.append(s.lat)
            ride.lon.append(s.lon)
            ride.ele.append(s.ele)
            ride.dist.append(cumulative)
            if s.speed is not None and s.speed <= MAX_SANE_MS:
                ride.speed.append(s.speed)
            elif prev_sample is not None:
                dt = s.t - prev_sample.t
                dd = _seg_distance(prev_sample, s)
                ride.speed.append(dd / dt if dt > 0 else None)
            else:
                ride.speed.append(None)
            ride.power.append(float(s.power) if s.power is not None else None)
            ride.hr.append(float(s.hr) if s.hr is not None else None)
            ride.cadence.append(float(s.cadence) if s.cadence is not None else None)
            ride.temp.append(float(s.temp) if s.temp is not None else None)

            prev_sample = s
            prev_same_activity = True
        prev_same_activity = False

    ride.ele = moving_average(ride.ele, 7)
    ride.grade = _compute_grade(ride.dist, ride.ele)

    _classify_hike(ride)

    ride.total_distance_m = cumulative
    ride.elapsed_s = sum(seg.dur for seg in ride.segments)
    ride.moving_s = sum(seg.dur for seg in ride.segments if seg.state == "riding")
    ride.hike_s = sum(seg.dur for seg in ride.segments if seg.state == "hiking")
    ride.hike_distance_m = sum(seg.dist for seg in ride.segments if seg.state == "hiking")
    ride.hike_gain_m = _hike_gain(ride)

    ride.sample_state = _build_sample_state(ride)
    return ride


def _classify_hike(ride: PreparedRide) -> None:
    """Reclassify sustained slow/steep riding segments as hike-a-bike."""
    segs = ride.segments

    def candidate(seg: Segment) -> bool:
        if seg.state != "riding" or seg.is_gap or seg.dur <= 0:
            return False
        v = seg.dist / seg.dur if seg.dur > 0 else 0.0
        if not (HAB_MIN_MS <= v <= HAB_MAX_MS):
            return False
        grade = ride.grade[seg.i0]
        if grade is None or grade < HAB_GRADE:
            return False
        cad = ride.cadence[seg.i0]
        if cad is not None and cad > HAB_CADENCE:
            return False
        pw = ride.power[seg.i0]
        if pw is not None and pw > HAB_POWER:
            return False
        return True

    n = len(segs)
    i = 0
    while i < n:
        if not candidate(segs[i]):
            i += 1
            continue
        # extend the run, bridging brief non-candidate remounts
        j = i
        bridge = 0.0
        last_good = i
        while j < n:
            if candidate(segs[j]):
                last_good = j
                bridge = 0.0
            else:
                bridge += segs[j].dur
                if bridge > HAB_BRIDGE_S:
                    break
            j += 1
        run = segs[i : last_good + 1]
        run_dur = sum(s.dur for s in run)
        run_dist = sum(s.dist for s in run)
        if run_dur >= MIN_HAB_S and run_dist >= MIN_HAB_M:
            for s in run:
                s.state = "hiking"
        i = last_good + 1


def _hike_gain(ride: PreparedRide) -> float:
    gain = 0.0
    for seg in ride.segments:
        if seg.state != "hiking":
            continue
        a = ride.ele[seg.i0]
        b = ride.ele[seg.i0 + 1] if seg.i0 + 1 < ride.n else None
        if a is not None and b is not None and b > a:
            gain += b - a
    return gain


def _build_sample_state(ride: PreparedRide) -> List[str]:
    states = ["riding"] * ride.n
    for seg in ride.segments:
        if 0 <= seg.i0 < ride.n:
            states[seg.i0] = seg.state
    if ride.n >= 2:
        states[ride.n - 1] = states[ride.n - 2]
    return states
