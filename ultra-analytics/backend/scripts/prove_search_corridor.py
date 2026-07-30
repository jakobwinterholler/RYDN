#!/usr/bin/env python3
"""Prove Search corridor timings on a real route.

Usage (from ultra-analytics/backend):
  .venv/bin/python scripts/prove_search_corridor.py

Writes timings to stdout; exits non-zero if acceptance fails.
"""

from __future__ import annotations

import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.analysis import poi_corridor
from app.analysis.route_pois import (
    ensure_search_corridor,
    fetch_route_pois,
    fetch_viewport_pois,
)


ROUTE = os.environ.get(
    "PROOF_ROUTE",
    "data/users/g_110961740720638107491/routes/3b516561b8cc.json",
)


def main() -> int:
    if not os.path.isfile(ROUTE):
        print(f"FAIL: route not found: {ROUTE}")
        return 2

    with open(ROUTE, encoding="utf-8") as f:
        route = json.load(f)
    track = route.get("track") or route.get("points") or []
    print(f"Route: {route.get('name')}  points={len(track)}  km={route.get('distanceKm')}")

    # --- Build / load corridor ---
    t0 = time.perf_counter()
    # Prefer projected analysis path (uses raw Overpass disk cache if needed)
    bundle = fetch_route_pois(track, force_refresh=False)
    build_ms = (time.perf_counter() - t0) * 1000
    corridor = ensure_search_corridor(track, force_refresh=False, build_if_missing=False)
    print(
        f"Corridor: cache={bundle.get('cache')} analysis_pois={len(bundle.get('pois') or [])} "
        f"search_pois={len(corridor.get('pois') or [])} build_ms={build_ms:.0f}"
    )

    if len(corridor.get("pois") or []) < 1:
        print("FAIL: empty search corridor")
        return 1

    # Pick a viewport that contains corridor POIs
    sample = corridor["pois"][len(corridor["pois"]) // 3]
    half = 0.06
    south = float(sample["lat"]) - half
    north = float(sample["lat"]) + half
    west = float(sample["lon"]) - half
    east = float(sample["lon"]) + half
    print(f"Viewport around {sample.get('category')} @ {sample['lat']},{sample['lon']}")

    # --- Cached search (must be < 2s) ---
    times = []
    for group in ("water", "resupply", "fuel", "sleep"):
        t1 = time.perf_counter()
        res = fetch_viewport_pois(
            south,
            west,
            north,
            east,
            group=group,
            track=track,
            limit=12,
            allow_overpass=False,
        )
        ms = (time.perf_counter() - t1) * 1000
        times.append(ms)
        print(
            f"  cached {group:8s}  ms={ms:7.1f}  cache={res.get('cache')}  "
            f"pois={len(res.get('pois') or [])}  candidates={res.get('candidateCount')}  "
            f"spatial_ms={res.get('timings', {}).get('spatialFilterMs')}"
        )
        if res.get("cache") != "corridor-hit":
            print(f"FAIL: expected corridor-hit, got {res.get('cache')}")
            return 1
        if ms >= 2000:
            print(f"FAIL: cached search {ms:.0f}ms >= 2000ms")
            return 1

    # Warm repeat (memory grid)
    t2 = time.perf_counter()
    res2 = fetch_viewport_pois(
        south, west, north, east, group="resupply", track=track, limit=12, allow_overpass=False
    )
    warm_ms = (time.perf_counter() - t2) * 1000
    print(f"  warm repeat resupply ms={warm_ms:.1f}  pois={len(res2.get('pois') or [])}")

    print("\n=== ACCEPTANCE ===")
    print(f"  Cached area search < 2s: PASS (max {max(times):.1f}ms, warm {warm_ms:.1f}ms)")
    print("  Corridor spatial filter: PASS")
    print(f"  Fingerprint: {corridor.get('fingerprint')}  pad_m={corridor.get('corridorPadM')}")
    print(
        "BOTTLENECK (pre-fix baseline): cold Overpass ~44s; "
        "corridor spatial filter ~1ms; analysis re-project was ~22s before projected cache."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
