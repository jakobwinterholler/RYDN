"""Tests for legacy companion bundle migration expectations."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class LegacyBundleShapeTests(unittest.TestCase):
    def test_schema_v4_sample_is_missing_checksum(self) -> None:
        """Document the root cause: pre-v0.1.15 bundles lack bundleChecksum."""
        legacy = {
            "schemaVersion": 4,
            "revision": 2,
            "exportedAt": "2026-07-01T10:00:00+00:00",
            "race": {
                "id": "race-1",
                "name": "Collserola",
                "distanceKm": 39.0,
                "elevationGainM": 700,
            },
            "route": {
                "coordinates": [[2.1, 41.4], [2.2, 41.5]],
                "bounds": {"south": 41.4, "west": 2.1, "north": 41.5, "east": 2.2},
            },
            "stops": [
                {
                    "zoneId": 4,
                    "km": 7.4,
                    "lat": 41.42,
                    "lon": 2.15,
                    "name": "Oilprix",
                    "category": "fuel",
                    "categoryLabel": "Fuel",
                    "icon": "⛽",
                    "verificationStatus": "verified",
                    "openingHours": None,
                    "notes": None,
                }
            ],
            "unsupportedSections": [],
            "climbs": [],
        }
        self.assertNotIn("bundleChecksum", legacy)
        self.assertLess(legacy["schemaVersion"], 5)
        # Old isCompanionBundle() guard rejected this before migration could run.
        encoded = json.dumps(legacy, separators=(",", ":"))
        self.assertIn("Oilprix", encoded)


if __name__ == "__main__":
    unittest.main()
