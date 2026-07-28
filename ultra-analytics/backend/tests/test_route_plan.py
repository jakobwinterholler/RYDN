"""Unit tests for planned-route planning intelligence."""

from app.analysis.route_plan import detect_route_climbs, suggest_stages
from app.analysis import route_analysis
from app.analysis.route_stops import select_recommended_stops


def _climb_track():
    track = []
    km = 0.0
    ele = 100.0
    for _ in range(100):
        track.append([46.0, 8.0, ele, km])
        km += 0.1
    for _ in range(40):
        ele += 40
        km += 0.15
        track.append([46.05, 8.1, ele, km])
    for _ in range(20):
        ele -= 50
        km += 0.1
        track.append([46.1, 8.2, ele, km])
    return track


def test_detect_climbs_finds_significant_ascent():
    climbs = detect_route_climbs(_climb_track())
    assert len(climbs) >= 1
    assert climbs[0]["elevationGainM"] >= 50
    assert climbs[0]["estimatedClimbTimeS"]
    assert climbs[0]["difficultyScore"] >= 1
    assert any(c["hard"] for c in climbs)


def test_undulating_climb_stays_one_segment():
    track = []
    km = 0.0
    ele = 200.0
    for i in range(30):
        track.append([42.8, 0.1 + i * 0.001, ele, km])
        km += 0.2
    for i in range(80):
        if i % 12 < 9:
            ele += 18
        elif i % 12 < 11:
            ele -= 3
        else:
            ele += 5
        track.append([42.8 + i * 0.0004, 0.2 + i * 0.002, ele, km])
        km += 0.25
    for i in range(20):
        ele -= 40
        track.append([42.9, 0.5 + i * 0.002, ele, km])
        km += 0.2
    climbs = detect_route_climbs(track)
    assert len(climbs) == 1
    assert climbs[0]["elevationGainM"] >= 200


def test_suggest_stages_snaps_to_sleep():
    stages = suggest_stages(
        750,
        [(0, 100), (375, 200), (750, 150)],
        snap_kms=[240, 500],
        hard_climb_kms=[(520, 560)],
    )
    assert len(stages) >= 2
    assert stages[0]["label"] == "Day 1"


def test_select_recommended_stops_caps_count():
    pois = [
        {
            "osmId": i,
            "osmType": "node",
            "name": f"S{i}",
            "category": "Supermarket",
            "group": "resupply",
            "lat": 42.0,
            "lon": 1.0,
            "distanceAlongKm": i * 35,
            "distanceOffRouteM": 40,
            "openingHours": "24/7" if i % 4 == 0 else None,
        }
        for i in range(40)
    ]
    rec = select_recommended_stops(pois, [], total_km=1000)
    assert 10 <= len(rec) <= 30
    assert rec[0]["qualityStars"] >= 4


def test_analyze_planned_route_offline(monkeypatch):
    monkeypatch.setattr(
        route_analysis,
        "fetch_route_pois",
        lambda *_a, **_k: {
            "pois": [
                {
                    "osmId": i,
                    "osmType": "node",
                    "name": f"Shop {i}",
                    "category": "Supermarket",
                    "group": "resupply",
                    "lat": 46.0,
                    "lon": 8.0,
                    "distanceAlongKm": i * 40.0,
                    "distanceOffRouteM": 20,
                }
                for i in range(20)
            ],
            "sleep": [
                {
                    "osmId": 2,
                    "osmType": "node",
                    "name": "Inn",
                    "category": "Hotel",
                    "group": "sleep",
                    "lat": 46.0,
                    "lon": 8.05,
                    "distanceAlongKm": 200.0,
                    "distanceOffRouteM": 40,
                }
            ],
            "cache": "hit",
            "error": None,
        },
    )
    monkeypatch.setattr(route_analysis, "fetch_route_weather", lambda *_a, **_k: None)
    route = {
        "id": "test",
        "distanceKm": 800.0,
        "elevationGainM": 9000,
        "track": _climb_track(),
        "dateStart": None,
        "stopReviews": {},
    }
    out = route_analysis.analyze_planned_route(route, force_refresh=False)
    assert out["summary"]["climbCount"] >= 1
    assert out["recommendedStops"]
    assert "criticalDecisions" in out
    assert out["weather"] is None
