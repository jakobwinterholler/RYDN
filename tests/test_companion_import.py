"""Tests for companion mobile GPX import helpers."""

from __future__ import annotations

import unittest

from companion_import import (
    bundles_match_within_tolerance,
    compute_gpx_fingerprint,
    find_local_duplicates,
    import_stage_catalog,
)
from race_project import race_store


class CompanionImportTests(unittest.TestCase):
    def test_import_stage_catalog_has_six_stages(self) -> None:
        stages = import_stage_catalog()
        self.assertEqual(len(stages), 6)
        self.assertEqual(stages[0]["id"], "loading")
        self.assertEqual(stages[-1]["id"], "ready")

    def test_gpx_fingerprint_stable(self) -> None:
        payload = b"<gpx><trk></trk></gpx>"
        self.assertEqual(compute_gpx_fingerprint(payload), compute_gpx_fingerprint(payload))
        self.assertEqual(len(compute_gpx_fingerprint(payload)), 16)

    def test_find_local_duplicates(self) -> None:
        gpx = b"<?xml version='1.0'?><gpx><trk/></gpx>"
        race = race_store.create_race(filename="dup.gpx", gpx_bytes=gpx, name="Dup test")
        fingerprint = compute_gpx_fingerprint(gpx)
        matches = find_local_duplicates(fingerprint)
        ids = {match.id for match in matches}
        self.assertIn(race.id, ids)

    def test_bundles_match_identical_checksum(self) -> None:
        bundle = {
            "schemaVersion": 5,
            "race": {"distanceKm": 100.0, "elevationGainM": 2000.0},
            "stops": [{}],
            "climbs": [],
            "unsupportedSections": [],
            "dashboardStats": {"readinessScore": 42, "verifiedStops": 0},
            "bundleChecksum": "abc123",
        }
        ok, mismatches = bundles_match_within_tolerance(bundle, dict(bundle))
        self.assertTrue(ok)
        self.assertEqual(mismatches, [])


if __name__ == "__main__":
    unittest.main()
