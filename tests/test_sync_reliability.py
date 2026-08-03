"""Tests for sync versioning and companion bundle alternatives."""

from __future__ import annotations

from datetime import datetime, timezone
import unittest
from unittest.mock import MagicMock, patch

from companion_bundle import COMPANION_SCHEMA_VERSION, build_companion_bundle


class CompanionBundleAlternativeTests(unittest.TestCase):
    def test_build_companion_bundle_exports_alternatives(self):
        roadbook = {
            "summary": {
                "route_name": "Alt Route",
                "distance_km": 80.0,
                "elevation_gain_m": 1500.0,
            },
            "route": {
                "track_points": [
                    {"lat": 46.0, "lon": 7.0, "ele_m": 500},
                    {"lat": 46.1, "lon": 7.1, "ele_m": 600},
                ],
            },
            "resupply_zones": [
                {
                    "zone_id": 1,
                    "distance_along_km": 40.0,
                    "lat": 46.05,
                    "lon": 7.05,
                    "name": "KM 40",
                    "categories": [
                        {
                            "key": "food",
                            "label": "Food",
                            "primary": {
                                "osm_id": 1,
                                "osm_type": "node",
                                "name": "Shop A",
                                "poi_category": "Supermarket",
                                "distance_off_route_m": 120,
                                "distance_along_km": 40.0,
                                "score": 55,
                                "lat": 46.051,
                                "lon": 7.051,
                            },
                            "alternatives": [
                                {
                                    "osm_id": 2,
                                    "osm_type": "node",
                                    "name": "Shop B",
                                    "poi_category": "Convenience",
                                    "distance_off_route_m": 80,
                                    "distance_along_km": 40.1,
                                    "score": 48,
                                    "lat": 46.052,
                                    "lon": 7.052,
                                }
                            ],
                        },
                        {
                            "key": "water",
                            "label": "Water",
                            "primary": {
                                "osm_id": 3,
                                "osm_type": "node",
                                "name": "Fountain",
                                "poi_category": "Drinking water",
                                "distance_off_route_m": 30,
                                "distance_along_km": 39.9,
                                "score": 62,
                                "lat": 46.050,
                                "lon": 7.050,
                            },
                            "alternatives": [],
                        },
                    ],
                }
            ],
        }

        bundle = build_companion_bundle("alt-route", roadbook, {}, revision=5)

        self.assertEqual(bundle["schemaVersion"], COMPANION_SCHEMA_VERSION)
        self.assertEqual(bundle["revision"], 5)
        self.assertEqual(bundle["bundle_version"], 5)
        self.assertTrue(bundle.get("bundleChecksum"))
        stop = bundle["stops"][0]
        self.assertEqual(stop["osmId"], 3)
        self.assertEqual(stop["name"], "Fountain")
        self.assertGreaterEqual(len(stop["alternatives"]), 1)
        self.assertIn(stop["alternatives"][0]["osmId"], (1, 2))


