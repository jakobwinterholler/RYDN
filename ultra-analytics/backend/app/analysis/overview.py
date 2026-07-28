"""Overview — 'What did this ride actually consist of?'"""

from __future__ import annotations

from .helpers import elevation_gain_loss, fmt_duration
from .performance import power_summary
from .prepare import PreparedRide


def analyze_overview(ride: PreparedRide) -> dict:
    power = power_summary(ride)
    gap_from = {seg.i0 for seg in ride.segments if seg.is_gap}
    gain, loss = elevation_gain_loss(ride.ele, skip_from=gap_from)
    distance_km = ride.total_distance_m / 1000.0
    ride_distance_km = ride.ride_distance_m / 1000.0
    hike_distance_km = ride.hike_distance_m / 1000.0
    riding_s = ride.moving_s
    hike_s = ride.hike_s
    elapsed_s = ride.elapsed_s
    stopped_s = max(0.0, elapsed_s - riding_s - hike_s)

    # Riding speed reflects pedalling only — hike-a-bike is not riding.
    avg_moving = (ride_distance_km / (riding_s / 3600.0)) if riding_s > 0 else 0.0
    avg_elapsed = (distance_km / (elapsed_s / 3600.0)) if elapsed_s > 0 else 0.0
    riding_pct = (riding_s / elapsed_s * 100.0) if elapsed_s > 0 else 0.0

    has_hike = hike_s > 0
    hike_gain = ride.hike_gain_m
    pct_climb_on_foot = (hike_gain / gain * 100.0) if gain > 0 else 0.0

    calories = _riding_calories(ride)
    temp_vals = [t for t in ride.temp if t is not None]
    avg_temp = round(sum(temp_vals) / len(temp_vals), 1) if temp_vals else None
    max_temp = round(max(temp_vals), 1) if temp_vals else None

    insight = (
        f"You were riding {riding_pct:.0f}% of the {fmt_duration(elapsed_s)} you were out. "
        f"Your riding speed was {avg_moving:.1f} km/h, but your true race speed "
        f"(including {fmt_duration(stopped_s)} stopped) was {avg_elapsed:.1f} km/h."
    )
    if power["np"]:
        insight += (
            f" Your Normalized Power (riding only) was {power['np']} W"
            + (f" at a variability index of {power['variabilityIndex']}" if power["variabilityIndex"] else "")
            + " — the number that actually reflects how hard you rode."
        )
    if has_hike:
        insight += (
            f" You also spent {fmt_duration(hike_s)} on foot (hike-a-bike) covering "
            f"{hike_distance_km:.1f} km and {round(hike_gain)} m of climbing — "
            f"{pct_climb_on_foot:.0f}% of all your ascent was earned pushing, not pedalling."
        )

    return {
        "question": "What did this ride actually consist of?",
        "distanceKm": round(distance_km, 1),
        "elevationGainM": round(gain),
        "elevationLossM": round(loss),
        "movingTimeS": round(riding_s),
        "elapsedTimeS": round(elapsed_s),
        "stoppedTimeS": round(stopped_s),
        "movingPct": round(riding_pct, 1),
        "avgSpeedMovingKmh": round(avg_moving, 1),
        "avgSpeedElapsedKmh": round(avg_elapsed, 1),
        "hasHike": has_hike,
        "hikeDistanceKm": round(hike_distance_km, 1),
        "hikeTimeS": round(hike_s),
        "hikeGainM": round(hike_gain),
        "pctClimbOnFoot": round(pct_climb_on_foot, 1),
        "hasPower": power["hasPower"],
        "npW": power["np"],
        "avgPowerW": power["avgRiding"],
        "variabilityIndex": power["variabilityIndex"],
        "caloriesKcal": calories,
        "avgTempC": avg_temp,
        "maxTempC": max_temp,
        "weather": None,  # placeholder: joined from a weather source in a later phase
        "insight": insight,
    }


def _riding_calories(ride: PreparedRide) -> int | None:
    """Work done while pedalling (kJ ≈ kcal for cycling, ~24% efficiency cancels the
    kJ→kcal factor). Only counts riding samples so stops don't inflate it."""
    kj = 0.0
    seen = False
    for i in range(ride.n - 1):
        p = ride.power[i]
        state = ride.sample_state[i] if i < len(ride.sample_state) else "riding"
        if p is None or state != "riding":
            continue
        dt = ride.t[i + 1] - ride.t[i]
        if 0 < dt <= 30:
            kj += p * dt / 1000.0
            seen = True
    return round(kj) if seen else None
