"""Performance — 'How hard did I ride, and how evenly?'

Each channel returns not just numbers but the one thing an ultra rider should
take from it. Absent channels (e.g. no power meter) are reported honestly.
"""

from __future__ import annotations

from typing import List, Optional

from .helpers import safe_max, safe_mean
from .prepare import PreparedRide


def _sample_indices(n: int, target: int) -> List[int]:
    if n <= target or target <= 0:
        return list(range(n))
    step = n / target
    idx = sorted({int(i * step) for i in range(target)})
    if idx and idx[-1] != n - 1:
        idx.append(n - 1)
    return idx


def _pick(values: List[Optional[float]], idx: List[int]) -> List[Optional[float]]:
    return [round(values[i], 1) if values[i] is not None else None for i in idx]


def _normalized_power(power: List[Optional[float]]) -> Optional[float]:
    nums = [p for p in power if p is not None]
    if len(nums) < 30:
        return None
    window = 30  # ~30 s assuming ~1 Hz recording
    rolled: List[float] = []
    acc = 0.0
    q: List[float] = []
    for p in nums:
        q.append(p)
        acc += p
        if len(q) > window:
            acc -= q.pop(0)
        if len(q) == window:
            rolled.append(acc / window)
    if not rolled:
        return None
    fourth = sum(r ** 4 for r in rolled) / len(rolled)
    return fourth ** 0.25


def _riding_power(ride: PreparedRide) -> List[Optional[float]]:
    """Power while actually pedalling. Over an ultra, the 15h+ of stops/sleep and
    any hike-a-bike would drag NP and average power toward zero — meaningless — so
    NP that 'matters' must be measured on riding time only."""
    out: List[Optional[float]] = []
    for i in range(ride.n):
        state = ride.sample_state[i] if i < len(ride.sample_state) else "riding"
        if state == "riding":
            out.append(ride.power[i])
    return out


def power_summary(ride: PreparedRide) -> dict:
    """Riding-only Normalized Power, average and variability index — the single
    source of truth reused across Overview, the debrief and the replay."""
    riding = _riding_power(ride)
    np = _normalized_power(riding)
    avg = safe_mean(riding)
    vi = (np / avg) if (np and avg) else None
    return {
        "np": round(np) if np else None,
        "avgRiding": round(avg) if avg is not None else None,
        "variabilityIndex": round(vi, 2) if vi else None,
        "hasPower": np is not None,
    }


def analyze_performance(ride: PreparedRide) -> dict:
    idx = _sample_indices(ride.n, 1200)
    axis_km = [round(ride.dist[i] / 1000.0, 2) for i in idx]

    def channel(values: List[Optional[float]]) -> Optional[dict]:
        present = any(v is not None for v in values)
        if not present:
            return None
        return {
            "avg": round(safe_mean(values), 1) if safe_mean(values) is not None else None,
            "max": round(safe_max(values), 1) if safe_max(values) is not None else None,
            "series": _pick(values, idx),
        }

    power = channel(ride.power)
    hr = channel(ride.hr)
    cadence = channel(ride.cadence)
    speed_kmh = [v * 3.6 if v is not None else None for v in ride.speed]
    speed = channel(speed_kmh)
    elevation = channel(ride.ele)

    insights: List[str] = []
    if power:
        ps = power_summary(ride)
        power["avgRiding"] = ps["avgRiding"]
        power["np"] = ps["np"]
        power["variabilityIndex"] = ps["variabilityIndex"]
        np = ps["np"]
        riding_avg = ps["avgRiding"]
        vi = ps["variabilityIndex"]
        if np:
            insights.append(
                f"Your Normalized Power (riding only) was {round(np)} W versus a riding average of "
                f"{round(riding_avg)} W — NP weights the surges, so it reflects the true "
                f"physiological cost of how you rode, not just the arithmetic mean."
            )
        if vi and vi >= 1.15:
            insights.append(
                f"Your power was surgy (variability index {vi:.2f}). Over ultra distance, "
                f"repeated spikes above your steady output burn matches you'll want at km 700. "
                f"Recommendation: cap efforts on rollers and climbs, ride the false-flats smoother."
            )
        elif vi:
            insights.append(
                f"Very even power delivery (variability index {vi:.2f}) — exactly what wins ultras. "
                f"Keep pacing this smoothly."
            )
    if hr and hr["avg"] and hr["max"]:
        insights.append(
            f"Average heart rate {hr['avg']:.0f} bpm (peak {hr['max']:.0f}). "
            f"For an event this long, a sustainable aerobic average matters more than the peak."
        )
    if cadence and cadence["avg"] is not None:
        if cadence["avg"] < 75:
            insights.append(
                f"You averaged a low cadence of {cadence['avg']:.0f} rpm — grinding big gears "
                f"loads the legs and accelerates fatigue. Recommendation: spin lighter, especially early."
            )
        else:
            insights.append(f"Cadence held around {cadence['avg']:.0f} rpm, a good sustainable range.")

    return {
        "question": "How hard did I ride, and how evenly?",
        "axisKm": axis_km,
        "power": power,
        "hr": hr,
        "cadence": cadence,
        "speed": speed,
        "elevation": elevation,
        "insights": insights,
        "hasPower": power is not None,
        "hasHr": hr is not None,
    }
