"""Stop classifier — behaviour first, location last.

Philosophy (see ULTRA_ANALYTICS_BRAIN.md): a stop's *category* is earned from what
the rider actually did, not from what happened to be nearby. A hotel/sleep has a
very characteristic behavioural signature (hours stationary, no data recorded,
overnight); a 10-minute stop is never a hotel just because a hotel is nearby.

The classifier is an **additive evidence model**:

    each Signal(features) -> [Evidence(category, weight, reason)]

Behavioural signals carry real weight and can classify a stop on their own.
External signals (nearby accommodation, POIs) are deliberately *weak* — they can
only nudge confidence, never reach the decision threshold alone. Authoritative
signals (a Roadbook/Companion **verified** stop, or a **rider correction**)
short-circuit to a near-certain answer.

When the best category can't clear the confidence threshold, we return
**unknown** on purpose: accuracy matters more than labelling every stop.

Adding a new signal later (Google Places, OSM, verified-stop matching, learned
priors) is just appending a function to ``SIGNALS`` or populating a new field on
``StopFeatures`` — nothing else changes.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, List, Optional, Tuple

from .helpers import fmt_duration

# --- categories -----------------------------------------------------------
SLEEP = "sleep"
HOTEL = "hotel"
RESUPPLY = "resupply"
RESTAURANT = "restaurant"
CAFE = "cafe"
WATER = "water"
SCENIC = "scenic"
MECHANICAL = "mechanical"
TRAFFIC = "traffic"
UNKNOWN = "unknown"

# A stop must reach this confidence to be labelled; otherwise it stays unknown.
CLASSIFY_THRESHOLD = 0.50
MAX_CONFIDENCE = 0.98


@dataclass
class StopFeatures:
    """Everything the classifier is allowed to reason about, per stop."""

    duration_s: float
    local_hour: float
    night: bool  # judged at the stop's midpoint
    is_gap: bool  # device stopped recording (bike parked / powered off)
    high_point: bool
    elevation_m: Optional[float] = None

    # --- external signals: plumbed for the future, unused in Phase 1 ---
    # These are intentionally weak (see accommodation/POI signals) — a nearby
    # hotel must never, on its own, make a stop a "hotel".
    near_accommodation: Optional[bool] = None  # Google Places / OSM
    poi_category: Optional[str] = None  # nearest POI category (a hint only)
    # --- authoritative signals: override behaviour when present ---
    verified_category: Optional[str] = None  # matched a Roadbook/Companion verified stop
    user_category: Optional[str] = None  # rider correction

    @property
    def minutes(self) -> float:
        return self.duration_s / 60.0


@dataclass
class Evidence:
    category: str
    weight: float
    reason: str


Signal = Callable[[StopFeatures], List[Evidence]]


# --- behavioural signals (primary) ---------------------------------------


def _long_rest(f: StopFeatures) -> List[Evidence]:
    """Hours stationary is the hallmark of sleep / accommodation."""
    ev: List[Evidence] = []
    m = f.minutes
    if m >= 180:
        # 3h+ : unmistakable long rest. Weight grows with duration.
        w = 0.55 + min(0.20, (m - 180) / 240 * 0.20)  # +0.20 by ~7h
        dur = fmt_duration(f.duration_s)
        if f.night:
            ev.append(Evidence(SLEEP, w, f"stationary {dur}"))
            ev.append(Evidence(SLEEP, 0.18, "spanned your local night"))
        else:
            ev.append(Evidence(HOTEL, w, f"stationary {dur} — a full off-bike rest"))
    elif 75 <= m < 180:
        # 1.25–3h : a nap or a very long meal, but not a confident hotel.
        dur = fmt_duration(f.duration_s)
        if f.night:
            ev.append(Evidence(SLEEP, 0.50, f"stationary {dur} during the night — likely a nap"))
        else:
            ev.append(Evidence(HOTEL, 0.30, f"long {dur} daytime rest"))
            ev.append(Evidence(RESTAURANT, 0.22, "long enough for a sit-down meal"))
    return ev


def _device_off(f: StopFeatures) -> List[Evidence]:
    """No data recorded for a long time means the bike was parked/powered off —
    consistent with a proper rest, and inconsistent with a quick roadside stop."""
    if f.is_gap and f.minutes >= 45:
        cat = SLEEP if f.night else HOTEL
        return [Evidence(cat, 0.20, "no power or cadence recorded (device off — bike parked)")]
    return []


def _meal(f: StopFeatures) -> List[Evidence]:
    ev: List[Evidence] = []
    m = f.minutes
    h = f.local_hour
    lunch = 11.5 <= h <= 14.5
    dinner = 18.5 <= h <= 21.5
    if 25 <= m <= 100 and (lunch or dinner):
        ev.append(
            Evidence(RESTAURANT, 0.50, f"{fmt_duration(f.duration_s)} stop at {'lunch' if lunch else 'dinner'} time")
        )
    if 10 <= m < 25 and 7 <= h <= 19:
        ev.append(Evidence(CAFE, 0.30, f"{fmt_duration(f.duration_s)} daytime stop — long enough for a café"))
    return ev


def _quick_stop(f: StopFeatures) -> List[Evidence]:
    ev: List[Evidence] = []
    m = f.minutes
    if 3 <= m < 15:
        ev.append(Evidence(RESUPPLY, 0.34, f"brief {fmt_duration(f.duration_s)} stop — consistent with a shop"))
        ev.append(Evidence(WATER, 0.24, "short enough to be a water refill"))
    elif 15 <= m < 30 and not (11.5 <= f.local_hour <= 14.5 or 18.5 <= f.local_hour <= 21.5):
        ev.append(Evidence(RESUPPLY, 0.38, f"{fmt_duration(f.duration_s)} stop — resupply or food"))
    return ev


def _scenic(f: StopFeatures) -> List[Evidence]:
    if f.minutes < 20 and f.high_point and 6 <= f.local_hour <= 20:
        return [Evidence(SCENIC, 0.34, "brief daylight stop near a high point — possibly a viewpoint")]
    return []


def _traffic(f: StopFeatures) -> List[Evidence]:
    if f.minutes < 3:
        return [Evidence(TRAFFIC, 0.30, "very short — likely traffic, a junction or navigation")]
    return []


# --- external signals (weak by design — never decisive alone) -------------


def _accommodation_boost(f: StopFeatures) -> List[Evidence]:
    if f.near_accommodation:
        return [
            Evidence(HOTEL, 0.10, "accommodation nearby (supporting evidence only)"),
            Evidence(SLEEP, 0.08, "accommodation nearby (supporting evidence only)"),
        ]
    return []


def _poi_hint(f: StopFeatures) -> List[Evidence]:
    if f.poi_category:
        return [Evidence(f.poi_category, 0.15, f"a {f.poi_category} is nearby (weak hint)")]
    return []


# Ordered registry. Append new signals here — that is the entire extension point.
SIGNALS: List[Signal] = [
    _long_rest,
    _device_off,
    _meal,
    _quick_stop,
    _scenic,
    _traffic,
    _accommodation_boost,
    _poi_hint,
]


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def classify(f: StopFeatures) -> Tuple[str, float, List[str]]:
    """Return (category, confidence 0..1, reasons)."""
    # Authoritative overrides win outright — the rider (or a verified plan) knows.
    if f.user_category:
        return f.user_category, 0.99, ["you corrected this stop"]
    if f.verified_category:
        return f.verified_category, 0.95, ["matched a stop you verified in Roadbook/Companion"]

    scores: dict[str, float] = {}
    reasons: dict[str, List[str]] = {}
    for signal in SIGNALS:
        for e in signal(f):
            scores[e.category] = scores.get(e.category, 0.0) + e.weight
            reasons.setdefault(e.category, []).append(e.reason)

    if not scores:
        return UNKNOWN, 0.45, ["no convincing behavioural evidence"]

    best = max(scores, key=lambda c: scores[c])
    best_score = scores[best]

    if best_score >= CLASSIFY_THRESHOLD:
        return best, round(_clamp(best_score, 0.0, MAX_CONFIDENCE), 2), reasons[best]

    # Not convincing enough — stay honest.
    unknown_conf = round(_clamp(0.50 - best_score * 0.25, 0.25, 0.48), 2)
    why = ["no convincing behavioural evidence"]
    guess_label = _LABELS.get(best, best)
    why.append(f"closest guess would be {guess_label}, but confidence is too low")
    return UNKNOWN, unknown_conf, why


# Human-readable labels (shared with the summary/hint layer).
_LABELS = {
    SLEEP: "sleep",
    HOTEL: "hotel / rest",
    RESUPPLY: "resupply",
    RESTAURANT: "restaurant",
    CAFE: "café",
    WATER: "water",
    SCENIC: "scenic",
    MECHANICAL: "mechanical",
    TRAFFIC: "brief stop",
    UNKNOWN: "unknown",
}
