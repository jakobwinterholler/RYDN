"""Tests for suggested stop selection."""

from __future__ import annotations

import unittest

from resupply_intelligence import stop_type_priority_boost
from suggested_stops import build_suggested_stops, _violates_dedup, SuggestedStop, resolve_planning_zones


class SuggestedStopsTests(unittest.TestCase):
    def test_convenience_store_priority(self) -> None:
        convenience = stop_type_priority_boost({"poi_category": "Convenience store"}, "food")
        large = stop_type_priority_boost({"poi_category": "Supermarket"}, "food")
        self.assertGreater(convenience, large)

    def test_dedup_rejects_nearby_duplicates(self) -> None:
        existing = [
            SuggestedStop(
                zone_id=1,
                osm_id=1,
                osm_type="node",
                name="Fuel A",
                poi_category="Gas station",
                category_key="fuel",
                category_label="Fuel",
                distance_along_km=10.0,
                distance_off_route_m=20.0,
                lat=0.0,
                lon=0.0,
                score=80.0,
                reason=None,
            )
        ]
        candidate = SuggestedStop(
            zone_id=2,
            osm_id=2,
            osm_type="node",
            name="Fuel B",
            poi_category="Gas station",
            category_key="fuel",
            category_label="Fuel",
            distance_along_km=10.15,
            distance_off_route_m=20.0,
            lat=0.0,
            lon=0.0,
            score=75.0,
            reason=None,
        )
        self.assertTrue(_violates_dedup(candidate, existing))

    def test_build_suggested_stops_from_zones(self) -> None:
        zones = [
            {
                "zone_id": 1,
                "distance_along_km": 10.0,
                "lat": 41.0,
                "lon": 2.0,
                "poi_count": 2,
                "accessibility_tone": "good",
                "categories": [
                    {
                        "key": "fuel",
                        "label": "Fuel",
                        "primary": {
                            "osm_id": 100,
                            "osm_type": "node",
                            "name": "Station",
                            "poi_category": "Gas station",
                            "distance_along_km": 10.0,
                            "distance_off_route_m": 30.0,
                            "score": 70.0,
                            "lat": 41.0,
                            "lon": 2.0,
                        },
                        "alternatives": [],
                    }
                ],
            },
            {
                "zone_id": 2,
                "distance_along_km": 50.0,
                "lat": 41.1,
                "lon": 2.1,
                "poi_count": 1,
                "accessibility_tone": "good",
                "categories": [
                    {
                        "key": "water",
                        "label": "Water",
                        "primary": {
                            "osm_id": 200,
                            "osm_type": "node",
                            "name": "Fountain",
                            "poi_category": "Drinking water",
                            "distance_along_km": 50.0,
                            "distance_off_route_m": 10.0,
                            "score": 60.0,
                            "lat": 41.1,
                            "lon": 2.1,
                        },
                        "alternatives": [],
                    }
                ],
            },
        ]
        stops = build_suggested_stops(zones, climbs=[], total_km=100.0)
        self.assertGreaterEqual(len(stops), 1)
        self.assertIn("zone_id", stops[0])

    def test_resolve_planning_zones_uses_suggested_stops(self) -> None:
        roadbook = {
            "summary": {"distance_km": 100.0},
            "resupply_zones": [
                {"zone_id": 1, "distance_along_km": 10.0, "categories": []},
                {"zone_id": 2, "distance_along_km": 50.0, "categories": []},
            ],
            "suggested_stops": [{"zone_id": 2}],
        }
        zones = resolve_planning_zones(roadbook)
        self.assertEqual([zone["zone_id"] for zone in zones], [2])

    def test_resolve_planning_zones_migrates_missing_suggested_stops(self) -> None:
        roadbook = {
            "summary": {"distance_km": 100.0},
            "climbs": [],
            "resupply_zones": [
                {
                    "zone_id": 1,
                    "distance_along_km": 10.0,
                    "poi_count": 2,
                    "accessibility_tone": "good",
                    "categories": [
                        {
                            "key": "fuel",
                            "label": "Fuel",
                            "primary": {
                                "osm_id": 100,
                                "osm_type": "node",
                                "name": "Station",
                                "poi_category": "Gas station",
                                "distance_along_km": 10.0,
                                "distance_off_route_m": 30.0,
                                "score": 70.0,
                                "lat": 41.0,
                                "lon": 2.0,
                            },
                            "alternatives": [],
                        }
                    ],
                },
                {
                    "zone_id": 2,
                    "distance_along_km": 50.0,
                    "poi_count": 1,
                    "accessibility_tone": "good",
                    "categories": [
                        {
                            "key": "water",
                            "label": "Water",
                            "primary": {
                                "osm_id": 200,
                                "osm_type": "node",
                                "name": "Fountain",
                                "poi_category": "Drinking water",
                                "distance_along_km": 50.0,
                                "distance_off_route_m": 10.0,
                                "score": 60.0,
                                "lat": 41.1,
                                "lon": 2.1,
                            },
                            "alternatives": [],
                        }
                    ],
                },
            ],
        }
        zones = resolve_planning_zones(roadbook)
        self.assertGreaterEqual(len(zones), 1)
        self.assertTrue(all("zone_id" in zone for zone in zones))


if __name__ == "__main__":
    unittest.main()