class RaceSyncReliabilityTests(unittest.TestCase):
    def test_push_all_skips_unchanged_races(self):
        from cloud import race_sync

        existing_row = {
            "companion_revision": 2,
            "has_bundle": True,
            "updated_at": datetime(2026, 1, 1, tzinfo=timezone.utc).isoformat(),
            "preparation": {"significant_climb_count": 2},
        }
        summary = MagicMock()
        summary.id = "race-1"
        summary.name = "Test"
        summary.updated_at = datetime(2025, 12, 1, tzinfo=timezone.utc).isoformat()

        with patch.object(race_sync.race_store, "list_races", return_value=[summary]), patch.object(
            race_sync.race_store, "get_race"
        ) as get_race_mock, patch.object(
            race_sync, "_get_race_row", return_value=existing_row
        ), patch.object(
            race_sync,
            "_resolve_cloud_race_target",
            return_value=("race-1", existing_row),
        ), patch.object(race_sync, "push_race") as push_mock:
            get_race_mock.return_value.meta.gpx_fingerprint = "fp123"
            result = race_sync.push_all_local_races("user-1", "token")

        push_mock.assert_not_called()
        self.assertEqual(
            result["skipped"],
            [{"race_id": "race-1", "name": "Test", "reason": "unchanged"}],
        )
        self.assertEqual(result["uploaded"], [])
        self.assertEqual(result["failed"], [])

    def test_race_needs_upload_when_climb_count_changes(self):
        from cloud import race_sync

        roadbook = {
            "summary": {"climb_count": 2},
            "climbs": [
                {"id": "C001", "length_km": 9.5, "elevation_gain_m": 390, "avg_gradient_pct": 4.1},
                {"id": "C002", "length_km": 9.47, "elevation_gain_m": 280, "avg_gradient_pct": 3.0},
            ],
        }
        existing_row = {
            "has_bundle": True,
            "updated_at": datetime(2026, 7, 15, 13, 0, tzinfo=timezone.utc).isoformat(),
            "preparation": {"significant_climb_count": 1, "bundle_schema_version": 5},
        }

        with patch.object(race_sync.race_store, "load_analysis", return_value=roadbook), patch.object(
            race_sync.race_store, "get_summary"
        ) as summary_mock, patch.object(race_sync.race_store, "get_race") as race_mock, patch.object(
            race_sync,
            "_resolve_cloud_race_target",
            return_value=("cloud-race", existing_row),
        ):
            summary_mock.return_value.updated_at = datetime(
                2026, 7, 15, 12, 0, tzinfo=timezone.utc
            ).isoformat()
            race_mock.return_value.meta.gpx_fingerprint = "abc123"
            self.assertTrue(
                race_sync._race_needs_upload(
                    "local-race",
                    existing_row,
                    user_id="user-1",
                    access_token="token",
                )
            )

    def test_push_race_reuses_cloud_race_id_for_same_gpx_fingerprint(self):
        from cloud import race_sync

        race = MagicMock()
        race.preparation.to_dict.return_value = {}
        race.analysis = {"analyzed_at": "2026-07-15T13:00:00+00:00"}
        race.meta.gpx_fingerprint = "fp123"

        summary = MagicMock()
        summary.name = "Conserolla"
        summary.distance_km = 39.01
        summary.elevation_gain_m = 727

        roadbook = {
            "summary": {"route_name": "Conserolla", "distance_km": 39.01, "elevation_gain_m": 727, "climb_count": 2},
            "route": {"track_points": [{"lat": 41.4, "lon": 2.1, "ele_m": 100}]},
            "climbs": [
                {"id": "C001", "length_km": 9.5, "elevation_gain_m": 390, "avg_gradient_pct": 4.1},
                {"id": "C002", "length_km": 9.47, "elevation_gain_m": 280, "avg_gradient_pct": 3.0},
            ],
            "resupply_zones": [],
        }

        uploaded_paths: list[str] = []

        def capture_upload(path: str, payload: bytes, content_type: str, access_token=None):
            uploaded_paths.append(path)

        with patch.object(race_sync.race_store, "get_race", return_value=race), patch.object(
            race_sync.race_store, "get_summary", return_value=summary
        ), patch.object(race_sync.race_store, "get_gpx_path") as gpx_mock, patch.object(
            race_sync.race_store, "load_analysis", return_value=roadbook
        ), patch.object(
            race_sync,
            "_resolve_cloud_race_target",
            return_value=("626b3103-c50d-49eb-b5de-8a129a5f27f3", {"companion_revision": 5}),
        ), patch.object(
            race_sync, "_upsert_race_row", return_value={"companion_revision": 6}
        ) as upsert_mock, patch.object(race_sync, "_upload_bytes", side_effect=capture_upload), patch.object(
            race_sync, "build_companion_bundle", wraps=race_sync.build_companion_bundle
        ) as bundle_mock:
            gpx_path = MagicMock()
            gpx_path.exists.return_value = True
            gpx_path.read_bytes.return_value = b"<gpx/>"
            gpx_mock.return_value = gpx_path

            result = race_sync.push_race("user-1", "b7a1c487-80c6-477c-87ae-ec9dd32b900c")

        self.assertEqual(result["race_id"], "626b3103-c50d-49eb-b5de-8a129a5f27f3")
        self.assertEqual(result["local_race_id"], "b7a1c487-80c6-477c-87ae-ec9dd32b900c")
        self.assertTrue(any("626b3103-c50d-49eb-b5de-8a129a5f27f3" in path for path in uploaded_paths))
        bundle_mock.assert_called_once()
        self.assertEqual(bundle_mock.call_args.args[0], "626b3103-c50d-49eb-b5de-8a129a5f27f3")
        upsert_payload = upsert_mock.call_args.args[0]
        self.assertEqual(upsert_payload["id"], "626b3103-c50d-49eb-b5de-8a129a5f27f3")
        self.assertEqual(upsert_payload["preparation"]["significant_climb_count"], 2)

    def test_race_needs_upload_when_cloud_metadata_missing(self):
        from cloud import race_sync

        roadbook = {
            "summary": {"climb_count": 13},
            "climbs": [{"id": "C001", "length_km": 9.5, "elevation_gain_m": 390, "avg_gradient_pct": 4.1}] * 13,
        }
        existing_row = {
            "has_bundle": True,
            "updated_at": datetime(2026, 7, 15, 4, 54, tzinfo=timezone.utc).isoformat(),
            "preparation": {},
        }

        with patch.object(race_sync.race_store, "load_analysis", return_value=roadbook), patch.object(
            race_sync.race_store, "get_summary"
        ) as summary_mock, patch.object(race_sync.race_store, "get_race") as race_mock, patch.object(
            race_sync,
            "_resolve_cloud_race_target",
            return_value=("d836e1d9-1fa9-49ea-8476-694c6c00d090", existing_row),
        ), patch.object(race_sync, "_cloud_bundle_is_stale", return_value=False):
            summary_mock.return_value.updated_at = datetime(
                2026, 7, 14, 0, 14, tzinfo=timezone.utc
            ).isoformat()
            race_mock.return_value.meta.gpx_fingerprint = "6e5333b6e8b2d663"
            self.assertTrue(
                race_sync._race_needs_upload(
                    "d836e1d9-1fa9-49ea-8476-694c6c00d090",
                    existing_row,
                    user_id="user-1",
                    access_token="token",
                )
            )

    def test_race_needs_upload_when_cloud_bundle_schema_is_stale(self):
        from cloud import race_sync

        roadbook = {
            "summary": {"climb_count": 13},
            "climbs": [{"id": "C001", "length_km": 9.5, "elevation_gain_m": 390, "avg_gradient_pct": 4.1}] * 13,
        }
        existing_row = {
            "has_bundle": True,
            "updated_at": datetime(2026, 7, 15, 4, 54, tzinfo=timezone.utc).isoformat(),
            "preparation": {
                "bundle_schema_version": 5,
                "significant_climb_count": 13,
            },
        }

        with patch.object(race_sync.race_store, "load_analysis", return_value=roadbook), patch.object(
            race_sync.race_store, "get_summary"
        ) as summary_mock, patch.object(race_sync.race_store, "get_race") as race_mock, patch.object(
            race_sync,
            "_resolve_cloud_race_target",
            return_value=("d836e1d9-1fa9-49ea-8476-694c6c00d090", existing_row),
        ), patch.object(race_sync, "_cloud_bundle_is_stale", return_value=True):
            summary_mock.return_value.updated_at = datetime(
                2026, 7, 14, 0, 14, tzinfo=timezone.utc
            ).isoformat()
            race_mock.return_value.meta.gpx_fingerprint = "6e5333b6e8b2d663"
            self.assertTrue(
                race_sync._race_needs_upload(
                    "d836e1d9-1fa9-49ea-8476-694c6c00d090",
                    existing_row,
                    user_id="user-1",
                    access_token="token",
                )
            )

    def test_push_race_returns_version_fields(self):
        from cloud import race_sync

        race = MagicMock()
        race.preparation.to_dict.return_value = {}
        race.analysis = {"analyzed_at": None}
        race.meta.gpx_fingerprint = ""

        summary = MagicMock()
        summary.name = "Versioned"
        summary.distance_km = 100
        summary.elevation_gain_m = 1000

        with patch.object(race_sync.race_store, "get_race", return_value=race), patch.object(
            race_sync.race_store, "get_summary", return_value=summary
        ), patch.object(race_sync.race_store, "get_gpx_path") as gpx_mock, patch.object(
            race_sync.race_store, "load_analysis", return_value=None
        ), patch.object(
            race_sync,
            "_resolve_cloud_race_target",
            return_value=("race-1", {"companion_revision": 4}),
        ), patch.object(
            race_sync, "_upsert_race_row", return_value={"companion_revision": 4}
        ), patch.object(race_sync, "_upload_bytes"):
            gpx_path = MagicMock()
            gpx_path.exists.return_value = False
            gpx_mock.return_value = gpx_path
            result = race_sync.push_race("user-1", "race-1")

        self.assertEqual(result["companion_revision"], 4)
        self.assertEqual(result["version"], 4)
        self.assertEqual(result["bundle_version"], 4)
        self.assertEqual(result["name"], "Versioned")


if __name__ == "__main__":
    unittest.main()
