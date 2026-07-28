"""Planned Route vs Completed Ride — routes never become Library rides."""

from __future__ import annotations

import os
import tempfile
import unittest
from unittest import mock

from app import routes_store
from app.parsing.route_gpx import parse_route_gpx


NO_TIME_GPX = """<?xml version="1.0"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>Course</name><trkseg>
    <trkpt lat="42.3" lon="3.2"><ele>10</ele></trkpt>
    <trkpt lat="42.4" lon="3.3"><ele>40</ele></trkpt>
    <trkpt lat="42.5" lon="3.4"><ele>20</ele></trkpt>
  </trkseg></trk>
</gpx>
"""

TIMED_GPX = """<?xml version="1.0"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>Activity</name><trkseg>
    <trkpt lat="42.3" lon="3.2"><ele>10</ele><time>2024-06-01T08:00:00Z</time></trkpt>
    <trkpt lat="42.4" lon="3.3"><ele>40</ele><time>2024-06-01T09:00:00Z</time></trkpt>
  </trkseg></trk>
</gpx>
"""


class RouteGpxTests(unittest.TestCase):
    def test_parses_without_timestamps(self) -> None:
        with tempfile.NamedTemporaryFile(suffix=".gpx", delete=False, mode="w") as f:
            f.write(NO_TIME_GPX)
            path = f.name
        try:
            parsed = parse_route_gpx(path)
            self.assertFalse(parsed.has_timestamps)
            self.assertEqual(parsed.point_count, 3)
            self.assertGreater(parsed.distance_km, 0)
            self.assertEqual(parsed.name, "Course")
        finally:
            os.unlink(path)

    def test_detects_timestamps(self) -> None:
        with tempfile.NamedTemporaryFile(suffix=".gpx", delete=False, mode="w") as f:
            f.write(TIMED_GPX)
            path = f.name
        try:
            parsed = parse_route_gpx(path)
            self.assertTrue(parsed.has_timestamps)
        finally:
            os.unlink(path)


class RouteStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmpdir.cleanup)
        self.uid = "route-user"
        users = os.path.join(self._tmpdir.name, "users")
        os.makedirs(os.path.join(users, self.uid), exist_ok=True)
        self._patch = mock.patch.object(routes_store, "_USERS_DIR", users)
        self._patch.start()
        self.addCleanup(self._patch.stop)

    def test_create_list_never_looks_like_ride(self) -> None:
        with tempfile.NamedTemporaryFile(suffix=".gpx", delete=False, mode="w") as f:
            f.write(NO_TIME_GPX)
            path = f.name
        try:
            summary = routes_store.create_route_from_gpx(
                self.uid, gpx_path=path, filename="capitals.gpx", name="The Capitals"
            )
        finally:
            os.unlink(path)

        self.assertEqual(summary["objectType"], "route")
        self.assertEqual(summary["name"], "The Capitals")
        listed = routes_store.list_routes(self.uid)
        self.assertEqual(len(listed), 1)
        self.assertEqual(listed[0]["objectType"], "route")
        detail = routes_store.get_route_detail(self.uid, summary["id"])
        assert detail is not None
        self.assertGreaterEqual(len(detail["points"]), 2)
        self.assertIn("preparation", detail)

    def test_verification_updates(self) -> None:
        with tempfile.NamedTemporaryFile(suffix=".gpx", delete=False, mode="w") as f:
            f.write(NO_TIME_GPX)
            path = f.name
        try:
            summary = routes_store.create_route_from_gpx(
                self.uid, gpx_path=path, filename="x.gpx"
            )
        finally:
            os.unlink(path)
        updated = routes_store.update_route(
            self.uid,
            summary["id"],
            {
                "preparation": {
                    "routeUnderstood": True,
                    "stopsVerified": True,
                    "keyClimbsReviewed": True,
                    "stagesPlanned": True,
                }
            },
        )
        assert updated is not None
        self.assertEqual(updated["status"], "ready")
        self.assertTrue(updated["preparation"]["routeUnderstood"])


if __name__ == "__main__":
    unittest.main()
