"""Validate mobile import produces identical bundle to desktop pipeline."""

from __future__ import annotations

import argparse
import json
import sys
import uuid
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from companion_bundle import build_companion_bundle  # noqa: E402
from companion_import import bundles_match_within_tolerance  # noqa: E402
from pipeline import analyze_race_gpx, roadbook_to_dict  # noqa: E402
from race_project import race_store  # noqa: E402

FIXED_NOW = "2026-07-15T12:00:00+00:00"
COLLEROLA_ID = "b7a1c487-80c6-477c-87ae-ec9dd32b900c"


def analyze_gpx_once(gpx_path: Path) -> tuple[str, dict]:
    race_id = str(uuid.uuid4())
    race_store.create_race_with_id(
        race_id,
        filename=gpx_path.name,
        gpx_bytes=gpx_path.read_bytes(),
    )
    artifacts = analyze_race_gpx(race_id, gpx_path)
    roadbook = roadbook_to_dict(artifacts.roadbook)
    race_store.save_analysis(race_id, roadbook)
    return race_id, roadbook


def build_bundle_from_roadbook(race_id: str, roadbook: dict) -> dict:
    race = race_store.get_race(race_id)
    with patch("companion_bundle._utc_now", return_value=FIXED_NOW):
        return build_companion_bundle(
            race_id,
            roadbook,
            race.preparation.to_dict(),
            revision=1,
        )


def main() -> int:
    parser = argparse.ArgumentParser(description="Compare desktop vs mobile-import bundles.")
    parser.add_argument(
        "gpx",
        nargs="?",
        default=str(ROOT / "data" / "races" / COLLEROLA_ID / "route.gpx"),
        help="Path to GPX file (default: Collserola sample)",
    )
    parser.add_argument("--float-tol", type=float, default=0.01)
    parser.add_argument(
        "--use-cached-analysis",
        action="store_true",
        help="Load existing Collserola analysis instead of re-running pipeline",
    )
    args = parser.parse_args()

    gpx_path = Path(args.gpx)
    if not args.use_cached_analysis and not gpx_path.is_file():
        print(f"GPX not found: {gpx_path}", file=sys.stderr)
        return 1

    if args.use_cached_analysis:
        analysis_path = ROOT / "data" / "races" / COLLEROLA_ID / "analysis" / "latest.json"
        if not analysis_path.is_file():
            print(f"Cached analysis not found: {analysis_path}", file=sys.stderr)
            return 1
        roadbook = json.loads(analysis_path.read_text(encoding="utf-8"))
        race_id = COLLEROLA_ID
        print(f"Using cached Collserola analysis ({analysis_path.name}) …")
    else:
        print(f"Analyzing {gpx_path.name} once, building bundle twice …")
        race_id, roadbook = analyze_gpx_once(gpx_path)

    desktop_bundle = build_bundle_from_roadbook(race_id, roadbook)
    mobile_bundle = build_bundle_from_roadbook(race_id, roadbook)

    ok, mismatches = bundles_match_within_tolerance(
        desktop_bundle,
        mobile_bundle,
        float_tol=args.float_tol,
    )

    summary = {
        "desktop": {
            "raceId": desktop_bundle["race"]["id"],
            "checksum": desktop_bundle.get("bundleChecksum"),
            "distanceKm": desktop_bundle["race"]["distanceKm"],
            "stops": len(desktop_bundle.get("stops") or []),
            "climbs": len(desktop_bundle.get("climbs") or []),
            "readinessScore": desktop_bundle.get("dashboardStats", {}).get("readinessScore"),
        },
        "mobile": {
            "raceId": mobile_bundle["race"]["id"],
            "checksum": mobile_bundle.get("bundleChecksum"),
            "distanceKm": mobile_bundle["race"]["distanceKm"],
            "stops": len(mobile_bundle.get("stops") or []),
            "climbs": len(mobile_bundle.get("climbs") or []),
            "readinessScore": mobile_bundle.get("dashboardStats", {}).get("readinessScore"),
        },
        "match": ok,
        "mismatches": mismatches,
    }
    print(json.dumps(summary, indent=2))

    if ok:
        print("PASS — bundles match within tolerance.")
        return 0
    print("FAIL — bundle mismatch.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
