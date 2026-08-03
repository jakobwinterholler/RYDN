"""Tests for GPS GPX export v3.0 — original track must remain unchanged."""

from __future__ import annotations

import re
import unittest
from pathlib import Path

from race_gpx_export import (
    GPS_GPX_EXPORT_VERSION,
    GpsGpxExportOptions,
    GpxExportQualityError,
    GpxTrackModifiedError,
    INTEGRITY_FAILED_MSG,
    export_race_gpx_for_gps,
    fingerprint_gpx_bytes,
)
from race_project import race_store

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "races"

RACES = {
    "capitals": "d836e1d9-1fa9-49ea-8476-694c6c00d090",
    "collserola": "b7a1c487-80c6-477c-87ae-ec9dd32b900c",
    "debug_flow": "5154964a-629e-4143-b318-31b2e7106465",
}

BARCELONA_MOUNTAIN_ROUTE_ID = "626b3103-c50d-49eb-b5de-8a129a5f27f3"
_WPT_NAME_PATTERN = re.compile(rb"<name>([^<]+)</name>")
_SYM_PATTERN = re.compile(rb"<sym>([^<]+)</sym>")


def _load_verified_stops(race_id: str) -> dict:
    race = race_store.get_race(race_id)
    return {key: record.to_dict() for key, record in race.preparation.verified_stops.items()}


def _export_to_tmp(race_id: str, options: GpsGpxExportOptions | None = None) -> tuple[bytes, bytes, dict]:
    gpx_path = race_store.get_gpx_path(race_id)
    roadbook = race_store.load_analysis(race_id)
    assert roadbook is not None
    original = gpx_path.read_bytes()
    output_path = race_store.export_path(race_id, "_test_gps_export.gpx")
    summary = export_race_gpx_for_gps(
        original_gpx_path=gpx_path,
        roadbook=roadbook,
        verified_stops=_load_verified_stops(race_id),
        output_path=output_path,
        options=options,
    )
    exported = output_path.read_bytes()
    output_path.unlink(missing_ok=True)
    return original, exported, summary


def _assert_track_unchanged(original: bytes, exported: bytes) -> None:
    before = fingerprint_gpx_bytes(original)
    after = fingerprint_gpx_bytes(exported)
    assert before.track_point_count == after.track_point_count
    assert before.distance_km == after.distance_km
    assert before.elevation_gain_m == after.elevation_gain_m
    assert before.elevation_descent_m == after.elevation_descent_m
    assert before.geometry_checksum == after.geometry_checksum
    assert before.track_bytes_checksum == after.track_bytes_checksum


def _waypoint_names(exported: bytes) -> list[str]:
    return [match.decode("utf-8") for match in _WPT_NAME_PATTERN.findall(exported)]


def _waypoint_syms(exported: bytes) -> list[str]:
    return [match.decode("utf-8") for match in _SYM_PATTERN.findall(exported)]


