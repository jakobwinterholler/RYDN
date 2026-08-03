"""Cycling curves — the exploration core of Review.

Everything here is a *metric* first; the frontend only draws what these compute.
The signature of the module is the **mean-maximal curve** (best sustained effort
over every duration), plus a few ultra-specific twists you won't find elsewhere:

  * moving vs. elapsed speed curves — the gap between them *is* the cost of stops
  * a durability curve — best short effort vs first-hour baseline (% + absolute)
  * time in zones from an FTP/HR estimated *from this ride*, honestly labelled

All curves are computed on a 1 Hz timeline resampled from the (possibly irregular)
samples, so windows are true seconds regardless of the recording device.
"""

from __future__ import annotations

from typing import Dict, List, Optional, Tuple

from .prepare import GAP_S, PreparedRide

# Canonical best-effort durations (seconds): always start at 5s — never 1s.
# Shared timeline across power / speed / HR / cadence / elevation curves.
DURATIONS = [5, 15, 30, 60, 300, 1200, 3600, 7200, 14400, 28800]

# Speed curves start here — sub-5s "best average" is dominated by GPS spikes
# (Strava max speed ~60 km/h vs a noisy 1s peak of 80+). Configurable via env.
def _speed_min_duration_s() -> int:
    import os

    raw = os.environ.get("ULTRA_SPEED_MIN_DURATION_S", "5").strip()
    try:
        return max(1, int(raw))
    except ValueError:
        return 5


# Hard ceiling on a single 1 Hz step used when building the speed distance series.
# ~80 km/h — above this is almost always a GPS jump, not a real bike speed.
_SPEED_MAX_STEP_MS = 80.0 / 3.6


# --------------------------------------------------------------------------- #
# 1 Hz resampling
# --------------------------------------------------------------------------- #
def _timeline_seconds(ride: PreparedRide) -> int:
    if ride.n < 2:
        return 0
    return int(round(ride.t[-1] - ride.t[0]))


def _resample(ride: PreparedRide, values: List[Optional[float]], bridge_gaps: bool) -> List[Optional[float]]:
    """Project a per-sample channel onto a per-second grid.

    ``bridge_gaps=False`` leaves recording gaps (auto-pause / overnight) as None so
    best-effort windows never span dead time. ``bridge_gaps=True`` interpolates
    across gaps too — used for cumulative distance, which is well-defined even while
    stopped.
    """
    total = _timeline_seconds(ride)
    if total <= 0:
        return []
    out: List[Optional[float]] = [None] * (total + 1)
    t0 = ride.t[0]
    for i in range(ride.n - 1):
        va, vb = values[i], values[i + 1]
        dt = ride.t[i + 1] - ride.t[i]
        sa = int(round(ride.t[i] - t0))
        sb = int(round(ride.t[i + 1] - t0))
        is_gap = dt > GAP_S or dt <= 0
        if is_gap and not bridge_gaps:
            if va is not None and 0 <= sa <= total:
                out[sa] = va
            continue
        if va is None or vb is None:
            if va is not None and 0 <= sa <= total:
                out[sa] = va
            continue
        span = sb - sa
        if span <= 0:
            if 0 <= sa <= total:
                out[sa] = va
            continue
        for s in range(sa, sb):
            if 0 <= s <= total:
                out[s] = va + (vb - va) * ((s - sa) / span)
    if values[ride.n - 1] is not None and total <= len(out) - 1:
        out[total] = values[ride.n - 1]
    return out


