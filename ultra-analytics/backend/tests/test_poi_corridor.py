"""Unit tests — corridor spatial filter + cache hit path."""

from __future__ import annotations

import os
import tempfile
import time
import unittest
from unittest import mock

from app.analysis import poi_corridor
from app.analysis.poi_corridor import (
    GridIndex,
    bbox_intersects,
    filter_group,
    normalize_viewport_bbox,
    query_viewport,
    track_fingerprint,
    wrap_longitude,
)
from app.analysis.route_pois import fetch_viewport_pois


def _poi(i, lat, lon, *, cat="Drinking water", group="water", off=50):
    return {
        "id": f"area-node-{i}",
        "osmId": i,
        "osmType": "node",
        "name": f"POI {i}",
        "category": cat,
        "group": group,
        "lat": lat,
        "lon": lon,
        "distanceAlongKm": i * 0.5,
        "distanceOffRouteM": off,
        "is24h": cat == "24h Shop",
        "hasShop": cat in ("24h Shop", "Fuel shop"),
        "googleMapsUrl": f"https://www.google.com/maps/search/?api=1&query={lat},{lon}",
    }


class TestNormalizeViewportBBox(unittest.TestCase):
    def test_unwraps_desktop_world_copy_lng(self):
        s, w, n, e = normalize_viewport_bbox(41.7, 361.78, 41.75, 361.86)
        self.assertAlmostEqual(w, 1.78, places=5)
        self.assertAlmostEqual(e, 1.86, places=5)
        self.assertAlmostEqual(s, 41.7, places=5)
        self.assertAlmostEqual(n, 41.75, places=5)

    def test_principal_mobile_and_desktop_bounds(self):
        s, w, n, e = normalize_viewport_bbox(41.72, 1.80, 41.74, 1.84)
        self.assertAlmostEqual(w, 1.80, places=5)
        self.assertAlmostEqual(e, 1.84, places=5)
        s, w, n, e = normalize_viewport_bbox(41.5, 1.0, 42.0, 2.2)
        self.assertLess(w, e)
        self.assertLess(e - w, 2.5)

    def test_rejects_degenerate_zero_area(self):
        with self.assertRaises(ValueError):
            normalize_viewport_bbox(41.7, 1.8, 41.7, 1.8)

    def test_wrap_longitude(self):
        self.assertAlmostEqual(wrap_longitude(362.1), 2.1, places=8)

    def test_unwrapped_bbox_finds_corridor_poi(self):
        """Regression: desktop ±360 lng must still hit Catalonia POIs."""
        pois = [_poi(1, 41.72, 1.82)]
        grid = GridIndex(pois, cell_deg=0.05)
        s, w, n, e = normalize_viewport_bbox(41.70, 361.78, 41.75, 361.86)
        hit = grid.query_bbox(s, w, n, e)
        self.assertEqual(len(hit), 1)
        # Raw unwrapped query finds nothing — proves why normalize is required.
        self.assertEqual(len(grid.query_bbox(41.70, 361.78, 41.75, 361.86)), 0)


class TestEmptyCachePoison(unittest.TestCase):
    def test_empty_analysis_cache_is_rebuilt(self):
        """Regression: pois=[] must not stick as cache=hit forever."""
        track = [
            [42.0, 1.0, 100, 0.0],
            [42.05, 1.05, 110, 5.0],
            [42.1, 1.1, 120, 10.0],
        ]
        fp = track_fingerprint(track)
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.dict(os.environ, {"ULTRA_DATA_DIR": tmp}):
                poi_corridor._MEMORY.clear()
                root = poi_corridor._cache_root()
                os.makedirs(root, exist_ok=True)
                import hashlib
                import json

                key = f"analysis:{fp}:500"
                path = os.path.join(
                    root, f"{hashlib.sha1(key.encode()).hexdigest()[:16]}.analysis.json"
                )
                with open(path, "w", encoding="utf-8") as f:
                    json.dump({"fingerprint": fp, "pois": [], "sleep": []}, f)

                # Empty corridor shell in memory must not block rebuild.
                poi_corridor.put_memory_corridor(
                    {
                        "schema": poi_corridor.CACHE_SCHEMA,
                        "fingerprint": fp,
                        "bbox": [41.9, 0.9, 42.2, 1.2],
                        "pois": [],
                    }
                )

                fake_elems = [
                    {
                        "type": "node",
                        "id": 99,
                        "lat": 42.04,
                        "lon": 1.04,
                        "tags": {"amenity": "drinking_water", "name": "Font"},
                    }
                ]

                with mock.patch(
                    "app.analysis.route_pois._fetch_elements", return_value=fake_elems
                ):
                    from app.analysis.route_pois import fetch_route_pois

                    bundle = fetch_route_pois(track, force_refresh=False)
                # Analysis pad is 500 m; this fixture POI is farther — corridor still warms.
                self.assertIsNone(bundle.get("error"))
                corridor = poi_corridor.get_memory_corridor(fp)
                self.assertTrue(poi_corridor.corridor_has_pois(corridor))
                # Poisoned empty file must be gone or replaced with complete build.
                if os.path.isfile(path):
                    rebuilt = json.load(open(path, encoding="utf-8"))
                    self.assertTrue(rebuilt.get("complete"))

                res = fetch_viewport_pois(
                    42.0, 1.0, 42.1, 1.1, group="water", track=track, limit=10, allow_overpass=False
                )
                self.assertGreaterEqual(len(res.get("pois") or []), 1)


