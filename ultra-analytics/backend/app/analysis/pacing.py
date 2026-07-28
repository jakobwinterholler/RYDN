"""Pacing — 'Did I overpace, underpace, or lose time — and why?'

Two independent lenses:
  1. Splits: did effort fade from the first third to the last third?
  2. Aerobic decoupling: did heart rate drift up while output held steady?
     (the classic fingerprint of going too hard, heat, or under-fuelling).
We prefer power when available and fall back to grade-adjusted speed.
"""

from __future__ import annotations

from typing import List, Optional

from .prepare import PreparedRide, MOVE_MS


def _grade(ride: PreparedRide, i: int) -> float:
    if i == 0:
        return 0.0
    de = None
    if ride.ele[i] is not None and ride.ele[i - 1] is not None:
        de = ride.ele[i] - ride.ele[i - 1]
    dd = ride.dist[i] - ride.dist[i - 1]
    if de is None or dd <= 0:
        return 0.0
    return max(-0.25, min(0.25, de / dd))


def analyze_pacing(ride: PreparedRide) -> dict:
    has_power = any(p is not None for p in ride.power)

    dist: List[float] = []
    effort: List[float] = []
    hr: List[Optional[float]] = []
    speed_kmh: List[float] = []
    for i in range(ride.n):
        # Only pedalling counts. Hike-a-bike (walking) and stops must be excluded
        # or they masquerade as underpacing / massive aerobic decoupling.
        if i < len(ride.sample_state) and ride.sample_state[i] != "riding":
            continue
        v = ride.speed[i]
        if v is None or v < MOVE_MS:
            continue
        if has_power:
            if ride.power[i] is None:
                continue
            e = ride.power[i]
        else:
            # grade-adjusted, flat-equivalent speed as an effort proxy
            g = _grade(ride, i)
            e = v * (1.0 + 3.2 * max(0.0, g))
        dist.append(ride.dist[i])
        effort.append(e)
        hr.append(ride.hr[i])
        speed_kmh.append(v * 3.6)

    if len(effort) < 30:
        return {
            "question": "Did I overpace, underpace, or lose time?",
            "available": False,
            "findings": [],
            "verdict": "Not enough moving data to assess pacing.",
        }

    total = dist[-1]
    thirds = _thirds(dist, effort, hr, speed_kmh, total, has_power)
    decoupling = _decoupling(effort, hr)

    findings: List[dict] = []
    verdict = "Your effort was well distributed across the ride."

    first = thirds[0]["effort"]
    last = thirds[2]["effort"]
    if first and last:
        change = (last - first) / first * 100.0
        if change <= -8:
            verdict = "You went out too hard and faded."
            findings.append(
                {
                    "type": "overpaced",
                    "severity": "high",
                    "title": "Overpaced early",
                    "detail": (
                        f"Your {'power' if has_power else 'grade-adjusted speed'} dropped "
                        f"{abs(change):.0f}% from the first third to the last "
                        f"({_fmt_effort(first, has_power)} → {_fmt_effort(last, has_power)}). "
                        f"That decline is the signature of starting above a sustainable pace."
                    ),
                    "recommendation": (
                        "Start the next ultra 5–10% easier than feels right for the first hours. "
                        "The time you 'lose' early is repaid several times over at the end."
                    ),
                }
            )
        elif change >= 8:
            verdict = "You finished stronger than you started."
            findings.append(
                {
                    "type": "underpaced",
                    "severity": "medium",
                    "title": "Conservative start (negative split)",
                    "detail": (
                        f"Your output rose {change:.0f}% from the first third to the last. "
                        f"A small negative split is ideal; a large one suggests you left time on "
                        f"the road early."
                    ),
                    "recommendation": (
                        "You had more in the tank at the start. Next time, allow a slightly firmer "
                        "opening — but only if you can hold it without drifting into the red."
                    ),
                }
            )
        else:
            findings.append(
                {
                    "type": "even",
                    "severity": "low",
                    "title": "Evenly paced",
                    "detail": (
                        f"Effort changed only {change:+.0f}% across the ride — disciplined, "
                        f"sustainable pacing."
                    ),
                    "recommendation": "Keep doing exactly this; it's the hardest thing to get right.",
                }
            )

    if decoupling is not None:
        if decoupling >= 8:
            findings.append(
                {
                    "type": "decoupling",
                    "severity": "high",
                    "title": f"High aerobic decoupling ({decoupling:.0f}%)",
                    "detail": (
                        "Your heart rate drifted well above your output in the second half. "
                        "This points to fatigue compounded by heat, dehydration or under-fuelling "
                        "rather than pure pacing."
                    ),
                    "recommendation": (
                        "Test your fuelling and drinking cadence — aim for a steady intake every "
                        "20–30 min from the start rather than catching up once you feel low."
                    ),
                }
            )
        elif decoupling <= 5:
            findings.append(
                {
                    "type": "decoupling",
                    "severity": "low",
                    "title": f"Low decoupling ({decoupling:.0f}%)",
                    "detail": "Heart rate stayed coupled to output — strong durability and fuelling.",
                    "recommendation": "Your endurance base and fuelling are working; protect them.",
                }
            )

    return {
        "question": "Did I overpace, underpace, or lose time — and why?",
        "available": True,
        "metric": "power" if has_power else "gradeAdjustedSpeed",
        "thirds": thirds,
        "decouplingPct": round(decoupling, 1) if decoupling is not None else None,
        "findings": findings,
        "verdict": verdict,
    }


def _thirds(dist, effort, hr, speed_kmh, total, has_power) -> List[dict]:
    bounds = [total / 3.0, 2.0 * total / 3.0]
    groups: List[dict] = [
        {"e": [], "h": [], "s": []} for _ in range(3)
    ]
    for d, e, h, s in zip(dist, effort, hr, speed_kmh):
        g = 0 if d < bounds[0] else (1 if d < bounds[1] else 2)
        groups[g]["e"].append(e)
        if h is not None:
            groups[g]["h"].append(h)
        groups[g]["s"].append(s)
    labels = ["First third", "Middle third", "Final third"]
    out = []
    for i, grp in enumerate(groups):
        out.append(
            {
                "label": labels[i],
                "effort": round(sum(grp["e"]) / len(grp["e"]), 1) if grp["e"] else None,
                "avgSpeedKmh": round(sum(grp["s"]) / len(grp["s"]), 1) if grp["s"] else None,
                "avgHr": round(sum(grp["h"]) / len(grp["h"])) if grp["h"] else None,
            }
        )
    return out


def _decoupling(effort: List[float], hr: List[Optional[float]]) -> Optional[float]:
    pairs = [(e, h) for e, h in zip(effort, hr) if h is not None and h > 0]
    if len(pairs) < 60:
        return None
    half = len(pairs) // 2
    first = pairs[:half]
    second = pairs[half:]

    def ratio(chunk):
        e = sum(p[0] for p in chunk) / len(chunk)
        h = sum(p[1] for p in chunk) / len(chunk)
        return e / h if h else None

    r1 = ratio(first)
    r2 = ratio(second)
    if not r1 or not r2:
        return None
    # efficiency drop -> positive decoupling
    return (r1 - r2) / r1 * 100.0


def _fmt_effort(value: float, has_power: bool) -> str:
    return f"{value:.0f} W" if has_power else f"{value:.1f} km/h eq."