# --------------------------------------------------------------------------- #
# mean-maximal curve
# --------------------------------------------------------------------------- #
def _best_mean(series: List[Optional[float]], durations: List[int]) -> List[Dict]:
    """Highest average over any contiguous (gap-free) window of each duration."""
    n = len(series)
    if n == 0:
        return []
    # prefix sums with a parallel "valid run length" so windows can't cross a None
    prefix = [0.0] * (n + 1)
    run = [0] * (n + 1)
    for i in range(n):
        v = series[i]
        if v is None:
            prefix[i + 1] = prefix[i]
            run[i + 1] = 0
        else:
            prefix[i + 1] = prefix[i] + v
            run[i + 1] = run[i] + 1
    points: List[Dict] = []
    for d in durations:
        if d > n:
            break
        best: Optional[float] = None
        for end in range(d, n + 1):
            if run[end] >= d:
                avg = (prefix[end] - prefix[end - d]) / d
                if best is None or avg > best:
                    best = avg
        if best is not None:
            points.append({"d": d, "v": round(best, 1)})
    return points


def _best_np(power_1hz: List[Optional[float]], durations: List[int]) -> List[Dict]:
    """Highest Normalized Power over each duration (≥ 5 min to be meaningful)."""
    n = len(power_1hz)
    if n < 30:
        return []
    # 30 s rolling average, then mean-max of the 4th power → NP
    rolled: List[Optional[float]] = [None] * n
    acc = 0.0
    cnt = 0
    q: List[Tuple[int, Optional[float]]] = []
    for i in range(n):
        p = power_1hz[i]
        q.append((i, p))
        if p is not None:
            acc += p
            cnt += 1
        if len(q) > 30:
            _, old = q.pop(0)
            if old is not None:
                acc -= old
                cnt -= 1
        if cnt == 30:
            rolled[i] = acc / 30.0
    r4 = [(r ** 4 if r is not None else None) for r in rolled]
    out: List[Dict] = []
    for pt in _best_mean(r4, [d for d in durations if d >= 300]):
        out.append({"d": pt["d"], "v": round(pt["v"] ** 0.25, 1)})
    return out


def _clean_dist_for_speed(dist_1hz: List[Optional[float]], max_step_ms: float = _SPEED_MAX_STEP_MS) -> List[Optional[float]]:
    """Rebuild cumulative distance clamping per-second jumps.

    GPS spikes create one-second distance leaps that inflate mean-maximal speed
    on short windows. Clamping each step keeps longer windows honest while
    removing physically implausible peaks.
    """
    n = len(dist_1hz)
    if n == 0:
        return []
    out: List[Optional[float]] = [None] * n
    # seed with first valid distance
    base: Optional[float] = None
    for i, d in enumerate(dist_1hz):
        if d is None:
            continue
        if base is None:
            base = float(d)
            out[i] = base
            continue
        prev = out[i - 1] if i > 0 else None
        # find last known cleaned value
        if prev is None:
            for j in range(i - 1, -1, -1):
                if out[j] is not None:
                    prev = out[j]
                    break
        if prev is None:
            out[i] = float(d)
            continue
        # raw step from previous *raw* sample if available, else from cleaned
        raw_prev = dist_1hz[i - 1] if i > 0 else None
        if raw_prev is not None:
            step = float(d) - float(raw_prev)
        else:
            step = float(d) - float(prev)
        if step < 0:
            step = 0.0
        if step > max_step_ms:
            step = max_step_ms
        out[i] = float(prev) + step
    return out


def _speed_durations(all_durations: List[int], ride_seconds: int) -> List[int]:
    min_d = _speed_min_duration_s()
    return [d for d in all_durations if d >= min_d and d <= ride_seconds]


def _elapsed_speed_curve(dist_1hz: List[Optional[float]], durations: List[int]) -> List[Dict]:
    """Best average speed (km/h) over each *elapsed* window — includes stops.

    Durations below ``ULTRA_SPEED_MIN_DURATION_S`` (default 5) are skipped — a
    1-second "best average" is GPS noise, not a trustworthy metric.
    """
    n = len(dist_1hz)
    if n == 0:
        return []
    cleaned = _clean_dist_for_speed(dist_1hz)
    out: List[Dict] = []
    for d in durations:
        if d > n - 1:
            break
        best: Optional[float] = None
        for end in range(d, n):
            a, b = cleaned[end - d], cleaned[end]
            if a is None or b is None or b < a:
                continue
            spd = (b - a) / d
            if best is None or spd > best:
                best = spd
        if best is not None:
            out.append({"d": d, "v": round(best * 3.6, 1)})
    return out