class TestSpatialFilter(unittest.TestCase):
    def test_grid_bbox_filter(self):
        pois = [
            _poi(1, 42.0, 1.0),
            _poi(2, 42.05, 1.05),
            _poi(3, 43.0, 2.0),  # outside
            _poi(4, 42.02, 1.01, cat="Supermarket", group="resupply"),
        ]
        grid = GridIndex(pois, cell_deg=0.05)
        hit = grid.query_bbox(41.95, 0.95, 42.1, 1.1)
        ids = {p["osmId"] for p in hit}
        self.assertEqual(ids, {1, 2, 4})

    def test_filter_group_primary_only(self):
        pois = [
            _poi(1, 42, 1, cat="Drinking water", group="water"),
            _poi(2, 42, 1, cat="Supermarket", group="resupply"),
            _poi(3, 42, 1, cat="24h Shop", group="resupply"),
            _poi(4, 42, 1, cat="Pharmacy", group="service"),
            _poi(5, 42, 1, cat="Gas station", group="resupply"),
            _poi(6, 42, 1, cat="Hotel", group="sleep"),
            _poi(7, 42, 1, cat="Convenience", group="resupply"),
            _poi(8, 42, 1, cat="Bakery", group="resupply"),
        ]
        self.assertEqual(len(filter_group(pois, "water")), 1)
        # Markets = supermarket + convenience + bakery (snacks), not 24h
        markets = filter_group(pois, "resupply")
        self.assertEqual({p["category"] for p in markets}, {"Supermarket", "Convenience", "Bakery"})
        self.assertEqual(len(filter_group(pois, "fuel")), 1)
        self.assertEqual(len(filter_group(pois, "sleep")), 1)
        # all drops pharmacy + bare gas + 24h (hours checked manually)
        all_g = filter_group(pois, "all")
        cats = {p["category"] for p in all_g}
        self.assertNotIn("Pharmacy", cats)
        self.assertNotIn("Gas station", cats)
        self.assertNotIn("24h Shop", cats)
        self.assertIn("Bakery", cats)

    def test_query_viewport_cache_hit_fast(self):
        pois = [_poi(i, 42.0 + i * 0.001, 1.0 + i * 0.001) for i in range(200)]
        corridor = {
            "schema": 2,
            "fingerprint": "test",
            "bbox": [41.0, 0.0, 43.0, 2.0],
            "pois": pois,
        }
        t0 = time.perf_counter()
        res = query_viewport(
            corridor,
            south=41.95,
            west=0.95,
            north=42.15,
            east=1.15,
            group="water",
            limit=12,
        )
        ms = (time.perf_counter() - t0) * 1000
        self.assertEqual(res["cache"], "corridor-hit")
        self.assertLessEqual(len(res["pois"]), 12)
        self.assertGreater(len(res["pois"]), 0)
        self.assertLess(ms, 200, f"spatial query too slow: {ms:.1f}ms")
        self.assertIsNotNone(res["timings"]["spatialFilterMs"])

    def test_bbox_intersects(self):
        self.assertTrue(bbox_intersects((0, 0, 1, 1), (0.5, 0.5, 1.5, 1.5)))
        self.assertFalse(bbox_intersects((0, 0, 1, 1), (2, 2, 3, 3)))

    def test_track_fingerprint_stable(self):
        track = [[42.0, 1.0, 100, 0.0], [42.1, 1.1, 110, 10.0], [42.2, 1.2, 120, 20.0]]
        self.assertEqual(track_fingerprint(track), track_fingerprint(track))


