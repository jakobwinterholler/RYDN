"""Resupply scoring — water & small markets beat dining / hypers."""

from app.analysis.route_stops import rank_candidates, score_stop


def test_drinking_water_ranks_above_restaurant():
    water = score_stop(
        {
            "osmId": 1,
            "osmType": "node",
            "name": "Font",
            "category": "Drinking water",
            "group": "water",
            "lat": 42.0,
            "lon": 1.0,
            "distanceAlongKm": 10,
            "distanceOffRouteM": 40,
        }
    )
    resto = score_stop(
        {
            "osmId": 2,
            "osmType": "node",
            "name": "Cafe",
            "category": "Restaurant",
            "group": "dining",
            "lat": 42.0,
            "lon": 1.0,
            "distanceAlongKm": 10,
            "distanceOffRouteM": 40,
            "openingHours": "Mo-Su 12:00-22:00",
        }
    )
    assert water["resupplyScore"] > resto["resupplyScore"]
    assert water["priority"] is True


def test_small_supermarket_beats_hyper():
    small = score_stop(
        {
            "osmId": 3,
            "osmType": "node",
            "name": "Condis",
            "brand": "Condis",
            "category": "Supermarket",
            "group": "resupply",
            "lat": 42.0,
            "lon": 1.0,
            "distanceAlongKm": 20,
            "distanceOffRouteM": 60,
            "openingHours": "Mo-Sa 09:00-21:00",
        }
    )
    hyper = score_stop(
        {
            "osmId": 4,
            "osmType": "node",
            "name": "Auchan",
            "brand": "Auchan",
            "category": "Supermarket",
            "group": "resupply",
            "lat": 42.0,
            "lon": 1.0,
            "distanceAlongKm": 20,
            "distanceOffRouteM": 60,
            "openingHours": "Mo-Sa 09:00-21:00",
        }
    )
    assert small["storeSize"] == "small"
    assert hyper["storeSize"] == "large"
    assert small["resupplyScore"] > hyper["resupplyScore"]


def test_rank_candidates_skips_exclude_and_limits():
    pois = [
        {
            "id": f"area-node-{i}",
            "osmId": i,
            "osmType": "node",
            "name": f"Spar {i}" if i % 2 == 0 else f"Restaurant {i}",
            "brand": "Spar" if i % 2 == 0 else None,
            "category": "Supermarket" if i % 2 == 0 else "Restaurant",
            "group": "resupply" if i % 2 == 0 else "dining",
            "lat": 42.0,
            "lon": 1.0,
            "distanceAlongKm": i,
            "distanceOffRouteM": 50,
        }
        for i in range(30)
    ]
    batch, has_more = rank_candidates(pois, exclude_ids=["area-node-0"], limit=15)
    assert len(batch) == 15
    assert has_more is True
    assert all(s["id"] != "area-node-0" for s in batch)
    # Highest-scoring first
    scores = [s["resupplyScore"] for s in batch]
    assert scores == sorted(scores, reverse=True)