def _moving_speed_curve(
    dist_1hz: List[Optional[float]], moving_1hz: List[bool], durations: List[int]
) -> List[Dict]:
    """Best average speed (km/h) over each window of *moving* seconds only.

    Same minimum-duration and GPS-spike cleaning as the elapsed curve. On a
    fully-moving stretch the two match; longer windows diverge when stops dilute
    elapsed time.
    """
    n = len(dist_1hz)
    if n == 0 or len(moving_1hz) != n:
        return []
    cleaned = _clean_dist_for_speed(dist_1hz)
    mov_cum = [0] * (n + 1)
    for i in range(n):
        mov_cum[i + 1] = mov_cum[i] + (1 if moving_1hz[i] else 0)
    out: List[Dict] = []
    for d in durations:
        if mov_cum[n] < d:
            break
        best: Optional[float] = None
        left = 0
        for right in range(1, n):
            while mov_cum[right] - mov_cum[left] > d:
                left += 1
            start = left
            while start < right and not moving_1hz[start]:
                start += 1
            if mov_cum[right] - mov_cum[start] != d:
                continue
            a, b = cleaned[start], cleaned[right]
            if a is None or b is None or b < a:
                continue
            spd = (b - a) / d
            if best is None or spd > best:
                best = spd
        if best is not None:
            out.append({"d": d, "v": round(best * 3.6, 1)})
    return out


def _elevation_gain_curve(ele_1hz: List[Optional[float]], durations: List[int]) -> List[Dict]:
    """Most metres climbed over each window (a VAM curve in disguise)."""
    n = len(ele_1hz)
    if n == 0:
        return []
    # cumulative positive gain per second
    gain = [0.0] * n
    for i in range(1, n):
        a, b = ele_1hz[i - 1], ele_1hz[i]
        step = (b - a) if (a is not None and b is not None and b > a) else 0.0
        gain[i] = gain[i - 1] + step
    out: List[Dict] = []
    for d in durations:
        if d > n - 1:
            break
        best = 0.0
        for end in range(d, n):
            g = gain[end] - gain[end - d]
            if g > best:
                best = g
        out.append({"d": d, "v": round(best)})
    return out


# --------------------------------------------------------------------------- #
# fatigue, fade, drift, zones
# --------------------------------------------------------------------------- #
def _effort_in_window(
    power_1hz: List[Optional[float]],
    speed_1hz: List[Optional[float]],
    hr_1hz: List[Optional[float]],
    lo: int,
    hi: int,
    has_power: bool,
) -> Optional[float]:
    """Best short effort inside [lo, hi): 5-min power, else mean speed/HR."""
    if hi - lo < 60:
        return None
    if has_power:
        pts = _best_mean(power_1hz[lo:hi], [300])
        return float(pts[0]["v"]) if pts else None
    sp = [speed_1hz[i] for i in range(lo, hi) if speed_1hz[i] is not None]
    hb = [hr_1hz[i] for i in range(lo, hi) if hr_1hz[i] is not None]
    if not sp or not hb:
        return None
    mean_hr = sum(hb) / len(hb)
    if mean_hr <= 0:
        return None
    # km/h per bpm → m per beat (at 1 Hz mean speed)
    return (sum(sp) / len(sp)) / mean_hr