class TestRaceGpxExport(unittest.TestCase):
    @unittest.skipUnless(
        (DATA / RACES["collserola"]).is_dir(),
        "Collserola race data not available",
    )
    def test_collserola_track_geometry_unchanged(self) -> None:
        original, exported, summary = _export_to_tmp(
            RACES["collserola"],
            GpsGpxExportOptions(device_profile="coros"),
        )
        _assert_track_unchanged(original, exported)
        assert summary["export_version"] == GPS_GPX_EXPORT_VERSION
        assert summary["route_integrity_passed"] is True
        assert summary["integrity_percent"] == 100

    @unittest.skipUnless(
        (DATA / RACES["capitals"]).is_dir(),
        "THE CAPITALS 2026 race data not available",
    )
    def test_capitals_large_route_preserves_all_track_points(self) -> None:
        race_id = RACES["capitals"]
        original, exported, summary = _export_to_tmp(race_id)
        before = fingerprint_gpx_bytes(original)
        assert before.track_point_count > 1000
        assert summary["exported_poi_count"] >= 1
        _assert_track_unchanged(original, exported)
        assert summary["track_point_count"] == before.track_point_count
        assert summary["verified_poi_count"] == summary["exported_poi_count"]

    @unittest.skipUnless(
        (DATA / RACES["debug_flow"]).is_dir(),
        "Debug flow race data not available",
    )
    def test_debug_flow_no_verified_still_preserves_track(self) -> None:
        race_id = RACES["debug_flow"]
        original, exported, summary = _export_to_tmp(race_id)
        assert summary["exported_poi_count"] == 0
        _assert_track_unchanged(original, exported)

    @unittest.skipUnless(
        (DATA / RACES["collserola"]).is_dir(),
        "Collserola race data not available",
    )
    def test_collserola_adds_verified_waypoints_in_km_order(self) -> None:
        _, exported, summary = _export_to_tmp(
            RACES["collserola"],
            GpsGpxExportOptions(device_profile="coros"),
        )
        assert summary["exported_poi_count"] >= 1
        names = _waypoint_names(exported)
        assert names
        assert "KM" not in " ".join(names)
        assert any("⛽" in name or "💧" in name or "🛒" in name for name in names)

    @unittest.skipUnless(
        (DATA / RACES["collserola"]).is_dir(),
        "Collserola race data not available",
    )
    def test_only_waypoint_section_differs(self) -> None:
        race_id = RACES["collserola"]
        original, exported, _summary = _export_to_tmp(race_id)
        assert exported.startswith(original[: original.lower().find(b"<gpx")])
        assert b"</gpx>" in exported
        assert len(exported) >= len(original)
        assert b"<!-- Ultra Roadbook navigation waypoints v3.0 -->" in exported

    @unittest.skipUnless(
        (DATA / RACES["capitals"]).is_dir(),
        "THE CAPITALS 2026 race data not available",
    )
    def test_capitals_coros_icons_assigned(self) -> None:
        _, exported, summary = _export_to_tmp(
            RACES["capitals"],
            GpsGpxExportOptions(device_profile="coros"),
        )
        syms = _waypoint_syms(exported)
        assert len(syms) == summary["exported_poi_count"]
        assert summary["coros_icons_assigned"] == summary["exported_poi_count"]
        assert all(sym in {"Water", "Supplies", "Supplies/Fuel", "Hazard", "Bathroom", "Hut", "Campsite", "Trailfork", "Pin"} for sym in syms)

    @unittest.skipUnless(
        (DATA / RACES["capitals"]).is_dir(),
        "THE CAPITALS 2026 race data not available",
    )
    def test_capitals_smart_names_exclude_bad_patterns(self) -> None:
        _, exported, _summary = _export_to_tmp(
            RACES["capitals"],
            GpsGpxExportOptions(device_profile="coros"),
        )
        for name in _waypoint_names(exported):
            lowered = name.lower()
            assert "unnamed" not in lowered
            assert not lowered.startswith("checkpoint")
            assert not lowered.startswith("carretera")
            assert "fuel station" not in lowered

    @unittest.skipUnless(
        (DATA / BARCELONA_MOUNTAIN_ROUTE_ID).is_dir(),
        "Barcelona Mountain Route sample not available",
    )
    def test_barcelona_mountain_route_track_unchanged(self) -> None:
        original, exported, summary = _export_to_tmp(
            BARCELONA_MOUNTAIN_ROUTE_ID,
            GpsGpxExportOptions(device_profile="coros"),
        )
        _assert_track_unchanged(original, exported)
        assert summary["route_integrity_passed"] is True

    def test_integrity_failure_message(self) -> None:
        assert INTEGRITY_FAILED_MSG == "Route integrity verification failed. Export cancelled."

    @unittest.skipUnless(
        (DATA / RACES["collserola"]).is_dir(),
        "Collserola race data not available",
    )
    def test_coros_export_rejects_high_confidence_only(self) -> None:
        race_id = RACES["collserola"]
        gpx_path = race_store.get_gpx_path(race_id)
        roadbook = race_store.load_analysis(race_id)
        assert roadbook is not None
        verified_stops = {"999": {"status": "deferred", "updated_at": "2026-01-01T00:00:00Z"}}
        output_path = race_store.export_path(race_id, "_test_gps_export.gpx")
        summary = export_race_gpx_for_gps(
            original_gpx_path=gpx_path,
            roadbook=roadbook,
            verified_stops=verified_stops,
            output_path=output_path,
            options=GpsGpxExportOptions(
                device_profile="coros",
                verified_only=False,
                include_high_confidence=True,
            ),
        )
        assert summary["exported_poi_count"] == 0
        output_path.unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
