#!/usr/bin/env python3
"""End-to-end Collserola pipeline diagnostic: GPX → analysis → bundle."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from bundle_checksum import compute_bundle_checksum
from climb_detector import detect_climbs_with_debug
from companion_bundle import build_companion_bundle
from gpx_parser import load_gpx
from pipeline import analyze_race_gpx, roadbook_to_dict
from significant_climbs import significant_climbs
from resupply_zones import build_resupply_zones

RACE_ID = "b7a1c487-80c6-477c-87ae-ec9dd32b900c"


def _find_oilprix(items: list[dict]) -> dict | None:
    for item in items:
        name = str(item.get("name") or "").lower()
        if "oilprix" in name or "oil prix" in name:
            return item
    return None


def _print_stage(title: str, data: dict) -> None:
    print(f"\n=== {title} ===")
    for key, value in data.items():
        print(f"  {key}: {value}")


def main() -> int:
    race_dir = ROOT / "data" / "races" / RACE_ID
    gpx_path = race_dir / "route.gpx"
    analysis_path = race_dir / "analysis" / "latest.json"

    if not gpx_path.is_file():
        print(f"Missing GPX: {gpx_path}", file=sys.stderr)
        return 1

    track = load_gpx(gpx_path)
    _print_stage("1. Original GPX", {
        "trackpoints": len(track),
        "distance_km": round(getattr(track[-1], "km", 0), 2) if track else 0,
    })

    if analysis_path.is_file():
        roadbook = json.loads(analysis_path.read_text(encoding="utf-8"))
        source = "cached analysis.json"
    else:
        roadbook = roadbook_to_dict(analyze_race_gpx(RACE_ID))
        source = "fresh analyze_race_gpx"

    raw_climbs = roadbook.get("climbs") or []
    sig_climbs = significant_climbs(raw_climbs)
    zones = roadbook.get("resupply_zones") or []

    all_pois: list[dict] = []
    primary_stops: list[dict] = []
    for zone in zones:
        zone_id = zone.get("zone_id")
        zone_km = zone.get("distance_along_km")
        for group in zone.get("categories") or []:
            primary = group.get("primary")
            if isinstance(primary, dict):
                primary_stops.append({
                    "zone_id": zone_id,
                    "km": primary.get("distance_along_km", zone_km),
                    "name": primary.get("name"),
                    "osm_id": primary.get("osm_id"),
                    "category": group.get("key"),
                })
                all_pois.append(primary)
            for alt in group.get("alternatives") or []:
                if isinstance(alt, dict):
                    all_pois.append(alt)

    _print_stage(f"2. Desktop analysis ({source})", {
        "raw_climb_count": len(raw_climbs),
        "raw_climb_ids": [c.get("id") for c in raw_climbs],
        "significant_climb_count": len(sig_climbs),
        "significant_climb_ids": [c.get("id") for c in sig_climbs],
        "resupply_zone_count": len(zones),
        "all_poi_count": len(all_pois),
        "primary_stop_count": len(primary_stops),
        "oilprix_in_zones": _find_oilprix(all_pois),
        "oilprix_primary": _find_oilprix(primary_stops),
    })

    bundle = build_companion_bundle(RACE_ID, roadbook, {}, revision=1)
    bundle_stops = bundle.get("stops") or []
    bundle_climbs = bundle.get("climbs") or []

    all_alternatives: list[dict] = []
    for stop in bundle_stops:
        for alt in stop.get("alternatives") or stop.get("nearbyAlternatives") or []:
            if isinstance(alt, dict):
                all_alternatives.append(alt)

    _print_stage("3. Generated companion bundle", {
        "climb_count": len(bundle_climbs),
        "climb_ids": [c.get("id") for c in bundle_climbs],
        "stop_count": len(bundle_stops),
        "stop_names": [s.get("name") for s in bundle_stops],
        "stop_zone_ids": [s.get("zoneId") for s in bundle_stops],
        "alternative_count": len(all_alternatives),
        "oilprix_in_stops": _find_oilprix(bundle_stops),
        "oilprix_in_alternatives": _find_oilprix(all_alternatives),
        "oilprix_anywhere": _find_oilprix(bundle_stops + all_alternatives),
        "bundle_checksum": bundle.get("bundleChecksum", "")[:32] + "…",
        "schema_version": bundle.get("schemaVersion"),
    })

    # Simulate companion UI filters
    show_unverified_map = [s for s in bundle_stops]  # all stops in bundle
    show_unverified_false_map = [
        s for s in bundle_stops
        if s.get("verificationStatus") == "verified"
    ]
    resupply_filter_all = bundle_stops
    resupply_verified_filter = [
        s for s in bundle_stops
        if s.get("verificationStatus") in ("verified", "pending")
    ]

    _print_stage("4. Companion UI simulation", {
        "map_all_stops": len(show_unverified_map),
        "map_verified_only_default": len(show_unverified_false_map),
        "resupply_filter_all": len(resupply_filter_all),
        "resupply_filter_verified": len(resupply_verified_filter),
        "climbs_in_bundle_for_map": len(bundle_climbs),
        "oilprix_visible_map_default": _find_oilprix(show_unverified_false_map),
        "oilprix_visible_map_unverified_on": _find_oilprix(show_unverified_map),
    })

    checksum = compute_bundle_checksum(bundle)
    print(f"\nFull checksum: {checksum}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