def _fatigue_curve(
    power_1hz: List[Optional[float]],
    speed_1hz: List[Optional[float]],
    hr_1hz: List[Optional[float]],
) -> Dict:
    """Durability vs first-hour baseline — concrete % (and absolute) over time.

    With a power meter: best 5-minute mean power in each trailing hour, expressed
    as % of the first hour's best 5-min. Without power: mean speed÷HR efficiency
    the same way. Dense 15-minute samples so the chart reads as a real curve.
    """
    n = len(power_1hz)
    # Need ≥2 hours so “vs hour 1” is meaningful.
    if n < 7200:
        return {"available": False}

    has_power = any(p is not None for p in power_1hz)
    if not has_power:
        has_eff = any(speed_1hz[i] is not None and hr_1hz[i] is not None for i in range(n))
        if not has_eff:
            return {"available": False}

    metric = "best 5-min power" if has_power else "speed per heart-beat"
    abs_unit = "W" if has_power else "m/beat"
    baseline = _effort_in_window(power_1hz, speed_1hz, hr_1hz, 0, 3600, has_power)
    if baseline is None or baseline <= 0:
        return {"available": False}

    lookback = 3600
    step = 900  # 15 min
    series: List[Dict] = []
    # Anchor at end of hour 1 (= 100%), then every 15 min through ride end.
    for t_end in range(3600, n + 1, step):
        lo = max(0, t_end - lookback)
        effort = _effort_in_window(power_1hz, speed_1hz, hr_1hz, lo, t_end, has_power)
        if effort is None:
            continue
        pct = (effort / baseline) * 100.0
        abs_v = round(effort) if has_power else round(effort, 3)
        series.append(
            {
                "h": round(t_end / 3600.0, 2),
                "v": round(pct, 1),
                "abs": abs_v,
            }
        )

    if len(series) < 2:
        return {"available": False}

    # Trailing partial hour if the last step didn't land on ride end.
    if series[-1]["h"] * 3600 < n - 60:
        effort = _effort_in_window(power_1hz, speed_1hz, hr_1hz, max(0, n - lookback), n, has_power)
        if effort is not None:
            series.append(
                {
                    "h": round(n / 3600.0, 2),
                    "v": round((effort / baseline) * 100.0, 1),
                    "abs": round(effort) if has_power else round(effort, 3),
                }
            )

    late = [s for s in series if s["h"] >= series[-1]["h"] / 2]
    worst = min(series, key=lambda s: s["v"])
    late_min = min(s["v"] for s in late) if late else worst["v"]
    drop = 100.0 - late_min
    insight = None
    if drop >= 12:
        abs_note = (
            f" ({worst['abs']} {abs_unit})"
            if has_power
            else f" ({worst['abs']} {abs_unit})"
        )
        insight = (
            f"Your {metric} fell to {worst['v']:.0f}% of hour 1{abs_note} around "
            f"hour {worst['h']:g} — that's where fatigue bit hardest."
        )
    else:
        end = series[-1]
        insight = (
            f"Your {metric} held at {end['v']:.0f}% of hour 1 by the end "
            f"({end['abs']} {abs_unit}) — strong durability."
        )

    return {
        "available": True,
        "metric": metric,
        "unit": "% of hour 1",
        "absUnit": abs_unit,
        "baselineAbs": round(baseline) if has_power else round(baseline, 3),
        "series": series,
        "insight": insight,
    }


