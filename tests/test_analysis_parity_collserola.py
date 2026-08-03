"""Collserola analysis parity: desktop analysis must match companion bundle."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from bundle_checksum import compute_bundle_checksum
from companion_bundle import build_companion_bundle
from race_project import race_store
from significant_climbs import significant_climbs
from suggested_stops import resolve_planning_zones

COLLserola_ID = "b7a1c487-80c6-477c-87ae-ec9dd32b900c"


class CollserolaAnalysisParityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.roadbook = race_store.load_analysis(COLLserola_ID)
        if self.roadbook is None:
            self.skipTest("Collserola analysis not available locally")

    def test_two_significant_climbs_in_analysis(self) -> None:
        sig = significant_climbs(self.roadbook.get("climbs") or [])
        self.assertEqual([c.get("id") for c in sig], ["C001", "C002"])

    def test_oilprix_primary_in_resupply_zones(self) -> None:
        found = False
        for zone in self.roadbook.get("resupply_zones") or []:
            for group in zone.get("categories") or []:
                primary = group.get("primary") or {}
                if "oilprix" in str(primary.get("name") or "").lower():
                    found = True
                    self.assertEqual(zone.get("zone_id"), 4)
        self.assertTrue(found, "Oilprix must be a primary POI in zone 4")

    def test_bundle_exports_two_climbs_and_oilprix(self) -> None:
        race = race_store.get_race(COLLserola_ID)
        with patch("companion_bundle._utc_now", return_value="2026-07-15T12:00:00+00:00"):
            bundle = build_companion_bundle(
                COLLserola_ID,
                self.roadbook,
                race.preparation.to_dict(),
                revision=1,
            )
        climb_ids = [c.get("id") for c in bundle.get("climbs") or []]
        self.assertEqual(climb_ids, ["C001", "C002"])
        planning_zones = resolve_planning_zones(self.roadbook)
        self.assertGreaterEqual(len(planning_zones), 4)
        self.assertEqual(len(bundle.get("stops") or []), len(planning_zones))
        oilprix = [
            stop
            for stop in bundle.get("stops") or []
            if "oilprix" in str(stop.get("name") or "").lower()
        ]
        self.assertEqual(len(oilprix), 1)
        self.assertEqual(oilprix[0].get("zoneId"), 4)
        self.assertAlmostEqual(float(oilprix[0].get("km") or 0), 6.96, places=2)
        self.assertEqual(oilprix[0].get("category"), "Gas station")
        self.assertEqual(oilprix[0].get("osmId"), 287007125)
        self.assertTrue(oilprix[0].get("hasFuel"))
        self.assertEqual(oilprix[0].get("verificationStatus"), "verified")
        self.assertTrue(bundle.get("bundleChecksum"))

    def test_oilprix_km_uses_poi_projection_not_zone_km(self) -> None:
        race = race_store.get_race(COLLserola_ID)
        with patch("companion_bundle._utc_now", return_value="2026-07-15T12:00:00+00:00"):
            bundle = build_companion_bundle(
                COLLserola_ID,
                self.roadbook,
                race.preparation.to_dict(),
                revision=1,
            )
        zone_4 = next(stop for stop in bundle.get("stops") or [] if stop.get("zoneId") == 4)
        zone_km = 7.38
        self.assertNotAlmostEqual(float(zone_4.get("km") or 0), zone_km, places=1)
        self.assertAlmostEqual(float(zone_4.get("km") or 0), 6.96, places=2)
        self.assertEqual(zone_4.get("name"), "Oilprix")

    def test_super_fresco_is_separate_stop_not_oilprix(self) -> None:
        race = race_store.get_race(COLLserola_ID)
        bundle = build_companion_bundle(
            COLLserola_ID,
            self.roadbook,
            race.preparation.to_dict(),
            revision=1,
        )
        fresco = [
            stop
            for stop in bundle.get("stops") or []
            if "super fresco" in str(stop.get("name") or "").lower()
        ]
        if not fresco:
            self.skipTest("Super Fresco is not a suggested stop under v0.3 selection rules")
        self.assertEqual(len(fresco), 1)
        self.assertGreater(float(fresco[0].get("km") or 0), 30.0)
        self.assertNotEqual(fresco[0].get("zoneId"), 4)

    def test_bundle_checksum_stable_for_collserola(self) -> None:
        race = race_store.get_race(COLLserola_ID)
        with patch("companion_bundle._utc_now", return_value="2026-07-15T12:00:00+00:00"):
            bundle = build_companion_bundle(
                COLLserola_ID,
                self.roadbook,
                race.preparation.to_dict(),
                revision=1,
            )
        checksum = compute_bundle_checksum(bundle)
        self.assertEqual(bundle.get("bundleChecksum"), checksum)


if __name__ == "__main__":
    unittest.main()