class TestViewportUsesCorridor(unittest.TestCase):
    def test_fetch_viewport_corridor_hit_no_overpass(self):
        track = [
            [42.0, 1.0, 100, 0.0],
            [42.05, 1.05, 110, 5.0],
            [42.1, 1.1, 120, 10.0],
        ]
        fp = track_fingerprint(track)
        pois = [
            _poi(10, 42.04, 1.04, cat="Drinking water", group="water"),
            _poi(11, 42.05, 1.05, cat="Convenience", group="resupply"),
            _poi(12, 42.06, 1.06, cat="24h Shop", group="resupply"),
        ]
        data = {
            "schema": poi_corridor.CACHE_SCHEMA,
            "fingerprint": fp,
            "corridorPadM": 3000,
            "bbox": [41.9, 0.9, 42.2, 1.2],
            "pois": pois,
        }
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.dict(os.environ, {"ULTRA_DATA_DIR": tmp}):
                poi_corridor._MEMORY.clear()
                poi_corridor.save_corridor_cache(data)
                poi_corridor.put_memory_corridor(data)
                t0 = time.perf_counter()
                res = fetch_viewport_pois(
                    42.0,
                    1.0,
                    42.1,
                    1.1,
                    group="water",
                    track=track,
                    limit=10,
                    allow_overpass=False,
                )
                ms = (time.perf_counter() - t0) * 1000
        self.assertEqual(res["cache"], "corridor-hit")
        self.assertEqual(len(res["pois"]), 1)
        self.assertEqual(res["pois"][0]["category"], "Drinking water")
        self.assertLess(ms, 500, f"cached search too slow: {ms:.1f}ms")
        self.assertIsNone(res["timings"].get("overpassMs"))

    def test_analysis_hydrate_when_corridor_missing(self):
        """Prod cold: Search corridor empty, analysis POIs exist → hydrate, no Overpass."""
        track = [
            [42.0, 1.0, 100, 0.0],
            [42.05, 1.05, 110, 5.0],
            [42.1, 1.1, 120, 10.0],
        ]
        fp = track_fingerprint(track)
        analysis_pois = [
            _poi(20, 42.04, 1.04, cat="Drinking water", group="water", off=80),
            _poi(21, 42.05, 1.05, cat="Supermarket", group="resupply", off=120),
            _poi(22, 42.06, 1.06, cat="Convenience", group="resupply", off=90),
        ]
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.dict(os.environ, {"ULTRA_DATA_DIR": tmp}):
                poi_corridor._MEMORY.clear()
                root = poi_corridor._cache_root()
                os.makedirs(root, exist_ok=True)
                import hashlib
                import json

                key = f"analysis:{fp}:500"
                path = os.path.join(
                    root, f"{hashlib.sha1(key.encode()).hexdigest()[:16]}.analysis.json"
                )
                with open(path, "w", encoding="utf-8") as f:
                    json.dump({"fingerprint": fp, "pois": analysis_pois, "sleep": []}, f)

                # No Search corridor on disk — first Search must hydrate from analysis.
                t0 = time.perf_counter()
                water = fetch_viewport_pois(
                    42.0, 1.0, 42.1, 1.1, group="water", track=track, limit=10, allow_overpass=False
                )
                first_ms = (time.perf_counter() - t0) * 1000
                markets = fetch_viewport_pois(
                    42.0,
                    1.0,
                    42.1,
                    1.1,
                    group="resupply",
                    track=track,
                    limit=10,
                    allow_overpass=False,
                )

        self.assertEqual(water["cache"], "analysis-hydrate")
        self.assertGreaterEqual(len(water["pois"]), 1)
        # Second call may be corridor-hit (hydrate persisted) — both are success.
        self.assertIn(markets["cache"], ("analysis-hydrate", "corridor-hit"))
        self.assertGreaterEqual(len(markets["pois"]), 1)
        self.assertLess(first_ms, 2000, f"hydrated search too slow: {first_ms:.1f}ms")


if __name__ == "__main__":
    unittest.main()