def _half_means(values: List[Optional[float]]) -> Tuple[Optional[float], Optional[float]]:
    nums = [(i, v) for i, v in enumerate(values) if v is not None]
    if len(nums) < 4:
        return None, None
    mid = nums[len(nums) // 2][0]
    first = [v for i, v in nums if i < mid]
    second = [v for i, v in nums if i >= mid]
    fa = sum(first) / len(first) if first else None
    sa = sum(second) / len(second) if second else None
    return fa, sa


def _fade(power_1hz: List[Optional[float]]) -> Dict:
    fa, sa = _half_means(power_1hz)
    if fa is None or sa is None or fa == 0:
        return {"available": False}
    pct = (fa - sa) / fa * 100
    return {"available": True, "firstHalf": round(fa), "secondHalf": round(sa), "pct": round(pct, 1)}


def _hr_drift(speed_1hz: List[Optional[float]], hr_1hz: List[Optional[float]]) -> Dict:
    """Aerobic decoupling: does HR climb (or output drop) for the same effort?"""
    ratio = [
        (speed_1hz[i] / hr_1hz[i]) if (speed_1hz[i] and hr_1hz[i]) else None for i in range(len(hr_1hz))
    ]
    fa, sa = _half_means(ratio)
    if fa is None or sa is None or fa == 0:
        return {"available": False}
    drift = (fa - sa) / fa * 100  # positive = efficiency dropped in second half
    # Also report mean HR each half for a concrete bpm read.
    hr_fa, hr_sa = _half_means(hr_1hz)
    return {
        "available": True,
        "pct": round(drift, 1),
        "firstHalfHr": round(hr_fa) if hr_fa is not None else None,
        "secondHalfHr": round(hr_sa) if hr_sa is not None else None,
    }


_POWER_ZONES = [
    ("Z1 Recovery", 0.00, 0.55),
    ("Z2 Endurance", 0.55, 0.75),
    ("Z3 Tempo", 0.75, 0.90),
    ("Z4 Threshold", 0.90, 1.05),
    ("Z5 VO2max", 1.05, 1.20),
    ("Z6 Anaerobic", 1.20, 1.50),
    ("Z7 Neuromuscular", 1.50, 99.0),
]
_HR_ZONES = [
    ("Z1", 0.00, 0.60),
    ("Z2", 0.60, 0.70),
    ("Z3", 0.70, 0.80),
    ("Z4", 0.80, 0.90),
    ("Z5", 0.90, 99.0),
]


def _zones_power(power_1hz: List[Optional[float]], best20: Optional[float]) -> Dict:
    if not best20:
        return {"available": False}
    ftp = round(best20 * 0.95)
    if ftp <= 0:
        return {"available": False}
    buckets = [0 for _ in _POWER_ZONES]
    for p in power_1hz:
        if p is None:
            continue
        frac = p / ftp
        for zi, (_, lo, hi) in enumerate(_POWER_ZONES):
            if lo <= frac < hi:
                buckets[zi] += 1
                break
    total = sum(buckets)
    if total == 0:
        return {"available": False}
    zones = [
        {
            "name": _POWER_ZONES[zi][0],
            "range": f"{round(_POWER_ZONES[zi][1] * ftp)}–{round(_POWER_ZONES[zi][2] * ftp) if _POWER_ZONES[zi][2] < 90 else ''} W".rstrip("– W")
            if zi < len(_POWER_ZONES) - 1
            else f"{round(_POWER_ZONES[zi][1] * ftp)}+ W",
            "seconds": buckets[zi],
            "pct": round(buckets[zi] / total * 100, 1),
        }
        for zi in range(len(_POWER_ZONES))
    ]
    return {"available": True, "basis": "estimated FTP", "ftpEst": ftp, "zones": zones}


def _zones_hr(hr_1hz: List[Optional[float]]) -> Dict:
    nums = [h for h in hr_1hz if h is not None]
    if len(nums) < 60:
        return {"available": False}
    max_hr = max(nums)
    if max_hr <= 0:
        return {"available": False}
    buckets = [0 for _ in _HR_ZONES]
    for h in nums:
        frac = h / max_hr
        for zi, (_, lo, hi) in enumerate(_HR_ZONES):
            if lo <= frac < hi:
                buckets[zi] += 1
                break
    total = sum(buckets)
    if total == 0:
        return {"available": False}
    zones = [
        {
            "name": _HR_ZONES[zi][0],
            "range": f"{round(_HR_ZONES[zi][1] * max_hr)}–{round(_HR_ZONES[zi][2] * max_hr) if _HR_ZONES[zi][2] < 90 else ''} bpm".rstrip("– bpm")
            if zi < len(_HR_ZONES) - 1
            else f"{round(_HR_ZONES[zi][1] * max_hr)}+ bpm",
            "seconds": buckets[zi],
            "pct": round(buckets[zi] / total * 100, 1),
        }
        for zi in range(len(_HR_ZONES))
    ]
    return {"available": True, "basis": "estimated from max HR", "maxHrEst": round(max_hr), "zones": zones}


def _temperature_series(temp_1hz: List[Optional[float]], dist_1hz: List[Optional[float]]) -> Dict:
    nums = [t for t in temp_1hz if t is not None]
    if len(nums) < 10:
        return {"available": False}
    n = len(temp_1hz)
    target = 300
    step = max(1, n // target)
    series = []
    for i in range(0, n, step):
        t = temp_1hz[i]
        d = dist_1hz[i]
        if t is not None:
            series.append({"km": round((d or 0) / 1000.0, 1), "v": round(t, 1)})
    return {
        "available": True,
        "avg": round(sum(nums) / len(nums), 1),
        "max": round(max(nums), 1),
        "min": round(min(nums), 1),
        "series": series,
    }


# --------------------------------------------------------------------------- #
# entry point
# --------------------------------------------------------------------------- #
def analyze_curves(ride: PreparedRide) -> dict:
    total = _timeline_seconds(ride)
    if total <= 0:
        return {"question": "What were my best efforts?", "available": False}

    durations = [d for d in DURATIONS if d <= total]

    power_1hz = _resample(ride, ride.power, bridge_gaps=False)
    hr_1hz = _resample(ride, ride.hr, bridge_gaps=False)
    cad_1hz = _resample(ride, ride.cadence, bridge_gaps=False)
    temp_1hz = _resample(ride, ride.temp, bridge_gaps=False)
    ele_1hz = _resample(ride, ride.ele, bridge_gaps=False)
    speed_1hz = _resample(ride, [v * 3.6 if v is not None else None for v in ride.speed], bridge_gaps=False)
    dist_1hz = _resample(ride, [float(d) for d in ride.dist], bridge_gaps=True)
    # per-second moving flag from sample state
    state_1hz = _resample_state(ride)
    moving_1hz = [s != "stopped" for s in state_1hz]

    power_curve = _best_mean(power_1hz, durations)
    best20 = next((p["v"] for p in power_curve if p["d"] == 1200), None)
    speed_durs = _speed_durations(durations, total)
    speed_min = _speed_min_duration_s()

    def wrap(points: List[Dict]) -> Dict:
        return {"available": bool(points), "points": points}

    return {
        "question": "What were my best efforts, and how did they hold up?",
        "available": True,
        "durations": durations,
        "speedMinDurationS": speed_min,
        "power": wrap(power_curve),
        "np": wrap(_best_np(power_1hz, durations)),
        "speedMoving": wrap(_moving_speed_curve(dist_1hz, moving_1hz, speed_durs)),
        "speedElapsed": wrap(_elapsed_speed_curve(dist_1hz, speed_durs)),
        "hr": wrap(_best_mean(hr_1hz, durations)),
        "cadence": wrap(_best_mean(cad_1hz, durations)),
        "elevationGain": wrap(_elevation_gain_curve(ele_1hz, durations)),
        "temperature": _temperature_series(temp_1hz, dist_1hz),
        "fatigue": _fatigue_curve(power_1hz, speed_1hz, hr_1hz),
        "fade": _fade(power_1hz),
        "hrDrift": _hr_drift(speed_1hz, hr_1hz),
        "zones": {"power": _zones_power(power_1hz, best20), "hr": _zones_hr(hr_1hz)},
    }


def _resample_state(ride: PreparedRide) -> List[str]:
    """Nearest-sample movement state on the 1 Hz grid."""
    total = _timeline_seconds(ride)
    if total <= 0:
        return []
    states = ["stopped"] * (total + 1)
    t0 = ride.t[0]
    for i in range(ride.n - 1):
        sa = int(round(ride.t[i] - t0))
        sb = int(round(ride.t[i + 1] - t0))
        st = ride.sample_state[i] if i < len(ride.sample_state) else "riding"
        for s in range(max(0, sa), min(total + 1, sb)):
            states[s] = st
    return states
