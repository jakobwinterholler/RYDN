"""Tests for permanent POI identifiers."""

from __future__ import annotations

import unittest

from poi_id import (
    compute_poi_id,
    migrate_verified_stops_to_poi_ids,
    resolve_verified_stop_record,
)


class PoiIdTests(unittest.TestCase):
    def test_osm_id_is_stable(self) -> None:
        poi = {"osm_id": 38472, "osm_type": "node", "name": "Fountain"}
        first = compute_poi_id("race-1", poi)
        second = compute_poi_id("race-1", poi)
        self.assertEqual(first, "poi_38472")
        self.assertEqual(first, second)

    def test_fallback_hash_is_deterministic(self) -> None:
        poi = {"poi_category": "Drinking water", "name": "Spring", "distance_along_km": 42.3}
        first = compute_poi_id("race-abc", poi)
        second = compute_poi_id("race-abc", poi)
        self.assertTrue(first.startswith("poi_"))
        self.assertEqual(first, second)

    def test_resolve_prefers_poi_id_over_zone(self) -> None:
        verified = {
            "1": {"status": "deferred"},
            "poi_99": {"status": "verified"},
        }
        record, key = resolve_verified_stop_record(verified, zone_id=1, poi_id="poi_99")
        self.assertEqual(key, "poi_99")
        self.assertEqual(record.get("status"), "verified")

    def test_migrate_copies_legacy_zone_keys(self) -> None:
        verified = {"5": {"status": "verified", "updated_at": "2026-01-01"}}
        stops = [{"zoneId": 5, "poiId": "poi_500"}]
        migrated = migrate_verified_stops_to_poi_ids(verified, stops)
        self.assertIn("poi_500", migrated)
        self.assertEqual(migrated["poi_500"]["status"], "verified")


if __name__ == "__main__":
    unittest.main()
