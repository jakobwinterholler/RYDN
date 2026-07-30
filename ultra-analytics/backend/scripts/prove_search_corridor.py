#!/usr/bin/env python3
"""Prove Search corridor timings + non-zero Water/Markets on a real route.

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

from app.analysis.route_pois import (
    ensure_search_corridor,
    fetch_route_pois,
    fetch_viewport_pois,
)


ROUTE = os.environ.get(
    "PROOF_ROUTE",
    "data/users/g_110961740720638107491/routes/3b516561b8cc.json",
)

# Manresa / Catalonia — known zoomed town on the Bikepacking ultra.
MANRESA_BBOX = (41.70, 1.78, 41.75, 1.86)  # S, W, N, E

# Frontend search corridor for temp finds (must stay in sync with planLayers.ts).
SEARCH_CORRIDOR_MAX_M = 3000


def _visible_after_ui(pois: list, group: str) -> list:
    """Simulate frontend markerVisible corridor for temp Search finds."""
    max_m = 1500 if group == "sleep" else SEARCH_CORRIDOR_MAX_M
    return [p for p in pois if float(p.get("distanceOffRouteM") or 0) <= max_m]


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

    # --- Manresa town acceptance (Water + Markets must return 1–15 visible) ---
    ms_s, ms_w, ms_n, ms_e = MANRESA_BBOX
    print(f"\nManresa bbox {MANRESA_BBOX}")
    for group, label in (("water", "Water"), ("resupply", "Markets")):
        t3 = time.perf_counter()
        res = fetch_viewport_pois(
            ms_s,
            ms_w,
            ms_n,
            ms_e,
            group=group,
            track=track,
            limit=12,
            allow_overpass=False,
        )
        ms = (time.perf_counter() - t3) * 1000
        pois = res.get("pois") or []
        visible = _visible_after_ui(pois, group)
        print(
            f"  {label:8s}  ms={ms:7.1f}  cache={res.get('cache')}  "
            f"api={len(pois)}  ui_visible={len(visible)}  "
            f"candidates={res.get('candidateCount')}  "
            f"offs={[round(p.get('distanceOffRouteM') or 0) for p in pois[:8]]}"
        )
        if res.get("cache") not in ("corridor-hit", "analysis-hydrate"):
            print(f"FAIL: Manresa {label} expected corridor-hit/analysis-hydrate")
            return 1
        if ms >= 2000:
            print(f"FAIL: Manresa {label} {ms:.0f}ms >= 2000ms")
            return 1
        if not (1 <= len(visible) <= 15):
            print(
                f"FAIL: Manresa {label} ui_visible={len(visible)} "
                f"(need 1–15 after search-corridor filter)"
            )
            return 1

    # --- Cold-prod simulation: Search corridor gone, analysis cache remains ---
    import shutil
    from app.analysis import poi_corridor

    fp = corridor.get("fingerprint")
    cache_path = os.path.join(poi_corridor._cache_root(), f"{fp}.json")
    bak = cache_path + ".proof_bak"
    had_corridor = os.path.isfile(cache_path)
    if had_corridor:
        shutil.move(cache_path, bak)
    poi_corridor._MEMORY.clear()
    print(f"\nCold-prod sim (corridor removed, analysis present) fp={fp}")
    cold_ok = True
    saw_hydrate = False
    try:
        for group, label in (("water", "Water"), ("resupply", "Markets")):
            t4 = time.perf_counter()
            res = fetch_viewport_pois(
                ms_s,
                ms_w,
                ms_n,
                ms_e,
                group=group,
                track=track,
                limit=12,
                allow_overpass=False,
            )
            ms = (time.perf_counter() - t4) * 1000
            pois = res.get("pois") or []
            visible = _visible_after_ui(pois, group)
            print(
                f"  COLD {label:8s}  ms={ms:7.1f}  cache={res.get('cache')}  "
                f"api={len(pois)}  ui_visible={len(visible)}"
            )
            if res.get("cache") == "analysis-hydrate":
                saw_hydrate = True
            if res.get("cache") not in ("analysis-hydrate", "corridor-hit"):
                print(
                    f"FAIL: cold {label} expected analysis-hydrate|corridor-hit, "
                    f"got {res.get('cache')}"
                )
                cold_ok = False
            if ms >= 2000:
                print(f"FAIL: cold {label} {ms:.0f}ms >= 2000ms")
                cold_ok = False
            if len(visible) < 1:
                print(f"FAIL: cold {label} ui_visible={len(visible)}")
                cold_ok = False
        if not saw_hydrate:
            print("FAIL: cold sim never hit analysis-hydrate")
            cold_ok = False
    finally:
        poi_corridor._MEMORY.clear()
        if had_corridor and os.path.isfile(bak):
            # Remove any hydrate-written corridor so we restore the original golden cache
            if os.path.isfile(cache_path):
                os.remove(cache_path)
            shutil.move(bak, cache_path)

    if not cold_ok:
        return 1

    # --- Rural sparse water must still surface when API has hits >500m ---
    # km ~562 on Bikepacking: water offs are all >500m under old UI filter.
    target_km = 562.0
    best = min(track, key=lambda r: abs((r[3] if len(r) > 3 else 0) - target_km))
    half = 0.04
    s, w = float(best[0]) - half, float(best[1]) - half
    n, e = float(best[0]) + half, float(best[1]) + half
    res562 = fetch_viewport_pois(s, w, n, e, group="water", track=track, limit=12, allow_overpass=False)
    pois562 = res562.get("pois") or []
    vis562 = _visible_after_ui(pois562, "water")
    old500 = [p for p in pois562 if float(p.get("distanceOffRouteM") or 0) <= 500]
    print(
        f"\nkm562 water: api={len(pois562)} old500_ui={len(old500)} "
        f"search_ui={len(vis562)} offs={[round(p.get('distanceOffRouteM') or 0) for p in pois562]}"
    )
    if pois562 and not vis562:
        print("FAIL: km562 water API hits hidden by search corridor filter")
        return 1
    if pois562 and not old500 and vis562:
        print("  (regression guard) old 500m UI would have shown 0; search corridor shows >0 — PASS")

    print("\n=== ACCEPTANCE ===")
    print(f"  Cached area search < 2s: PASS (max {max(times):.1f}ms, warm {warm_ms:.1f}ms)")
    print("  Manresa Water/Markets 1–15 visible: PASS")
    print("  Cold-prod analysis-hydrate Water/Markets: PASS")
    print("  Corridor spatial filter: PASS")
    print(f"  Fingerprint: {corridor.get('fingerprint')}  pad_m={corridor.get('corridorPadM')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
