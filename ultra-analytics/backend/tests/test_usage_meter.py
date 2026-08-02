"""Outbound usage meter — persists under data/usage/."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from unittest import mock


class UsageMeterTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self.root = self._tmpdir.name
        self._env = mock.patch.dict(os.environ, {"ULTRA_DATA_DIR": self.root})
        self._env.start()
        self.addCleanup(self._env.stop)
        self.addCleanup(self._tmpdir.cleanup)

    def test_record_and_read(self) -> None:
        from app.util import usage_meter

        usage_meter.record("strava.api", ok=True, n=3)
        usage_meter.record("strava.api", ok=False)
        usage_meter.record("overpass", ok=True)

        store = usage_meter.read_store(self.root)
        days = store["days"]
        self.assertTrue(days)
        day = next(iter(days.values()))
        self.assertEqual(day["strava.api"]["ok"], 3)
        self.assertEqual(day["strava.api"]["err"], 1)
        self.assertEqual(day["overpass"]["ok"], 1)

        path = os.path.join(self.root, "usage", "meter.json")
        self.assertTrue(os.path.isfile(path))
        with open(path, "r", encoding="utf-8") as f:
            on_disk = json.load(f)
        self.assertIn("days", on_disk)


class ServiceUsageSummaryTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self.root = self._tmpdir.name
        os.makedirs(os.path.join(self.root, "usage"), exist_ok=True)
        from datetime import datetime, timezone

        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        with open(os.path.join(self.root, "usage", "meter.json"), "w", encoding="utf-8") as f:
            json.dump(
                {
                    "version": 1,
                    "days": {
                        today: {
                            "strava.api": {"ok": 100, "err": 2},
                            "google_maps.streetview_metadata": {"ok": 5, "err": 0},
                        }
                    },
                },
                f,
            )
        with open(
            os.path.join(self.root, "usage", "railway_meta.json"), "w", encoding="utf-8"
        ) as f:
            json.dump({"name": "rydn-volume", "currentSizeMB": 200, "sizeMB": 5000}, f)
        self.addCleanup(self._tmpdir.cleanup)

    def test_summary(self) -> None:
        import sys
        from pathlib import Path

        ua = Path(__file__).resolve().parents[2]
        sys.path.insert(0, str(ua))
        from founder.service_usage import build_service_usage

        out = build_service_usage(self.root)
        self.assertTrue(out["hasMeter"])
        self.assertIsNone(out["hint"])
        strava = next(s for s in out["services"] if s["key"] == "strava.api")
        self.assertEqual(strava["today"]["total"], 102)
        self.assertTrue(strava["softDaily"])
        self.assertEqual(out["railway"]["name"], "rydn-volume")


if __name__ == "__main__":
    unittest.main()
