"""Tests for bundle validation before upload."""

from __future__ import annotations

import unittest

from bundle_validate import diagnose_companion_bundle, validate_companion_bundle
from bundle_contract import apply_bundle_version_fields
from bundle_checksum import compute_bundle_checksum


class BundleValidateTests(unittest.TestCase):
    def _minimal_bundle(self) -> dict:
        bundle = apply_bundle_version_fields(
            {
                "revision": 1,
                "generatedAt": "2026-07-15T10:00:00+00:00",
                "exportedAt": "2026-07-15T10:00:00+00:00",
                "race": {
                    "id": "race-1",
                    "name": "Test",
                    "distanceKm": 40.0,
                    "elevationGainM": 700.0,
                },
                "route": {
                    "coordinates": [[2.1, 41.4], [2.2, 41.5]],
                    "bounds": {"south": 41.4, "west": 2.1, "north": 41.5, "east": 2.2},
                },
                "stops": [
                    {
                        "zoneId": 1,
                        "poiId": "poi_1",
                        "km": 7.0,
                        "lat": 41.41,
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
                "climbs": [],
                "unsupportedSections": [],
            }
        )
        bundle["bundleChecksum"] = compute_bundle_checksum(bundle)
        return bundle

    def test_valid_bundle_passes(self) -> None:
        bundle = self._minimal_bundle()
        valid, errors = validate_companion_bundle(bundle)
        self.assertTrue(valid, errors)

    def test_legacy_bundle_without_checksum_fails(self) -> None:
        bundle = self._minimal_bundle()
        del bundle["bundleChecksum"]
        bundle["schemaVersion"] = 4
        errors = diagnose_companion_bundle(bundle)
        self.assertIn('Missing field "bundleChecksum"', errors)


if __name__ == "__main__":
    unittest.main()
