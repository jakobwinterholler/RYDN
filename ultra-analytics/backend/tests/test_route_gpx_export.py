"""Planned-route GPX export — verified water/shop/hotel, plain names, Garmin syms."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
import xml.etree.ElementTree as ET
from unittest import mock

from app import routes_store
from app.parsing.route_gpx_export import (
    NAME_HOTEL,
    NAME_SHOP,
    NAME_WATER,
    SYM_HOTEL,
    SYM_SHOP,
    SYM_WATER,
    build_export_gpx,
    filter_export_waypoints,
    merge_verified_stops,
)


NS = {"g": "http://www.topografix.com/GPX/1/1"}

SAMPLE_GPX = """<?xml version="1.0"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1">
  <trk><name>Course</name><trkseg>
    <trkpt lat="42.3000000" lon="3.2000000"><ele>10</ele></trkpt>
    <trkpt lat="42.4000000" lon="3.3000000"><ele>40</ele></trkpt>
    <trkpt lat="42.5000000" lon="3.4000000"><ele>20</ele></trkpt>
  </trkseg></trk>
</gpx>
"""


def _stop(**kwargs):
    base = {
        "id": "s1",
        "lat": 42.31,
        "lon": 3.21,
        "category": "Drinking water",
        "group": "water",
        "reviewStatus": "verified",
        "distanceAlongKm": 1.0,
        "name": "Fountain",
    }
    base.update(kwargs)
    return base


class FilterExportWaypointsTests(unittest.TestCase):
    def test_includes_verified_water_shop_and_hotel(self) -> None:
        stops = [
            _stop(id="w1", category="Drinking water", group="water"),
            _stop(id="w2", category="Water tap", group="water", lat=42.32, lon=3.22),
            _stop(
                id="m1",
                category="Supermarket",
                group="resupply",
                lat=42.33,
                lon=3.23,
                distanceAlongKm=2,
            ),
            _stop(
                id="m2",
                category="Convenience",
                group="resupply",
                lat=42.34,
                lon=3.24,
                distanceAlongKm=3,
            ),
            _stop(
                id="m3",
                category="Bakery",
                group="resupply",
                lat=42.35,
                lon=3.25,
                distanceAlongKm=4,
            ),
            _stop(id="sleep", category="Hotel", group="sleep", lat=42.36, lon=3.26, distanceAlongKm=5),
            # Exclusions
            _stop(id="cafe", category="Café", group="dining", lat=42.37, lon=3.27),
            _stop(id="bike", category="Bike shop", group="service", lat=42.38, lon=3.28),
            _stop(
                id="fuel",
                category="24h Shop",
                group="resupply",
                lat=42.39,
                lon=3.29,
            ),
            _stop(
                id="gas",
                category="Gas station",
                group="resupply",
                lat=42.40,
                lon=3.30,
            ),
            _stop(
                id="unv",
                category="Supermarket",
                group="resupply",
                reviewStatus="unreviewed",
                lat=42.41,
                lon=3.31,
            ),
            _stop(
                id="sleep_unv",
                category="Hotel",
                group="sleep",
                reviewStatus="unreviewed",
                lat=42.42,
                lon=3.32,
            ),
        ]
        out = filter_export_waypoints(stops)
        ids = {s["id"] for s in out}
        self.assertEqual(ids, {"w1", "w2", "m1", "m2", "m3", "sleep"})
        kinds = {s["id"]: s["_exportKind"] for s in out}
        self.assertEqual(kinds["w1"], "water")
        self.assertEqual(kinds["m1"], "shop")
        self.assertEqual(kinds["sleep"], "hotel")

    def test_plain_names_and_syms_in_gpx(self) -> None:
        waypoints = filter_export_waypoints(
            [
                _stop(id="w1"),
                _stop(
                    id="m1",
                    category="Supermarket",
                    group="resupply",
                    lat=42.33,
                    lon=3.23,
                ),
                _stop(
                    id="h1",
                    category="Hotel",
                    group="sleep",
                    lat=42.36,
                    lon=3.26,
                    distanceAlongKm=5,
                ),
            ]
        )
        xml = build_export_gpx(
            name="Test Route",
            track_points=[(42.3, 3.2, 10.0), (42.4, 3.3, 40.0)],
            waypoints=waypoints,
        ).decode("utf-8")
        self.assertIn('version="1.1"', xml)
        self.assertIn("http://www.topografix.com/GPX/1/1", xml)
        root = ET.fromstring(xml.encode("utf-8"))
        wpts = root.findall("g:wpt", NS)
        self.assertEqual(len(wpts), 3)
        names = {w.findtext("g:name", default="", namespaces=NS) for w in wpts}
        syms = {w.findtext("g:sym", default="", namespaces=NS) for w in wpts}
        types = {w.findtext("g:type", default="", namespaces=NS) for w in wpts}
        self.assertEqual(names, {NAME_WATER, NAME_SHOP, NAME_HOTEL})
        self.assertEqual(syms, {SYM_WATER, SYM_SHOP, SYM_HOTEL})
        self.assertEqual(types, {"Water", "Shop", "Hotel"})
        self.assertEqual(SYM_WATER, "Drinking Water")
        self.assertEqual(SYM_SHOP, "Shopping Center")
        self.assertEqual(SYM_HOTEL, "Lodging")
        # Plain labels only (no emojis / POI titles).
        for n in names:
            self.assertNotIn("Fountain", n)
            self.assertNotIn("Supermarket", n)
            self.assertTrue(n.isascii())
            self.assertFalse(any(ord(ch) > 127 for ch in n))
        trkpts = root.findall(".//g:trkpt", NS)
        self.assertEqual(len(trkpts), 2)

    def test_merge_skips_unverified_recommended(self) -> None:
        merged = merge_verified_stops(
            [
                _stop(id="a", reviewStatus="verified"),
                _stop(id="b", reviewStatus="rejected", category="Hotel", group="sleep"),
            ],
            {
                "c": _stop(
                    id="c",
                    category="Convenience",
                    group="resupply",
                    lat=42.34,
                    lon=3.24,
                )
            },
            {"a": "verified"},
        )
        filtered = filter_export_waypoints(merged)
        self.assertEqual({s["id"] for s in filtered}, {"a", "c"})


class RouteStoreExportTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmpdir.cleanup)
        self.uid = "export-user"
        users = os.path.join(self._tmpdir.name, "users")
        os.makedirs(os.path.join(users, self.uid), exist_ok=True)
        self._patch = mock.patch.object(routes_store, "_USERS_DIR", users)
        self._patch.start()
        self.addCleanup(self._patch.stop)

    def test_export_route_gpx_filters_and_includes_track(self) -> None:
        route_id = "rte-export"
        routes_dir = routes_store._routes_dir(self.uid)
        os.makedirs(routes_dir, exist_ok=True)
        route = {
            "id": route_id,
            "createdAt": 1,
            "updatedAt": 1,
            "objectType": "route",
            "name": "Capitals",
            "status": "planning",
            "points": [[42.3, 3.2], [42.4, 3.3], [42.5, 3.4]],
            "track": [[42.3, 3.2, 10], [42.4, 3.3, 40], [42.5, 3.4, 20]],
            "preparation": dict(routes_store.PREPARATION_DEFAULTS),
            "stopReviews": {
                "w1": "verified",
                "m1": "verified",
                "sleep1": "verified",
                "cafe1": "verified",
                "open1": "unreviewed",
            },
            "savedStops": {
                "m1": _stop(
                    id="m1",
                    category="Supermarket",
                    group="resupply",
                    lat=42.33,
                    lon=3.23,
                    distanceAlongKm=5,
                ),
            },
            "hasAnalysis": True,
            "distanceKm": 30,
            "elevationGainM": 100,
            "pointCount": 3,
        }
        with open(os.path.join(routes_dir, f"{route_id}.json"), "w", encoding="utf-8") as f:
            json.dump(route, f)
        with open(os.path.join(routes_dir, f"{route_id}.gpx"), "w", encoding="utf-8") as f:
            f.write(SAMPLE_GPX)
        analysis = {
            "schemaVersion": 2,
            "targetStageKm": 250,
            "recommendedStops": [
                _stop(id="w1", reviewStatus="verified"),
                _stop(
                    id="sleep1",
                    category="Hotel",
                    group="sleep",
                    reviewStatus="verified",
                    lat=42.36,
                    lon=3.26,
                ),
                _stop(
                    id="cafe1",
                    category="Café",
                    group="dining",
                    reviewStatus="verified",
                    lat=42.37,
                    lon=3.27,
                ),
                _stop(
                    id="open1",
                    category="Supermarket",
                    group="resupply",
                    reviewStatus="unreviewed",
                    lat=42.41,
                    lon=3.31,
                ),
                _stop(
                    id="bike1",
                    category="Bike shop",
                    group="service",
                    reviewStatus="verified",
                    lat=42.38,
                    lon=3.28,
                ),
            ],
        }
        with open(
            os.path.join(routes_dir, f"{route_id}.analysis.json"), "w", encoding="utf-8"
        ) as f:
            json.dump(analysis, f)

        exported = routes_store.export_route_gpx(self.uid, route_id)
        self.assertIsNotNone(exported)
        filename, body = exported
        self.assertTrue(filename.endswith(".gpx"))
        root = ET.fromstring(body)
        wpts = root.findall("g:wpt", NS)
        self.assertEqual(len(wpts), 3)
        names = sorted(w.findtext("g:name", default="", namespaces=NS) for w in wpts)
        self.assertEqual(names, sorted([NAME_WATER, NAME_SHOP, NAME_HOTEL]))
        syms = {
            w.findtext("g:name", default="", namespaces=NS): w.findtext(
                "g:sym", default="", namespaces=NS
            )
            for w in wpts
        }
        self.assertEqual(syms[NAME_WATER], SYM_WATER)
        self.assertEqual(syms[NAME_SHOP], SYM_SHOP)
        self.assertEqual(syms[NAME_HOTEL], SYM_HOTEL)
        trkpts = root.findall(".//g:trkpt", NS)
        self.assertGreaterEqual(len(trkpts), 3)

    def test_export_missing_route(self) -> None:
        self.assertIsNone(routes_store.export_route_gpx(self.uid, "nope"))


class ExportEndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmpdir.cleanup)
        self.uid = "http-export-user"
        users = os.path.join(self._tmpdir.name, "users")
        os.makedirs(os.path.join(users, self.uid), exist_ok=True)
        self._patch = mock.patch.object(routes_store, "_USERS_DIR", users)
        self._patch.start()
        self.addCleanup(self._patch.stop)

        from app.auth import current_user
        from app.main import app
        from fastapi.testclient import TestClient

        self.app = app
        self.current_user = current_user
        app.dependency_overrides[current_user] = lambda: {
            "id": self.uid,
            "subscriptionTier": "pro",
        }
        self.addCleanup(app.dependency_overrides.clear)
        self.client = TestClient(app)

    def test_export_endpoint_auth_and_content(self) -> None:
        route_id = "rte-http"
        routes_dir = routes_store._routes_dir(self.uid)
        os.makedirs(routes_dir, exist_ok=True)
        route = {
            "id": route_id,
            "createdAt": 1,
            "updatedAt": 1,
            "objectType": "route",
            "name": "HTTP Route",
            "status": "planning",
            "points": [[42.3, 3.2], [42.4, 3.3]],
            "track": [[42.3, 3.2, 10], [42.4, 3.3, 40]],
            "preparation": dict(routes_store.PREPARATION_DEFAULTS),
            "stopReviews": {"w1": "verified"},
            "savedStops": {},
            "hasAnalysis": True,
            "distanceKm": 10,
            "elevationGainM": 30,
            "pointCount": 2,
        }
        with open(os.path.join(routes_dir, f"{route_id}.json"), "w", encoding="utf-8") as f:
            json.dump(route, f)
        with open(
            os.path.join(routes_dir, f"{route_id}.analysis.json"), "w", encoding="utf-8"
        ) as f:
            json.dump(
                {
                    "schemaVersion": 2,
                    "recommendedStops": [_stop(id="w1", reviewStatus="verified")],
                },
                f,
            )

        res = self.client.get(f"/api/routes/{route_id}/export.gpx")
        self.assertEqual(res.status_code, 200)
        self.assertIn("application/gpx+xml", res.headers.get("content-type", ""))
        self.assertIn("attachment", res.headers.get("content-disposition", ""))
        self.assertIn(NAME_WATER, res.text)
        self.assertIn(SYM_WATER, res.text)

        missing = self.client.get("/api/routes/other-user-route/export.gpx")
        self.assertEqual(missing.status_code, 404)


if __name__ == "__main__":
    unittest.main()
