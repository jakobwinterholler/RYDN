"""Critical decisions — the few planning choices that actually matter."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence


def build_critical_decisions(
    *,
    recommended: Sequence[Dict[str, Any]],
    climbs: Sequence[Dict[str, Any]],
    remote_gaps: Sequence[Dict[str, Any]],
    stages: Sequence[Dict[str, Any]],
    sleep_plan: Sequence[Dict[str, Any]],
    total_km: float,
) -> List[Dict[str, Any]]:
    """Guide the rider through high-stakes moments — not every POI."""
    decisions: List[Dict[str, Any]] = []
    stops = list(recommended)
    hard_climbs = [c for c in climbs if c.get("hard")] or list(climbs)[:5]

    def stop_near(km: float, *, groups: Optional[Sequence[str]] = None, prefer_24h: bool = False):
        cand = stops
        if groups:
            cand = [s for s in cand if s.get("group") in groups or s.get("category") == "Gas station"]
        if not cand:
            return None
        if prefer_24h:
            h24 = [s for s in cand if s.get("is24h")]
            if h24:
                cand = h24
        return min(cand, key=lambda s: abs(float(s.get("distanceAlongKm") or 0) - km))

    # Remote gaps → last refill + warning.
    for gap in sorted(remote_gaps, key=lambda g: -float(g.get("distanceKm") or 0))[:6]:
        dist = float(gap.get("distanceKm") or 0)
        if dist < 25:
            continue
        start = float(gap["startKm"])
        last = stop_near(start - 1, groups=("water", "resupply"), prefer_24h=True)
        decisions.append(
            {
                "id": f"remote-{gap['id']}",
                "kind": "remote",
                "priority": 100 + dist,
                "title": f"No services for {dist:.0f} km",
                "detail": gap.get("label") or "",
                "advice": gap.get("preparation")
                or "Fill water and food before this stretch.",
                "km": start,
                "lat": gap.get("midLat"),
                "lon": gap.get("midLon"),
                "relatedStopId": last["id"] if last else None,
                "relatedStop": last,
                "riskLevel": gap.get("riskLevel"),
            }
        )
        if last and last.get("group") == "water":
            decisions.append(
                {
                    "id": f"last-water-{gap['id']}",
                    "kind": "last_water",
                    "priority": 95 + dist,
                    "title": f"Last reliable water before {dist:.0f} km without refill",
                    "detail": f"{last.get('name') or last.get('category')} · km {last.get('distanceAlongKm')}",
                    "advice": "Verify this fountain or shop before you commit to the gap.",
                    "km": float(last.get("distanceAlongKm") or start),
                    "lat": last.get("lat"),
                    "lon": last.get("lon"),
                    "relatedStopId": last["id"],
                    "relatedStop": last,
                    "riskLevel": gap.get("riskLevel"),
                }
            )
        elif last:
            decisions.append(
                {
                    "id": f"last-resupply-{gap['id']}",
                    "kind": "last_resupply",
                    "priority": 90 + dist,
                    "title": f"Best resupply before remote terrain ({dist:.0f} km)",
                    "detail": f"{last.get('name') or last.get('category')} · ★{last.get('qualityStars', '—')}",
                    "advice": "Confirm opening hours — next options are sparse.",
                    "km": float(last.get("distanceAlongKm") or start),
                    "lat": last.get("lat"),
                    "lon": last.get("lon"),
                    "relatedStopId": last["id"],
                    "relatedStop": last,
                    "riskLevel": gap.get("riskLevel"),
                }
            )

    # 24h gas before long gaps
    for gap in remote_gaps:
        if float(gap.get("distanceKm") or 0) < 40:
            continue
        gas = stop_near(float(gap["startKm"]) - 5, prefer_24h=True)
        if gas and gas.get("is24h") and gas.get("category") == "Gas station":
            decisions.append(
                {
                    "id": f"gas24-{gap['id']}",
                    "kind": "gas_24h",
                    "priority": 88,
                    "title": "Best 24-hour resupply before remote terrain",
                    "detail": f"{gas.get('name') or 'Gas station'} · km {gas.get('distanceAlongKm')}",
                    "advice": "Ultra gold — food, water, lights, anytime.",
                    "km": float(gas.get("distanceAlongKm") or 0),
                    "lat": gas.get("lat"),
                    "lon": gas.get("lon"),
                    "relatedStopId": gas["id"],
                    "relatedStop": gas,
                }
            )

    # Hard climbs ahead
    for climb in hard_climbs[:8]:
        decisions.append(
            {
                "id": f"climb-{climb['id']}",
                "kind": "major_climb",
                "priority": 70 + float(climb.get("difficultyScore") or 0) / 5,
                "title": f"Major climb begins at km {climb['startKm']:.0f}",
                "detail": (
                    f"{climb.get('name') or 'Climb'} · {climb.get('elevationGainM')} m · "
                    f"avg {climb.get('avgGradientPct')}% · {climb.get('difficultyLabel', '')}"
                ),
                "advice": "Fuel before the base. Pace the first third.",
                "km": float(climb["startKm"]),
                "lat": climb.get("startLat"),
                "lon": climb.get("startLon"),
                "relatedClimbId": climb["id"],
                "relatedClimb": climb,
            }
        )

    # Overnight / sleep before hard next-day climb
    for sp in sleep_plan:
        sug = sp.get("suggestion")
        stage_end = float(sp.get("targetKm") or 0)
        next_hard = None
        for c in hard_climbs:
            if stage_end < float(c["startKm"]) < stage_end + 120:
                next_hard = c
                break
        if sug and next_hard:
            decisions.append(
                {
                    "id": f"sleep-before-climb-{sp.get('stageIndex')}",
                    "kind": "overnight",
                    "priority": 85,
                    "title": f"Best hotel before tomorrow's hardest climb",
                    "detail": (
                        f"{sug.get('name') or sug.get('category')} · "
                        f"before {next_hard.get('name') or 'hard climb'}"
                    ),
                    "advice": "Sleep here so you hit the climb fresh.",
                    "km": float(sug.get("distanceAlongKm") or stage_end),
                    "lat": sug.get("lat"),
                    "lon": sug.get("lon"),
                    "relatedStopId": sug.get("id") or f"{sug.get('osmType')}:{sug.get('osmId')}",
                    "relatedStop": sug,
                }
            )
        elif sug:
            decisions.append(
                {
                    "id": f"overnight-{sp.get('stageIndex')}",
                    "kind": "overnight",
                    "priority": 60,
                    "title": f"Recommended overnight · {sp.get('stageLabel')}",
                    "detail": sug.get("name") or sug.get("category") or "Sleep option",
                    "advice": sp.get("note") or "Confirm availability and early breakfast.",
                    "km": float(sug.get("distanceAlongKm") or stage_end),
                    "lat": sug.get("lat"),
                    "lon": sug.get("lon"),
                    "relatedStopId": sug.get("id") or f"{sug.get('osmType')}:{sug.get('osmId')}",
                    "relatedStop": sug,
                }
            )

    # Deduplicate by id, sort by priority then km, cap.
    seen = set()
    uniq: List[Dict[str, Any]] = []
    for d in sorted(decisions, key=lambda x: (-float(x.get("priority") or 0), float(x.get("km") or 0))):
        if d["id"] in seen:
            continue
        seen.add(d["id"])
        uniq.append(d)

    # Never leave the signature feature empty when we have anything useful.
    if not uniq:
        if hard_climbs:
            c = hard_climbs[0]
            uniq.append(
                {
                    "id": f"fallback-climb-{c['id']}",
                    "kind": "major_climb",
                    "priority": 50,
                    "title": f"Long sustained climb begins at km {c['startKm']:.0f}",
                    "detail": f"{c.get('elevationGainM')} m · avg {c.get('avgGradientPct')}%",
                    "advice": "Fuel before the base. Pace the first third.",
                    "km": float(c["startKm"]),
                    "lat": c.get("startLat"),
                    "lon": c.get("startLon"),
                    "relatedClimbId": c["id"],
                    "relatedClimb": c,
                }
            )
        top = next((s for s in stops if s.get("qualityStars", 0) >= 4), stops[0] if stops else None)
        if top:
            uniq.append(
                {
                    "id": f"fallback-stop-{top['id']}",
                    "kind": "last_resupply",
                    "priority": 40,
                    "title": f"Priority resupply · {top.get('name') or top.get('category')}",
                    "detail": f"★{top.get('qualityStars')} {top.get('qualityLabel')} · km {top.get('distanceAlongKm')}",
                    "advice": "Verify this stop — it ranked highest for reliability on the course.",
                    "km": float(top.get("distanceAlongKm") or 0),
                    "lat": top.get("lat"),
                    "lon": top.get("lon"),
                    "relatedStopId": top["id"],
                    "relatedStop": top,
                }
            )
        if stages and len(stages) > 1:
            s0 = stages[0]
            uniq.append(
                {
                    "id": f"fallback-stage-{s0['index']}",
                    "kind": "overnight",
                    "priority": 35,
                    "title": f"Suggested Day 1 end · km {s0['endKm']:.0f}",
                    "detail": f"{s0['distanceKm']} km · {s0['elevationGainM']} m · {s0.get('reason')}",
                    "advice": "Confirm sleep near this break before locking the stage plan.",
                    "km": float(s0["endKm"]),
                    "lat": None,
                    "lon": None,
                }
            )

    return uniq[:18]
