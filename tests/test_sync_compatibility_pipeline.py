"""
End-to-end sync compatibility: Desktop bundle generation → upload shape → migration readiness.

Mirrors the Companion self-healing pipeline in Python. TypeScript migration is tested at build
time via companion prebuild (unittest suite).
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path
from unittest.mock import patch

from bundle_checksum import compute_bundle_checksum
from bundle_contract import CURRENT_SCHEMA_VERSION, apply_bundle_version_fields
from bundle_validate import validate_companion_bundle
from companion_bundle import build_companion_bundle

ROOT = Path(__file__).resolve().parent.parent
COLLserola_ID = "b7a1c487-80c6-477c-87ae-ec9dd32b900c"


def _load_collserola_roadbook() -> dict | None:
    analysis_path = ROOT / "data" / "races" / COLLserola_ID / "analysis.json"
    if not analysis_path.is_file():
        return None
    return json.loads(analysis_path.read_text(encoding="utf-8"))


class SyncCompatibilityPipelineTests(unittest.TestCase):
    def test_desktop_bundle_generation_validates(self) -> None:
        roadbook = _load_collserola_roadbook()
        if roadbook is None:
            self.skipTest("Collserola analysis.json not present locally")

        with patch("companion_bundle._utc_now", return_value="2026-07-15T12:00:00+00:00"):
            bundle = build_companion_bundle(COLLserola_ID, roadbook, {}, revision=3)

        valid, errors = validate_companion_bundle(bundle)
        self.assertTrue(valid, errors)
        self.assertEqual(bundle["schemaVersion"], CURRENT_SCHEMA_VERSION)
        self.assertIn("bundleVersion", bundle)
        self.assertIn("minimumCompanionVersion", bundle)

    def test_upload_roundtrip_preserves_checksum(self) -> None:
        roadbook = _load_collserola_roadbook()
        if roadbook is None:
            self.skipTest("Collserola analysis.json not present locally")

        with patch("companion_bundle._utc_now", return_value="2026-07-15T12:00:00+00:00"):
            bundle = build_companion_bundle(COLLserola_ID, roadbook, {}, revision=1)

        uploaded = json.loads(json.dumps(bundle, separators=(",", ":")))
        self.assertEqual(
            uploaded.get("bundleChecksum"),
            compute_bundle_checksum(uploaded),
        )

    def test_legacy_cloud_bundle_is_detected_as_invalid_before_migration(self) -> None:
        roadbook = _load_collserola_roadbook()
        if roadbook is None:
            self.skipTest("Collserola analysis.json not present locally")

        with patch("companion_bundle._utc_now", return_value="2026-07-15T12:00:00+00:00"):
            bundle = build_companion_bundle(COLLserola_ID, roadbook, {}, revision=1)

        legacy = dict(bundle)
        legacy["schemaVersion"] = 4
        del legacy["bundleChecksum"]
        del legacy["bundleVersion"]
        del legacy["minimumCompanionVersion"]
        del legacy["minimumDesktopVersion"]

        valid, errors = validate_companion_bundle(legacy)
        self.assertFalse(valid)
        self.assertTrue(any("bundleChecksum" in error for error in errors))

    def test_migrated_shape_matches_current_contract(self) -> None:
        """Simulate post-migration bundle (what Companion produces after prepareCompanionBundle)."""
        roadbook = _load_collserola_roadbook()
        if roadbook is None:
            self.skipTest("Collserola analysis.json not present locally")

        with patch("companion_bundle._utc_now", return_value="2026-07-15T12:00:00+00:00"):
            bundle = build_companion_bundle(COLLserola_ID, roadbook, {}, revision=1)

        legacy = dict(bundle)
        legacy["schemaVersion"] = 4
        del legacy["bundleChecksum"]
        del legacy["bundleVersion"]

        healed = apply_bundle_version_fields(legacy)
        healed["schemaVersion"] = CURRENT_SCHEMA_VERSION
        healed["bundleChecksum"] = compute_bundle_checksum(healed)

        valid, errors = validate_companion_bundle(healed)
        self.assertTrue(valid, errors)


if __name__ == "__main__":
    unittest.main()
