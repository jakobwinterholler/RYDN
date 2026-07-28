"""AI Summary — a specific, data-grounded debrief.

Phase 1 uses no external LLM (no cloud / no API keys). Instead this is a
deterministic narrative engine: every sentence is derived from *this* ride's
numbers, so it reads like a coach who actually looked at your file — not a
generic template. When the cloud Coach (Layer 3) arrives it will consume these
same structured facts.
"""

from __future__ import annotations

from typing import List

from .helpers import fmt_duration


def build_summary(
    race_meta: dict,
    overview: dict,
    performance: dict,
    climbs: dict,
    stops: dict,
    ledger: dict,
    pacing: dict,
) -> dict:
    strengths: List[str] = []
    weaknesses: List[str] = []
    recommendations: List[str] = []

    # --- pacing ---
    for f in pacing.get("findings", []):
        if f["severity"] in ("high", "medium"):
            weaknesses.append(f["title"] + " — " + f["detail"])
            recommendations.append(f["recommendation"])
        else:
            strengths.append(f["title"] + " — " + f["detail"])

    # --- moving efficiency ---
    moving_pct = overview.get("movingPct", 0)
    if moving_pct >= 80:
        strengths.append(
            f"You kept moving {moving_pct:.0f}% of the time — very little dead time for an event "
            f"this long."
        )
    elif moving_pct <= 65:
        weaknesses.append(
            f"You were only moving {moving_pct:.0f}% of the time; "
            f"{overview.get('stoppedTimeS') and fmt_duration(overview['stoppedTimeS'])} was spent "
            f"stopped."
        )
        recommendations.append(
            "Attack your off-bike time before your fitness: a fitter engine can't outrun long stops."
        )

    # --- stops ---
    long_resupply = [s for s in stops.get("stops", []) if s.get("efficiency") == "long"]
    if long_resupply:
        recommendations.append(
            f"Tighten your {len(long_resupply)} longest resupply stop(s); they ran well over your "
            f"typical stop length."
        )

    # --- climbs ---
    if climbs.get("insight") and "fade" in climbs["insight"].lower():
        weaknesses.append("Your climbing rate faded in the second half of the ride.")
    elif climbs.get("climbs"):
        strengths.append("Your climbing held up across the ride.")

    # --- hike-a-bike ---
    if overview.get("hasHike"):
        strengths.append(
            f"You handled {fmt_duration(overview['hikeTimeS'])} of hike-a-bike "
            f"({overview['hikeDistanceKm']} km, {overview['hikeGainM']} m) — "
            f"{overview['pctClimbOnFoot']:.0f}% of your ascent was on foot. This is measured "
            f"separately, so it never counts against your pacing or fitness."
        )

    # --- power smoothness ---
    power = performance.get("power")
    if power and power.get("variabilityIndex"):
        vi = power["variabilityIndex"]
        if vi <= 1.06:
            strengths.append(f"Exceptionally smooth power delivery (VI {vi}).")
        elif vi >= 1.15:
            weaknesses.append(f"Surgy power delivery (VI {vi}) wastes energy over ultra distance.")

    headline = _headline(race_meta, overview, pacing)
    narrative = _narrative(overview, ledger, pacing, stops, climbs, performance)

    if not strengths:
        strengths.append("You finished a demanding effort — completion itself is the foundation.")
    if not recommendations:
        recommendations.append(
            "Keep logging rides here; the more you upload, the sharper these recommendations get."
        )

    return {
        "question": "What should I take away, and what should I do next?",
        "headline": headline,
        "strengths": strengths,
        "weaknesses": weaknesses,
        "recommendations": recommendations,
        "narrative": narrative,
    }


def _headline(race_meta: dict, overview: dict, pacing: dict) -> str:
    dist = overview.get("distanceKm", 0)
    gain = overview.get("elevationGainM", 0)
    elapsed = fmt_duration(overview.get("elapsedTimeS"))
    verdict = pacing.get("verdict", "")
    return f"{dist:.0f} km · {gain:,} m climbing · {elapsed}. {verdict}".replace(",", " ")


def _narrative(overview, ledger, pacing, stops, climbs, performance=None) -> List[str]:
    paras: List[str] = []

    first = (
        f"You covered {overview['distanceKm']:.0f} km with {overview['elevationGainM']:,} m of "
        f"climbing in an elapsed {fmt_duration(overview['elapsedTimeS'])}, of which "
        f"{fmt_duration(overview['movingTimeS'])} was spent riding "
        f"({overview['movingPct']:.0f}%). Your riding speed was "
        f"{overview['avgSpeedMovingKmh']:.1f} km/h; your true race speed, including everything "
        f"off the bike, was {overview['avgSpeedElapsedKmh']:.1f} km/h.".replace(",", " ")
    )
    power = (performance or {}).get("power") if performance else None
    if power and power.get("np"):
        first += (
            f" Your Normalized Power (riding only) was {power['np']} W"
            + (f" versus a {power['avgRiding']} W riding average" if power.get("avgRiding") else "")
            + (f", a variability index of {power['variabilityIndex']}" if power.get("variabilityIndex") else "")
            + "."
        )
    paras.append(first)

    if ledger.get("insight"):
        paras.append(ledger["insight"])

    pacing_bits = []
    if pacing.get("verdict"):
        pacing_bits.append(pacing["verdict"])
    for f in pacing.get("findings", [])[:2]:
        pacing_bits.append(f["detail"])
    if pacing_bits:
        paras.append(" ".join(pacing_bits))

    if overview.get("hasHike"):
        paras.append(
            f"Not all of this ride was ridden: {fmt_duration(overview['hikeTimeS'])} was "
            f"hike-a-bike over {overview['hikeDistanceKm']} km, earning {overview['hikeGainM']} m "
            f"of ascent on foot ({overview['pctClimbOnFoot']:.0f}% of total climbing). Those "
            f"sections are excluded from the pacing and fatigue read below, since walking a "
            f"bike up an unrideable pitch says nothing about how you paced the ride."
        )

    tail = []
    if climbs.get("insight"):
        tail.append(climbs["insight"])
    if stops.get("insight"):
        tail.append(stops["insight"])
    if tail:
        paras.append(" ".join(tail))

    return paras
