"""Cabinet shelf preview polylines + kind normalization."""

from __future__ import annotations

import os
import tempfile
import unittest
from unittest import mock

from app.analysis.report import build_report
from app.models import Activity, Race, Sample
from app import store, ultras


def _samples(t0: float, n: int = 80, speed: float = 8.0) -> list:
    out = []
    dist = 0.0
    for i in range(n):
        dist += speed
        out.append(
            Sample(
                t=t0 + i,
                lat=48.0 + i * 0.001,
                lon=11.0 + i * 0.001,
                ele=100.0 + i * 0.2,
                dist=dist,
                speed=speed,
                power=None,
                hr=None,
                cadence=None,
            )
        )
    return out


class UltraPreviewTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmpdir.cleanup)
        self.uid = "preview-user"
        users = os.path.join(self._tmpdir.name, "users")
        os.makedirs(os.path.join(users, self.uid), exist_ok=True)
        self._p1 = mock.patch.object(ultras, "_USERS_DIR", users)
        self._p2 = mock.patch.object(store, "_USERS_DIR", users)
        self._p1.start()
        self._p2.start()
        self.addCleanup(self._p1.stop)
        self.addCleanup(self._p2.stop)

    def test_normalize_kind(self) -> None:
        self.assertEqual(ultras.normalize_ultra_kind("race"), "race")
        self.assertEqual(ultras.normalize_ultra_kind("Tour"), "tour")
        self.assertEqual(ultras.normalize_ultra_kind("training"), "ultra")
        self.assertEqual(ultras.normalize_ultra_kind("bikepack"), "bikepacking")

    def test_create_attaches_preview_points(self) -> None:
        day = Activity(source_file="d1", samples=_samples(1_700_000_000.0, n=120))
        report = build_report(Race(name="D1", kind="race", activities=[day]))
        summary = store.save_ride(self.uid, report, activities=[day])
        ultra = ultras.ultra_from_activities(
            self.uid, "Preview Trip", [summary], kind="race"
        )
        pts = ultra.get("previewPoints") or []
        self.assertGreaterEqual(len(pts), 2)
        self.assertLessEqual(len(pts), ultras.PREVIEW_MAX_POINTS + 2)
        self.assertEqual(ultra.get("kind"), "race")

        cabinet = ultras.cabinet_payload(self.uid, store.list_rides(self.uid))
        completed = cabinet["completedUltras"]
        self.assertEqual(len(completed), 1)
        self.assertGreaterEqual(len(completed[0].get("previewPoints") or []), 2)

    def test_cabinet_backfills_missing_preview_points(self) -> None:
        day = Activity(source_file="d2", samples=_samples(1_700_000_100.0, n=100))
        report = build_report(Race(name="D2", kind="tour", activities=[day]))
        summary = store.save_ride(self.uid, report, activities=[day])
        ultra = ultras.ultra_from_activities(
            self.uid, "Old Trip", [summary], kind="tour"
        )
        # Simulate a pre-thumb ultra persisted without previewPoints.
        ultra.pop("previewPoints", None)
        ultras._save(self.uid, ultra)

        cabinet = ultras.cabinet_payload(self.uid, store.list_rides(self.uid))
        completed = cabinet["completedUltras"]
        self.assertEqual(len(completed), 1)
        self.assertGreaterEqual(len(completed[0].get("previewPoints") or []), 2)

    def test_recompute_keeps_preview_when_build_empty(self) -> None:
        day = Activity(source_file="d3", samples=_samples(1_700_000_200.0, n=100))
        report = build_report(Race(name="D3", kind="race", activities=[day]))
        summary = store.save_ride(self.uid, report, activities=[day])
        ultra = ultras.ultra_from_activities(
            self.uid, "Keep Thumb", [summary], kind="race"
        )
        prior = list(ultra.get("previewPoints") or [])
        self.assertGreaterEqual(len(prior), 2)

        with mock.patch.object(ultras, "build_preview_points", return_value=[]):
            refreshed = ultras.recompute_ultra(self.uid, ultra["id"])
        self.assertIsNotNone(refreshed)
        self.assertEqual(refreshed.get("previewPoints"), prior)
