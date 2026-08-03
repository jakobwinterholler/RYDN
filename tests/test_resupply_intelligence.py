"""Tests for resupply intelligence ranking."""

from __future__ import annotations

import unittest

from resupply_intelligence import (
    build_resupply_reason,
    planning_score,
    stop_type_priority_boost,
)


class ResupplyIntelligenceTests(unittest.TestCase):
    def test_fuel_outranks_large_supermarket(self) -> None:
        fuel = {
            "poi_category": "Gas station",
            "score": 55.0,
            "distance_off_route_m": 40.0,
            "distance_along_km": 20.0,
        }
        supermarket = {
            "poi_category": "Supermarket",
            "score": 60.0,
            "distance_off_route_m": 40.0,
            "distance_along_km": 20.0,
        }
        fuel_score = planning_score(fuel, category_key="fuel", zone_km=20.0)
        market_score = planning_score(supermarket, category_key="food", zone_km=20.0)
        self.assertGreater(fuel_score, market_score)

    def test_small_supermarket_outranks_large_supermarket(self) -> None:
        small = stop_type_priority_boost({"poi_category": "Small supermarket"}, "food")
        large = stop_type_priority_boost({"poi_category": "Supermarket"}, "food")
        self.assertGreater(small, large)

    def test_convenience_outranks_large_supermarket(self) -> None:
        convenience = stop_type_priority_boost({"poi_category": "Convenience store"}, "food")
        large = stop_type_priority_boost({"poi_category": "Supermarket"}, "food")
        self.assertGreater(convenience, large)

    def test_water_on_climb_favours_later_fountain(self) -> None:
        climbs = [{"id": "C001", "start_km": 10.0, "end_km": 15.0}]
        bottom = {
            "poi_category": "Drinking water",
            "score": 50.0,
            "distance_off_route_m": 10.0,
            "distance_along_km": 10.5,
        }
        top = {
            "poi_category": "Drinking water",
            "score": 50.0,
            "distance_off_route_m": 10.0,
            "distance_along_km": 14.5,
        }
        peer_kms = [10.5, 14.5]
        bottom_score = planning_score(
            bottom,
            category_key="water",
            zone_km=10.5,
            climbs=climbs,
            peer_kms=peer_kms,
        )
        top_score = planning_score(
            top,
            category_key="water",
            zone_km=14.5,
            climbs=climbs,
            peer_kms=peer_kms,
        )
        self.assertGreater(top_score, bottom_score)

    def test_build_resupply_reason_for_unsupported_gap(self) -> None:
        reason = build_resupply_reason(
            {"poi_category": "Drinking water", "distance_along_km": 22.0},
            category_key="water",
            zone_km=22.0,
            unsupported_sections=[{"startKm": 22.0, "distanceKm": 37.0}],
        )
        self.assertIsNotNone(reason)
        self.assertIn("37", reason or "")


    def test_opening_hours_boost(self) -> None:
        with_hours = planning_score(
            {
                "poi_category": "Gas station",
                "score": 50.0,
                "distance_off_route_m": 40.0,
                "distance_along_km": 20.0,
                "opening_hours": "24/7",
            },
            category_key="fuel",
            zone_km=20.0,
        )
        without_hours = planning_score(
            {
                "poi_category": "Gas station",
                "score": 50.0,
                "distance_off_route_m": 40.0,
                "distance_along_km": 20.0,
            },
            category_key="fuel",
            zone_km=20.0,
        )
        self.assertGreater(with_hours, without_hours)

    def test_highway_only_fuel_penalized(self) -> None:
        highway = planning_score(
            {
                "poi_category": "Gas station",
                "score": 60.0,
                "distance_off_route_m": 40.0,
                "distance_along_km": 20.0,
                "tags": {"highway": "motorway"},
            },
            category_key="fuel",
            zone_km=20.0,
        )
        normal = planning_score(
            {
                "poi_category": "Gas station",
                "score": 60.0,
                "distance_off_route_m": 40.0,
                "distance_along_km": 20.0,
            },
            category_key="fuel",
            zone_km=20.0,
        )
        self.assertLess(highway, normal)


if __name__ == "__main__":
    unittest.main()
