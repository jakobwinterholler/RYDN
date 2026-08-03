#!/usr/bin/env python3
"""Full Collserola POI trace: OSM → analysis → bundle → companion render simulation."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from bundle_checksum import compute_bundle_checksum
from companion_bundle import build_companion_bundle
from race_project import race_store
from significant_climbs import significant_climbs

RACE_ID = "b7a1c487-80c6-477c-87ae-ec9dd32b900c"
OILPRIX_OSM = 287007125


def _role(zone: dict, poi: dict) -> str:
    for group in zone.get("categories") or []:
        primary = group.get("primary")
        if isinstance(primary, dict) and primary.get("osm_id") == poi.get("osm_id"):
            return "primary"
        for alt in group.get("alternatives") or []:
            if isinstance(alt, dict) and alt.get("osm_id") == poi.get("osm_id"):
                return "alternative"
    return "detected"


def _print_row(stage: str, fields: dict) -> None:
    print(
        f"{stage:22} | "
        f"osm={fields.get('osm_id','-'):>10} | "
        f"poi={str(fields.get('poi_id','-')):>16} | "
        f"name={str(fields.get('name','-')):>22} | "
        f"cat={str(fields.get('category','-')):>18} | "
        f"km={fields.get('km','-'):>6} | "
        f"role={fields.get('role','-'):>11}"
    )


def main() -> int:
    roadbook = race_store.load_analysis(RACE_ID)
    if roadbook is None:
        print("Missing analysis", file=sys.stderr)
        return 1
    race = race_store.get_race(RACE_ID)
    bundle = build_companion_bundle(
        RACE_ID,
        roadbook,
        race.preparation.to_dict(),
        revision=1,
    )

    print("=== PIPELINE SUMMARY ===")
    sig = significant_climbs(roadbook.get("climbs") or [])
    print(f"Climbs (significant): {[c.get('id') for c in sig]}")
    print(f"Bundle climbs: {[c.get('id') for c in bundle.get('climbs') or []]}")
    print(f"Bundle stops: {len(bundle.get('stops') or [])}")
    print(f"Bundle checksum: {bundle.get('bundleChecksum')}")
    print(f"Route km: {(bundle.get('race') or {}).get('distanceKm')}")
    print()

    print("=== OILPRIX + SUPER FRESCO TRACE ===")
    print(f"{'stage':22} | {'osm':>10} | {'poiId':>16} | {'name':>22} | {'category':>18} | {'km':>6} | {'role':>11}")
    print("-" * 120)

    targets = {"oilprix", "super fresco"}
    for zone in roadbook.get("resupply_zones") or []:
        for group in zone.get("categories") or []:
            for key in ("primary", "alternatives"):
                items = group.get(key) if key == "primary" else (group.get(key) or [])
                if key == "primary":
                    items = [items] if items else []
                for poi in items:
                    if not isinstance(poi, dict):
                        continue
                    name = str(poi.get("name") or "").lower()
                    if not any(token in name for token in targets):
                        continue
                    _print_row(
                        "analysis",
                        {
                            "osm_id": poi.get("osm_id"),
                            "poi_id": f"poi_{poi.get('osm_id')}",
                            "name": poi.get("name"),
                            "category": poi.get("poi_category"),
                            "km": poi.get("distance_along_km"),
                            "role": _role(zone, poi),
                        },
                    )

    for stop in bundle.get("stops") or []:
        name = str(stop.get("name") or "").lower()
        if any(token in name for token in targets):
            _print_row(
                "bundle_primary",
                {
                    "osm_id": stop.get("osmId"),
                    "poi_id": stop.get("poiId"),
                    "name": stop.get("name"),
                    "category": stop.get("category"),
                    "km": stop.get("km"),
                    "role": "primary",
                },
            )
        for alt in stop.get("alternatives") or []:
            alt_name = str(alt.get("name") or "").lower()
            if any(token in alt_name for token in targets):
                _print_row(
                    "bundle_alternative",
                    {
                        "osm_id": alt.get("osmId"),
                        "poi_id": alt.get("poiId"),
                        "name": alt.get("name"),
                        "category": alt.get("category"),
                        "km": alt.get("distanceAlongKm"),
                        "role": "alternative",
                    },
                )

    # Companion render simulation (mirrors collectAllBundlePois)
    for stop in bundle.get("stops") or []:
        rendered = [stop]
        for alt in stop.get("alternatives") or []:
            rendered.append(
                {
                    **stop,
                    "poiId": alt.get("poiId"),
                    "osmId": alt.get("osmId"),
                    "name": alt.get("name"),
                    "category": alt.get("category"),
                    "km": alt.get("distanceAlongKm", stop.get("km")),
                    "lat": alt.get("lat"),
                    "lon": alt.get("lon"),
                }
            )
        for item in rendered:
            name = str(item.get("name") or "").lower()
            if any(token in name for token in targets):
                _print_row(
                    "companion_render",
                    {
                        "osm_id": item.get("osmId"),
                        "poi_id": item.get("poiId"),
                        "name": item.get("name"),
                        "category": item.get("category"),
                        "km": item.get("km"),
                        "role": "flattened",
                    },
                )

    oilprix = next(
        (
            stop
            for stop in bundle.get("stops") or []
            if stop.get("osmId") == OILPRIX_OSM
        ),
        None,
    )
    print()
    print("=== EXPECTED OILPRIX ===")
    if oilprix:
        print(json.dumps(
            {
                "name": oilprix.get("name"),
                "category": oilprix.get("category"),
                "km": oilprix.get("km"),
                "poiId": oilprix.get("poiId"),
                "osmId": oilprix.get("osmId"),
                "hasFuel": oilprix.get("hasFuel"),
                "hasWater": oilprix.get("hasWater"),
            },
            indent=2,
        ))
    else:
        print("MISSING")
        return 1

    checksum = compute_bundle_checksum(bundle)
    if checksum != bundle.get("bundleChecksum"):
        print("Checksum mismatch!", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
